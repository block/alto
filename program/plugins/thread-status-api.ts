import type { Context } from 'cordis'

/**
 * `blocked` means the chat is waiting for the user. `failed` is an
 * unacknowledged completion whose turn ended with an error.
 */
export type ThreadWorkStatus = 'running' | 'blocked' | 'finished' | 'failed'

/** What a blocked chat or program is waiting for. */
export type ThreadBlockedKind = 'permission' | 'question' | 'auth'

export interface ClientThreadStatusSnapshot {
  revision: number
  running: readonly string[]
  /** Unacknowledged completions, newest first. */
  finished: readonly string[]
  /** Chats waiting on an approval or answer. Blocked chats also appear in `running`. */
  blocked?: Readonly<Record<string, ThreadBlockedKind>>
  /** The subset of `finished` whose last turn failed. */
  failed?: readonly string[]
  /**
   * The subset of `finished` whose outcome has not been reported yet. Each
   * entry either becomes failed or settles as finished within about a second.
   */
  settling?: readonly string[]
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
  failed: ReadonlySet<string>
}>()

function statusIndex(snapshot: ClientThreadStatusSnapshot) {
  let index = statusIndexes.get(snapshot)
  if (!index) {
    index = {
      running: new Set(snapshot.running),
      finished: new Set(snapshot.finished),
      failed: new Set(snapshot.failed ?? []),
    }
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

export function threadBlockedKind(
  snapshot: ClientThreadStatusSnapshot,
  threadId: string,
): ThreadBlockedKind | undefined {
  return snapshot.blocked && Object.hasOwn(snapshot.blocked, threadId) ? snapshot.blocked[threadId] : undefined
}

export function threadWorkStatus(
  snapshot: ClientThreadStatusSnapshot,
  threadId: string,
): ThreadWorkStatus | undefined {
  if (threadBlockedKind(snapshot, threadId)) return 'blocked'
  const index = statusIndex(snapshot)
  if (index.running.has(threadId)) return 'running'
  if (index.failed.has(threadId)) return 'failed'
  if (index.finished.has(threadId)) return 'finished'
  return undefined
}

// A tab shows whichever of its chats most needs attention. Waiting chats come
// first because nothing else proceeds until the user responds; a failure
// outranks ongoing work so that one error among several busy chats stays visible.
const AGGREGATE_PRIORITY: Readonly<Record<ThreadWorkStatus, number>> = {
  blocked: 4,
  failed: 3,
  running: 2,
  finished: 1,
}

export function mostUrgentWorkStatus(
  statuses: Iterable<ThreadWorkStatus | undefined>,
): ThreadWorkStatus | undefined {
  let result: ThreadWorkStatus | undefined
  for (const status of statuses) {
    if (status && (!result || AGGREGATE_PRIORITY[status] > AGGREGATE_PRIORITY[result])) result = status
    if (result === 'blocked') break
  }
  return result
}

export function aggregateThreadWorkStatus(
  snapshot: ClientThreadStatusSnapshot,
  threadIds: readonly string[],
): ThreadWorkStatus | undefined {
  return mostUrgentWorkStatus(threadIds.map((threadId) => threadWorkStatus(snapshot, threadId)))
}

export interface ThreadWorkStatusCounts {
  running: number
  blocked: number
  finished: number
  failed: number
}

export function threadWorkStatusCounts(
  snapshot: ClientThreadStatusSnapshot,
  threadIds: readonly string[],
): ThreadWorkStatusCounts {
  const counts: ThreadWorkStatusCounts = { running: 0, blocked: 0, finished: 0, failed: 0 }
  for (const threadId of new Set(threadIds)) {
    const status = threadWorkStatus(snapshot, threadId)
    if (status) counts[status] += 1
  }
  return counts
}

export function blockedStatusLabel(kind: ThreadBlockedKind | undefined): string {
  if (kind === 'permission') return 'Waiting for approval'
  if (kind === 'question') return 'Waiting for your answer'
  if (kind === 'auth') return 'Waiting for sign-in'
  return 'Waiting for you'
}

/** The blocked kind of the first waiting chat, for labeling an aggregate badge. */
export function aggregateBlockedKind(
  snapshot: ClientThreadStatusSnapshot,
  threadIds: readonly string[],
): ThreadBlockedKind | undefined {
  for (const threadId of threadIds) {
    const kind = threadBlockedKind(snapshot, threadId)
    if (kind) return kind
  }
  return undefined
}

declare module 'cordis' {
  interface Context {
    clientThreadStatus: ClientThreadStatusService
  }
}
