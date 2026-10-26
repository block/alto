import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  AppServerClient,
  type AppServerClientOptions,
} from '../src/server/app-server-client.js'

class MockProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0, null))
    return true
  }
}

function jsonLines(stream: PassThrough, callback: (value: Record<string, unknown>) => void): void {
  let buffer = ''
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      callback(JSON.parse(line) as Record<string, unknown>)
    }
  })
}

describe('AppServerClient', () => {
  it('reports a missing Codex executable only when requested', async () => {
    const client = new AppServerClient({ command: '/alto-test-missing/bin/codex' })
    expect(client.status).toBe('stopped')
    await expect(client.request('model/list')).rejects.toThrow('Codex CLI is not installed or is not on PATH')
    expect(client.status).toBe('failed')
    await client.stop()
  })

  it('retries a failed spawn, shares concurrent startup, and ignores the old process exiting', async () => {
    const failed = new MockProcess()
    const ready = new MockProcess()
    jsonLines(ready.stdin, (message) => {
      if (message.id !== undefined) ready.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
    })
    const createProcess = vi.fn().mockReturnValueOnce(failed).mockReturnValue(ready)
    const client = new AppServerClient({ createProcess })
    const first = client.start()
    expect(client.start()).toBe(first)
    failed.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }))
    await expect(first).rejects.toThrow('choose another agent')

    const retry = client.start()
    expect(client.start()).toBe(retry)
    await retry
    failed.emit('exit', 1, null)
    expect(client.status).toBe('ready')
    const staleNotification = vi.fn()
    client.on('notification', staleNotification)
    failed.stdout.write(`${JSON.stringify({ method: 'stale/notification' })}\n`)
    failed.stdout.end(JSON.stringify({ method: 'stale/final' }))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(staleNotification).not.toHaveBeenCalled()
    await expect(client.request('model/list')).resolves.toEqual({})
    expect(createProcess).toHaveBeenCalledTimes(2)
    await client.stop()
  })

  it('can stop during initialization and start a new process', async () => {
    const first = new MockProcess()
    const second = new MockProcess()
    jsonLines(second.stdin, (message) => {
      if (message.method === 'initialize') second.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
    })
    const client = new AppServerClient({ createProcess: vi.fn().mockReturnValueOnce(first).mockReturnValue(second) })
    const starting = expect(client.start()).rejects.toThrow('stopped')
    await client.stop()
    const restarted = client.start()
    await starting
    await restarted
    expect(client.status).toBe('ready')
    await client.stop()
  })

  it('preserves Unicode separators across UTF-8 chunks and CRLF frames', async () => {
    const child = new MockProcess()
    const content = 'before\u2028middle\u2029after 🙂\r\nlast line'
    jsonLines(child.stdin, (message) => {
      if (message.method === 'initialize') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
      }
      if (message.method === 'thread/read') {
        const frames = Buffer.from([
          JSON.stringify({ method: 'test/notification', params: { content } }),
          JSON.stringify({ id: message.id, result: { content } }),
          '',
        ].join('\r\n'))
        // Split every multibyte character and the CRLF delimiters across writes.
        for (let offset = 0; offset < frames.length; offset += 1) {
          child.stdout.write(frames.subarray(offset, offset + 1))
        }
      }
    })
    const client = new AppServerClient({ createProcess: () => child })
    const diagnostics: string[] = []
    client.on('stderr', (text: string) => diagnostics.push(text))
    const notification = once(client, 'notification')
    try {
      await expect(client.request('thread/read')).resolves.toEqual({ content })
      await expect(notification).resolves.toEqual([{ method: 'test/notification', params: { content } }])
      expect(diagnostics).toEqual([])
    } finally {
      await client.stop()
    }
  })

  it('reads multiple frames in one chunk and a complete final frame without LF', async () => {
    const child = new MockProcess()
    jsonLines(child.stdin, (message) => {
      if (message.method === 'initialize') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
      }
      if (message.method === 'thread/read') {
        child.stdout.end([
          JSON.stringify({ method: 'test/first', params: {} }),
          JSON.stringify({ method: 'test/second', params: {} }),
          JSON.stringify({ id: message.id, result: { content: 'final response' } }),
        ].join('\n'))
      }
    })
    const client = new AppServerClient({ createProcess: () => child })
    const methods: string[] = []
    client.on('notification', (event: { method: string }) => methods.push(event.method))
    try {
      await expect(client.request('thread/read')).resolves.toEqual({ content: 'final response' })
      expect(methods).toEqual(['test/first', 'test/second'])
    } finally {
      await client.stop()
    }
  })

  it('bounds diagnostics for an incomplete final frame and rejects its request on exit', async () => {
    const child = new MockProcess()
    jsonLines(child.stdin, (message) => {
      if (message.method === 'initialize') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
      }
      if (message.method === 'thread/read') {
        child.stdout.once('end', () => child.emit('exit', 1, null))
        child.stdout.end(`{"id":${message.id},"result":{"content":"${'x'.repeat(64 * 1024)}`)
      }
    })
    const client = new AppServerClient({ createProcess: () => child })
    const diagnostics: string[] = []
    client.on('stderr', (text: string) => diagnostics.push(text))
    try {
      await expect(client.request('thread/read')).rejects.toThrow('codex app-server exited (1)')
      expect(client.status).toBe('failed')
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatch(/^Invalid app-server JSON: /)
      expect(diagnostics[0]).toContain('characters total]')
      expect(diagnostics[0]!.length).toBeLessThan(4200)
    } finally {
      await client.stop()
    }
  })

  it('initializes JSON-RPC and handles requests in both directions', async () => {
    const child = new MockProcess()
    const outbound: Record<string, unknown>[] = []
    jsonLines(child.stdin, (message) => {
      outbound.push(message)
      if (message.method === 'initialize') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'test' } })}\n`)
      }
      if (message.method === 'model/list') {
        child.stdout.write(`${JSON.stringify({ id: message.id, result: { data: [] } })}\n`)
      }
    })

    const options: AppServerClientOptions = { createProcess: () => child }
    const client = new AppServerClient(options)
    await client.start()

    expect(client.status).toBe('ready')
    expect(outbound[0]).toMatchObject({
      method: 'initialize',
      params: { capabilities: { experimentalApi: true } },
    })
    expect(outbound[1]).toMatchObject({ method: 'initialized' })
    await expect(client.request('model/list')).resolves.toEqual({ data: [] })

    const requestPromise = once(client, 'request')
    child.stdout.write(`${JSON.stringify({
      id: 'server-1',
      method: 'item/fileChange/requestApproval',
      params: { itemId: 'item-1' },
    })}\n`)
    const [request] = await requestPromise
    expect(request).toMatchObject({ id: 'server-1', method: 'item/fileChange/requestApproval' })

    client.respond('server-1', { decision: 'decline' })
    expect(outbound.at(-1)).toEqual({ id: 'server-1', result: { decision: 'decline' } })

    const notificationPromise = once(client, 'notification')
    child.stdout.write(`${JSON.stringify({ method: 'turn/started', params: { threadId: 'thread-1' } })}\n`)
    const [notification] = await notificationPromise
    expect(notification).toMatchObject({ method: 'turn/started' })

    await client.stop()
    expect(child.killed).toBe(true)
  })
})
