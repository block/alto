import type { Context } from 'cordis'

export type ThreadWorkStatus = 'running' | 'finished'

export interface ClientThreadStatusSnapshot {
  revision: number
  running: readonly string[]
  /** Unacknowledged completions, newest first. */
  finished: readonly string[]
}

export interface ClientThreadStatusService {
  subscribe(listener: () => void): () => void
  snapshot(): ClientThreadStatusSnapshot
  acknowledge(threadId: string): void
}

// All badges and chat lists share one index for each immutable store snapshot.
const statusIndexes = new WeakMap<ClientThreadStatusSnapshot, {
  running: ReadonlySet<string>
  finished: ReadonlySet<string>
}>()

function statusIndex(snapshot: ClientThreadStatusSnapshot) {
  let index = statusIndexes.get(snapshot)
  if (!index) {
    index = { running: new Set(snapshot.running), finished: new Set(snapshot.finished) }
    statusIndexes.set(snapshot, index)
  }
  return index
}

const EMPTY_THREAD_STATUS: ClientThreadStatusSnapshot = Object.freeze({
  revision: 0,
  running: Object.freeze([]),
  finished: Object.freeze([]),
})

/**
 * Chat lists are useful without the optional status plugin. This adapter follows
 * the service as its fiber is loaded or unloaded, while presenting one stable
 * external store to React consumers.
 */
export class OptionalThreadStatusService implements ClientThreadStatusService {
  private readonly listeners = new Set<() => void>()
  private current: ClientThreadStatusService | undefined
  private currentSnapshot: ClientThreadStatusSnapshot = EMPTY_THREAD_STATUS
  private disposeCurrent: (() => void) | undefined
  private readonly disposeServiceEvents: () => unknown
  private disposed = false

  constructor(private readonly ctx: Context) {
    this.rebind()
    this.disposeServiceEvents = ctx.on('internal/service', (name) => {
      if (name === 'clientThreadStatus') this.rebind()
    })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): ClientThreadStatusSnapshot => this.currentSnapshot

  acknowledge(threadId: string): void {
    this.current?.acknowledge(threadId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeServiceEvents()
    this.disposeCurrent?.()
    this.listeners.clear()
  }

  private rebind(): void {
    if (this.disposed) return
    const next = this.ctx.get('clientThreadStatus', false) as ClientThreadStatusService | undefined
    if (next !== this.current) {
      this.disposeCurrent?.()
      this.current = next
      this.disposeCurrent = next?.subscribe(() => this.syncSnapshot())
    }
    this.syncSnapshot()
  }

  private syncSnapshot(): void {
    const next = this.current?.snapshot() ?? EMPTY_THREAD_STATUS
    if (next === this.currentSnapshot) return
    this.currentSnapshot = next
    for (const listener of this.listeners) listener()
  }
}

export function threadWorkStatus(
  snapshot: ClientThreadStatusSnapshot,
  threadId: string,
): ThreadWorkStatus | undefined {
  const index = statusIndex(snapshot)
  if (index.running.has(threadId)) return 'running'
  if (index.finished.has(threadId)) return 'finished'
  return undefined
}

export function aggregateThreadWorkStatus(
  snapshot: ClientThreadStatusSnapshot,
  threadIds: readonly string[],
): ThreadWorkStatus | undefined {
  let finished = false
  for (const threadId of threadIds) {
    const status = threadWorkStatus(snapshot, threadId)
    if (status === 'running') return 'running'
    if (status === 'finished') finished = true
  }
  return finished ? 'finished' : undefined
}

export function threadWorkStatusCounts(
  snapshot: ClientThreadStatusSnapshot,
  threadIds: readonly string[],
): { running: number; finished: number } {
  const index = statusIndex(snapshot)
  let running = 0
  let finished = 0
  for (const threadId of new Set(threadIds)) {
    if (index.running.has(threadId)) running += 1
    else if (index.finished.has(threadId)) finished += 1
  }
  return { running, finished }
}

declare module 'cordis' {
  interface Context {
    clientThreadStatus: ClientThreadStatusService
  }
}
