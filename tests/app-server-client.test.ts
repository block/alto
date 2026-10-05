import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
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
