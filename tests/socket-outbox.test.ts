import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyJsonPatch } from '../src/shared/json-patch.js'
import type { HarnessEvent, JsonValue } from '../src/shared/protocol.js'
import { SocketOutbox, type OutboxSocket } from '../src/server/services/socket-outbox.js'

class FakeSocket implements OutboxSocket {
  bufferedAmount = 0
  open = true
  terminated = false
  readonly sent: HarnessEvent[] = []
  isOpen(): boolean { return this.open }
  send(payload: string, done: (error?: Error) => void): void {
    this.sent.push(JSON.parse(payload) as HarnessEvent)
    done()
  }
  terminate(): void { this.terminated = true; this.open = false }
}

const options = { softLimit: 100, hardLimit: 10_000, retryMs: 25 }

/** Replays the sent events the way the browser host reduces them. */
function browserExtensions(sent: HarnessEvent[]): Record<string, JsonValue> {
  let extensions: Record<string, JsonValue> = {}
  for (const event of sent) {
    if (event.type === 'snapshot') extensions = { ...event.payload.extensions }
    if (event.type !== 'extensions.updated') continue
    if (!event.partial) { extensions = { ...event.payload }; continue }
    extensions = { ...extensions, ...event.payload }
    for (const [name, patch] of Object.entries(event.patches ?? {})) {
      extensions[name] = applyJsonPatch(extensions[name], patch)
    }
    for (const name of event.removed ?? []) delete extensions[name]
  }
  return extensions
}

function snapshotEvent(extensions: Record<string, JsonValue>): HarnessEvent {
  return { type: 'snapshot', payload: { extensions } } as unknown as HarnessEvent
}

describe('socket outbox', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends later states as differences from the snapshot', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, options)
    const extensions = { chat: { text: 'Hel' } }
    outbox.event(snapshotEvent(extensions), extensions)
    outbox.state('chat', { text: 'Hello' })
    expect(socket.sent[1]).toEqual({ type: 'extensions.updated', partial: true, payload: {}, patches: { chat: { o: { text: { s: 'lo' } } } } })
    expect(browserExtensions(socket.sent)).toEqual({ chat: { text: 'Hello' } })
  })

  it('coalesces states while the socket is backed up', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, options)
    outbox.event(snapshotEvent({}), {})
    socket.bufferedAmount = 1_000
    for (let index = 1; index <= 50; index += 1) outbox.state('chat', { text: 'x'.repeat(index) })
    outbox.state('other', 1)
    expect(socket.sent).toHaveLength(1)
    socket.bufferedAmount = 0
    vi.advanceTimersByTime(25)
    expect(socket.sent).toHaveLength(3)
    expect(browserExtensions(socket.sent)).toEqual({ chat: { text: 'x'.repeat(50) }, other: 1 })
    expect(socket.terminated).toBe(false)
  })

  it('keeps events ordered with queued states', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, options)
    outbox.event(snapshotEvent({}), {})
    socket.bufferedAmount = 1_000
    outbox.state('chat', 1)
    outbox.event({ type: 'program.error', payload: { message: 'x' } } as unknown as HarnessEvent)
    outbox.state('chat', 2)
    socket.bufferedAmount = 0
    vi.advanceTimersByTime(25)
    expect(socket.sent.map((event) => event.type)).toEqual(['snapshot', 'extensions.updated', 'program.error'])
    expect(browserExtensions(socket.sent)).toEqual({ chat: 2 })
  })

  it('drops queued states superseded by a full snapshot', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, options)
    outbox.event(snapshotEvent({ chat: 0 }), { chat: 0 })
    socket.bufferedAmount = 1_000
    outbox.state('chat', 1)
    outbox.event({ type: 'extensions.updated', payload: { chat: 2 } }, { chat: 2 })
    outbox.state('chat', 3)
    socket.bufferedAmount = 0
    vi.advanceTimersByTime(25)
    expect(socket.sent.map((event) => event.type)).toEqual(['snapshot', 'extensions.updated', 'extensions.updated'])
    expect(browserExtensions(socket.sent)).toEqual({ chat: 3 })
  })

  it('sends removals and skips unchanged states', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, options)
    outbox.event(snapshotEvent({ chat: 1 }), { chat: 1 })
    outbox.state('chat', 1)
    outbox.state('missing', undefined)
    expect(socket.sent).toHaveLength(1)
    outbox.state('chat', undefined)
    expect(browserExtensions(socket.sent)).toEqual({})
  })

  it('terminates only when uncoalescible events exceed the hard limit', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, { ...options, hardLimit: 500 })
    outbox.event(snapshotEvent({}), {})
    socket.bufferedAmount = 1_000_000
    for (let index = 0; index < 1_000; index += 1) outbox.state('chat', { text: 'y'.repeat(index) })
    expect(socket.terminated).toBe(false)
    const error = { type: 'program.error', payload: { message: 'z'.repeat(600) } } as unknown as HarnessEvent
    outbox.event(error)
    expect(socket.terminated).toBe(false)
    outbox.event(error)
    expect(socket.terminated).toBe(true)
  })

  it('keeps a socket open while it reads a snapshot larger than the hard limit', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, { ...options, hardLimit: 500 })
    outbox.event(snapshotEvent({ chat: 'c'.repeat(2_000) }), { chat: 'c'.repeat(2_000) })
    socket.bufferedAmount = 2_000
    for (let index = 0; index < 5; index += 1) {
      outbox.event({ type: 'program.error', payload: { message: 'small' } } as unknown as HarnessEvent)
    }
    expect(socket.terminated).toBe(false)
    socket.bufferedAmount = 0
    vi.advanceTimersByTime(25)
    expect(socket.sent).toHaveLength(6)
  })

  it('drops events for a closing socket instead of terminating it', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, { ...options, hardLimit: 10 })
    socket.open = false
    for (let index = 0; index < 5; index += 1) outbox.event(snapshotEvent({ chat: 'x'.repeat(100) }), {})
    outbox.state('chat', 1)
    expect(socket.sent).toEqual([])
    expect(socket.terminated).toBe(false)
  })

  it('sends one event larger than the hard limit to an idle socket', () => {
    const socket = new FakeSocket()
    const outbox = new SocketOutbox(socket, { ...options, hardLimit: 500 })
    const extensions = { chat: 'c'.repeat(2_000) }
    outbox.event(snapshotEvent(extensions), extensions)
    expect(socket.terminated).toBe(false)
    expect(browserExtensions(socket.sent)).toEqual(extensions)
  })
})
