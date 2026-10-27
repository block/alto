import { diffJson } from '../../shared/json-patch.js'
import type { HarnessEvent, JsonValue } from '../../shared/protocol.js'

export interface OutboxSocket {
  readonly bufferedAmount: number
  isOpen(): boolean
  send(payload: string, done: (error?: Error) => void): void
  terminate(): void
}

export interface SocketOutboxOptions {
  /** Defer sending while the socket holds more than this many bytes. */
  softLimit: number
  /** Terminate when events arrive while more than this many queued bytes are unsent. */
  hardLimit: number
  retryMs: number
}

type Entry =
  | { kind: 'event'; payload: string; extensions?: Record<string, JsonValue> }
  | { kind: 'state'; name: string }

const REMOVED = Symbol('removed')

/**
 * Orders one browser socket's outgoing events. Client extension states are
 * idempotent snapshots: while the browser is busy, a newer value replaces a
 * queued one instead of adding to the backlog, and each value is sent as a
 * difference from the last one this socket received. A slow browser
 * therefore receives fewer updates rather than being disconnected and
 * forced to resume every chat.
 */
export class SocketOutbox {
  private readonly queue: Entry[] = []
  private readonly states = new Map<string, JsonValue | typeof REMOVED>()
  /** Mirrors the extension states the browser has applied. */
  private readonly baseline = new Map<string, JsonValue>()
  private queuedBytes = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly socket: OutboxSocket,
    private readonly options: SocketOutboxOptions,
  ) {}

  /**
   * Queues an event. Supplying `extensions` records that the event carries
   * the browser's complete extension state, as snapshots do.
   */
  event(event: HarnessEvent, extensions?: Record<string, JsonValue>): void {
    if (this.closed) return
    // A closing socket can still receive broadcasts before its close event.
    if (!this.socket.isOpen()) { this.close(); return }
    const payload = JSON.stringify(event)
    if (extensions) {
      // The snapshot already contains every queued state. A later change must
      // follow it rather than be sent first and then overwritten.
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        if (this.queue[index]!.kind === 'state') this.queue.splice(index, 1)
      }
      this.states.clear()
    }
    // Writing stops at the soft limit, so the socket buffer exceeds it by at
    // most one message, however large. Only events that could not be written
    // show that the browser has stopped reading. Counting the buffer instead
    // would close a socket that is still reading a large snapshot, and every
    // reconnect would then fail the same way.
    const backlog = this.queuedBytes
    this.queue.push({ kind: 'event', payload, ...(extensions ? { extensions } : {}) })
    this.queuedBytes += payload.length
    if (backlog > this.options.hardLimit) {
      this.close()
      this.socket.terminate()
      return
    }
    this.drain()
  }

  state(name: string, value: JsonValue | undefined): void {
    if (this.closed) return
    if (!this.socket.isOpen()) { this.close(); return }
    if (!this.states.has(name)) this.queue.push({ kind: 'state', name })
    this.states.set(name, value === undefined ? REMOVED : value)
    this.drain()
  }

  close(): void {
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.queue.length = 0
    this.states.clear()
    this.baseline.clear()
  }

  private drain(): void {
    if (this.closed || this.timer !== undefined) return
    while (this.queue.length) {
      if (!this.socket.isOpen()) return
      if (this.socket.bufferedAmount > this.options.softLimit) {
        this.timer = setTimeout(() => {
          this.timer = undefined
          this.drain()
        }, this.options.retryMs)
        return
      }
      const entry = this.queue.shift()!
      const payload = entry.kind === 'event' ? this.takeEvent(entry) : this.takeState(entry.name)
      if (payload === undefined) continue
      this.socket.send(payload, (error) => {
        if (error) this.socket.terminate()
      })
    }
  }

  private takeEvent(entry: Extract<Entry, { kind: 'event' }>): string {
    this.queuedBytes -= entry.payload.length
    if (entry.extensions) {
      this.baseline.clear()
      for (const [name, value] of Object.entries(entry.extensions)) this.baseline.set(name, value)
    }
    return entry.payload
  }

  private takeState(name: string): string | undefined {
    const value = this.states.get(name)
    this.states.delete(name)
    if (value === undefined) return undefined
    const previous = this.baseline.get(name)
    if (value === REMOVED) {
      if (!this.baseline.has(name)) return undefined
      this.baseline.delete(name)
      return JSON.stringify({ type: 'extensions.updated', partial: true, payload: {}, removed: [name] } satisfies HarnessEvent)
    }
    this.baseline.set(name, value)
    if (previous === undefined) {
      return JSON.stringify({ type: 'extensions.updated', partial: true, payload: { [name]: value } } satisfies HarnessEvent)
    }
    const patch = diffJson(previous, value)
    if (!patch) return undefined
    return JSON.stringify({ type: 'extensions.updated', partial: true, payload: {}, patches: { [name]: patch } } satisfies HarnessEvent)
  }
}
