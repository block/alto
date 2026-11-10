import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import orchestrator from '../program/plugins/orchestrator.js'
import { ORCHESTRATOR_STATE, type OrchestratorSnapshot } from '../program/plugins/orchestrator-api.js'
import { BrowserHost } from '../src/client/host.js'
import { SocketOutbox } from '../src/server/services/socket-outbox.js'
import type { HarnessContext } from '../src/server/plugin-api.js'
import type { HarnessEvent, HarnessSnapshot, JsonValue } from '../src/shared/protocol.js'

type SocketEvent = 'open' | 'message' | 'close'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readonly listeners = new Map<SocketEvent, Array<(event: { data?: string }) => void>>()
  readonly sent: string[] = []
  readyState = 0
  closeCount = 0

  constructor(_url: string, _protocol: string) { FakeWebSocket.instances.push(this) }
  addEventListener(event: SocketEvent, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }
  emit(event: SocketEvent, payload: { data?: string } = {}): void {
    if (event === 'open') this.readyState = FakeWebSocket.OPEN
    if (event === 'close') this.readyState = 3
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }
  send(payload: string): void { this.sent.push(payload) }
  close(): void { this.closeCount++; this.emit('close') }
}

async function fixture() {
  const host = new BrowserHost()
  const stopHost = host.start()
  await vi.advanceTimersByTimeAsync(0)
  const socket = FakeWebSocket.instances.at(-1)!
  socket.emit('open')
  const wire: HarnessEvent[] = []
  const outbox = new SocketOutbox({
    get bufferedAmount() { return 0 },
    isOpen: () => socket.readyState === FakeWebSocket.OPEN,
    send: (payload, done) => {
      wire.push(JSON.parse(payload) as HarnessEvent)
      socket.emit('message', { data: payload })
      done()
    },
    terminate: () => socket.close(),
  }, { softLimit: 1024 * 1024, hardLimit: 64 * 1024 * 1024, retryMs: 25 })

  const disposers: Array<() => void> = []
  const events = new Map<string, Set<(payload: unknown) => void>>()
  const statusListeners = new Set<() => void>()
  const states = new Map<string, JsonValue>()
  let streaming = false
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'thread/loaded/list') return { data: [] }
    if (method === 'thread/read') return { thread: { id: params.threadId, name: 'Parent', cwd: '/repo' } }
    throw new Error('Unexpected native operation: ' + method)
  })
  const stopTask = vi.fn(async () => {})
  const ctx = {
    get: (name: string) => name === 'agentChats' ? ctx.agentChats : undefined,
    agentChats: { tasks: () => [], stopTask },
    codex: {
      client: { request }, start: vi.fn(async () => {}), snapshot: () => ({ status: 'ready' }),
      on: (_event: string, listener: () => void) => statusListeners.add(listener),
      off: (_event: string, listener: () => void) => statusListeners.delete(listener),
    },
    ui: { register: vi.fn() },
    effect: (run: () => () => void) => { const dispose = run(); disposers.push(dispose); return dispose },
    on: (event: string, listener: (payload: unknown) => void) => {
      const listeners = events.get(event) ?? new Set()
      listeners.add(listener)
      events.set(event, listeners)
      const dispose = () => { listeners.delete(listener) }
      disposers.push(dispose)
      return dispose
    },
    inject: (_services: string[], apply: (child: unknown) => () => void) => { disposers.push(apply(ctx)) },
    clientExtensions: {
      // Match the deployed registry's clone behavior. The newer source registry
      // normalizes optional fields and would mask an unsafe producer here.
      registerState: (_owner: unknown, name: string, value: JsonValue) => {
        states.set(name, structuredClone(value))
        disposers.push(() => { states.delete(name) })
        return { update: (next: JsonValue) => {
          const copy = structuredClone(next)
          states.set(name, copy)
          if (streaming) outbox.state(name, copy)
        } }
      },
      registerMethod: vi.fn(),
    },
  }
  ;(orchestrator as (owner: HarnessContext) => void)(ctx as unknown as HarnessContext)
  await vi.advanceTimersByTimeAsync(0)
  const extensions = Object.fromEntries(states)
  const snapshot = {
    codex: { status: 'ready', models: [], activeThreadIds: [] },
    program: { revision: 1, profileText: '', plugins: [], files: [], tools: [], proposals: [] },
    projects: { revision: 0, projects: [] }, ui: { regions: [], surfaces: [], contributions: [] },
    extensions, pendingRequests: [], server: { host: '127.0.0.1', port: 4317, projectRoot: '/repo' },
  } as HarnessSnapshot
  outbox.event({ type: 'snapshot', payload: snapshot }, extensions)
  streaming = true

  return {
    host, socket, wire, request, stopTask, statusListeners, events,
    tasks: () => (host.snapshot().snapshot!.extensions[ORCHESTRATOR_STATE] as unknown as OrchestratorSnapshot).tasks,
    notify: async (method: string, params: unknown) => {
      for (const listener of events.get('codex/notification') ?? []) listener({ method, params })
      await vi.advanceTimersByTimeAsync(100)
    },
    disposePlugin: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
    close: () => { outbox.close(); stopHost() },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ protocol: 'alto.test-session' }) })))
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: '127.0.0.1:4317', hash: '#alto-control=test-capability' },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const child = { id: 'child', parentThreadId: 'parent', name: 'Child', cwd: '/repo', createdAt: 1, updatedAt: 1, status: { type: 'active' } }

it('publishes native task error and completion clears over socket patches without reconnecting the browser', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const f = await fixture()
  try {
    await f.notify('thread/started', { thread: child })
    expect(f.tasks()[0]).toMatchObject({ id: 'child', status: 'working' })
    await f.notify('turn/completed', { threadId: 'child', turn: { id: 'first-turn', status: 'failed', error: { message: 'Temporary failure' } } })
    expect(f.tasks()[0]).toMatchObject({ status: 'failed', error: 'Temporary failure', finishedAt: expect.any(Number) })
    await f.notify('turn/started', { threadId: 'child', turn: { id: 'next-turn' } })
    expect(f.tasks()[0]).toMatchObject({ status: 'working', turnId: 'next-turn' })
    expect(f.tasks()[0]).not.toHaveProperty('error')
    expect(f.tasks()[0]).not.toHaveProperty('finishedAt')
    expect(f.wire.filter(event => event.type === 'snapshot')).toHaveLength(1)
    expect(f.wire.some(event => event.type === 'extensions.updated' && Object.hasOwn(event.patches ?? {}, ORCHESTRATOR_STATE))).toBe(true)
    expect(f.host.snapshot()).toMatchObject({ connected: true, connectionEpoch: 1 })
    expect(f.socket.closeCount).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
  } finally { f.disposePlugin(); f.close() }
})

it('unloads native monitoring without cancelling running tasks or leaving polling and subscriptions active', async () => {
  const f = await fixture()
  try {
    await f.notify('thread/started', { thread: child })
    expect(f.tasks()[0]?.status).toBe('working')
    for (const listener of f.events.get('codex/notification') ?? []) listener({ method: 'turn/started', params: { threadId: 'child', turn: { id: 'still-running' } } })
    const requests = f.request.mock.calls.length
    f.disposePlugin()
    const publications = f.wire.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.request).toHaveBeenCalledTimes(requests)
    expect(f.request.mock.calls.every(([method]) => ['thread/loaded/list', 'thread/read'].includes(method))).toBe(true)
    expect(f.stopTask).not.toHaveBeenCalled()
    expect(f.statusListeners.size).toBe(0)
    expect([...f.events.values()].every(listeners => listeners.size === 0)).toBe(true)
    expect(f.wire).toHaveLength(publications)
    expect(vi.getTimerCount()).toBe(0)
    expect(f.socket.closeCount).toBe(0)
  } finally { f.disposePlugin(); f.close() }
})
