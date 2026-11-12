import { isAgentChatId, type AgentChat } from './agent-chats-api.js'
import type { Plugin } from 'cordis'
import type { ClientHostService } from '../../src/client/plugin-api.js'
import type {
  HarnessEvent,
  HarnessSnapshot,
  RpcNotification,
} from '../../src/shared/protocol.js'
import { isRecord } from '../../src/shared/protocol.js'
import type {
  ClientConversationService,
} from './session-api.js'
import type {
  ClientThreadStatusService,
  ClientThreadStatusSnapshot,
  ThreadBlockedKind,
} from './thread-status-api.js'
import styles from './thread-status.css'

interface ThreadStatusConfig {
  finishedRetentionMs?: number
  visibleFinishedMs?: number
  outcomeSettleMs?: number
}

interface PersistedThreadStatus {
  version: 1
  finished: Array<[string, number]>
  /** Added after version 1 shipped. Older stores omit it. */
  failed?: string[]
}

const STORAGE_KEY = 'codex-cordis.thread-status'
const DEFAULT_FINISHED_RETENTION_MS = 24 * 60 * 60 * 1_000
const DEFAULT_VISIBLE_FINISHED_MS = 5_000
// Codex removes a thread from `activeThreadIds` just before it forwards the
// `turn/completed` notification that says whether the turn failed.
const DEFAULT_OUTCOME_SETTLE_MS = 1_000

function duration(value: number | undefined, fallback: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value!)) : fallback
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function readPersisted(storage: Storage | undefined): { finished: Map<string, number>; failed: Set<string> } {
  const empty = { finished: new Map<string, number>(), failed: new Set<string>() }
  if (!storage) return empty
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Partial<PersistedThreadStatus> | null
    if (value?.version !== 1 || !Array.isArray(value.finished)) return empty
    const finished = new Map(value.finished.filter((entry): entry is [string, number] => (
      Array.isArray(entry)
      && typeof entry[0] === 'string'
      && typeof entry[1] === 'number'
      && Number.isFinite(entry[1])
    )))
    const failed = new Set(Array.isArray(value.failed)
      ? value.failed.filter((id): id is string => typeof id === 'string' && finished.has(id))
      : [])
    return { finished, failed }
  } catch {
    return empty
  }
}

function notificationThreadId(notification: RpcNotification): string | undefined {
  const params = notification.params
  if (typeof params?.threadId === 'string') return params.threadId
  const thread = isRecord(params?.thread) ? params.thread : undefined
  if (typeof thread?.id === 'string') return thread.id
  const turn = isRecord(params?.turn) ? params.turn : undefined
  return typeof turn?.threadId === 'string' ? turn.threadId : undefined
}

function requestThreadId(params: Record<string, unknown>): string | undefined {
  // Older Codex approval requests name the thread as a conversation.
  return notificationThreadId({ method: '', params })
    ?? (typeof params.conversationId === 'string' ? params.conversationId : undefined)
}

/** Server requests that stop a turn until the user responds. */
export function requestBlockedKind(method: string): ThreadBlockedKind | undefined {
  if (/requestUserInput|elicitation/i.test(method)) return 'question'
  if (/approval/i.test(method)) return 'permission'
  return undefined
}

function activeThreadIds(event: HarnessEvent): readonly string[] | undefined {
  if (event.type === 'snapshot') return event.payload.codex.activeThreadIds
  if (event.type === 'codex.status') return event.payload.activeThreadIds
  return undefined
}

function agentChats(snapshot: HarnessSnapshot | undefined): AgentChat[] {
  return Object.values(snapshot?.extensions ?? {}).flatMap((value) => {
    const chat = value as unknown as AgentChat | undefined
    return chat?.summary && isAgentChatId(chat.summary.id) ? [chat] : []
  })
}

/**
 * Collects every chat that is waiting for the user. Codex reports this two
 * ways, through its pending server requests and through thread flags, and
 * Agent chats keep their own request lists.
 */
export function blockedThreads(snapshot: HarnessSnapshot | undefined): Map<string, ThreadBlockedKind> {
  const blocked = new Map<string, ThreadBlockedKind>()
  const add = (threadId: string | undefined, kind: ThreadBlockedKind | undefined): void => {
    if (threadId && kind && !blocked.has(threadId)) blocked.set(threadId, kind)
  }
  for (const request of snapshot?.pendingRequests ?? []) {
    if (request.params.isBlocking === false) continue
    add(requestThreadId(request.params), requestBlockedKind(request.method))
  }
  for (const [threadId, state] of Object.entries(snapshot?.codex.threadStates ?? {})) {
    if (state.status.type !== 'active') continue
    const flags = state.status.activeFlags ?? []
    if (flags.includes('waitingOnApproval')) add(threadId, 'permission')
    else if (flags.includes('waitingOnUserInput')) add(threadId, 'question')
  }
  for (const chat of agentChats(snapshot)) {
    for (const request of chat.requests ?? []) add(chat.summary.id, requestBlockedKind(request.method))
  }
  return blocked
}

/** How an Agent chat's last turn ended, judged when it returns to idle. */
function agentOutcome(chat: AgentChat | undefined): 'completed' | 'failed' | undefined {
  if (!chat || chat.turn !== 'idle') return undefined
  return chat.problem ? 'failed' : 'completed'
}

function sameBlocked(left: ReadonlyMap<string, ThreadBlockedKind>, right: ReadonlyMap<string, ThreadBlockedKind>): boolean {
  return left.size === right.size && [...left].every(([threadId, kind]) => right.get(threadId) === kind)
}

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export class ThreadStatusService implements ClientThreadStatusService {
  private readonly listeners = new Set<() => void>()
  private readonly running = new Set<string>()
  private readonly finished: Map<string, number>
  private readonly failed: Set<string>
  /** Finished Codex chats whose outcome has not arrived yet. */
  private readonly settling = new Map<string, number>()
  private blocked = new Map<string, ThreadBlockedKind>()
  private readonly storage = browserStorage()
  private readonly retentionMs: number
  private readonly visibleFinishedMs: number
  private readonly outcomeSettleMs: number
  private readonly disposeSession: () => void
  private readonly disposeEvents: () => void
  private expiryTimer?: number
  private visibleFinishedTimer?: number
  private activeThreadId: string | undefined
  private state: ClientThreadStatusSnapshot
  private disposed = false

  private readonly visibilityChanged = (): void => {
    if (visible() && this.activeThreadId) this.acknowledge(this.activeThreadId)
  }

  constructor(
    private readonly host: ClientHostService,
    private readonly session: ClientConversationService,
    config: ThreadStatusConfig = {},
  ) {
    this.retentionMs = duration(
      config.finishedRetentionMs,
      DEFAULT_FINISHED_RETENTION_MS,
      60_000,
    )
    this.visibleFinishedMs = duration(
      config.visibleFinishedMs,
      DEFAULT_VISIBLE_FINISHED_MS,
      1_000,
    )
    this.outcomeSettleMs = duration(config.outcomeSettleMs, DEFAULT_OUTCOME_SETTLE_MS, 0)
    const persisted = readPersisted(this.storage)
    this.finished = persisted.finished
    this.failed = persisted.failed
    this.activeThreadId = session.snapshot().threadId

    const current = host.snapshot().snapshot?.codex.activeThreadIds ?? []
    for (const threadId of current) this.running.add(threadId)
    for (const event of host.journal()) this.replay(event)
    this.blocked = blockedThreads(host.snapshot().snapshot)
    this.pruneFinished()
    if (this.activeThreadId && visible()) this.forget(this.activeThreadId)
    this.persistFinished()
    this.state = this.buildSnapshot(0)

    this.disposeSession = session.subscribe(() => this.syncSession())
    this.disposeEvents = host.onEvent((event) => this.receive(event))
    window.addEventListener('focus', this.visibilityChanged)
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.scheduleExpiry()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): ClientThreadStatusSnapshot => this.state

  acknowledge(threadId: string): void {
    if (!this.forget(threadId)) return
    this.persistFinished()
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeSession()
    this.disposeEvents()
    window.removeEventListener('focus', this.visibilityChanged)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    if (this.expiryTimer !== undefined) window.clearTimeout(this.expiryTimer)
    if (this.visibleFinishedTimer !== undefined) window.clearTimeout(this.visibleFinishedTimer)
    for (const timer of this.settling.values()) window.clearTimeout(timer)
    this.settling.clear()
    this.listeners.clear()
  }

  private replay(event: HarnessEvent): void {
    const active = activeThreadIds(event)
    if (active) {
      this.running.clear()
      for (const threadId of active) this.running.add(threadId)
      return
    }
    if (event.type !== 'codex.notification') return
    const threadId = notificationThreadId(event.payload)
    if (!threadId) return
    if (event.payload.method === 'turn/started') this.running.add(threadId)
    if (event.payload.method === 'turn/completed') this.running.delete(threadId)
  }

  private receive(event: HarnessEvent): void {
    const blockedChanged = this.refreshBlocked(event)
    const active = event.type === 'extensions.updated' ? this.host.snapshot().snapshot?.codex.activeThreadIds ?? [] : activeThreadIds(event)
    if (active) {
      const chats = new Map(agentChats(this.host.snapshot().snapshot).map((chat) => [chat.summary.id, chat]))
      const agentIds = [...chats.values()].flatMap((chat) => chat.turn !== 'idle' ? [chat.summary.id] : [])
      const next = new Set([...active, ...agentIds])
      const completed = [...this.running].filter((threadId) => !next.has(threadId))
      if (
        next.size === this.running.size
        && [...next].every((threadId) => this.running.has(threadId))
      ) {
        if (blockedChanged) this.emit()
        return
      }
      this.running.clear()
      for (const threadId of completed) {
        const outcome = agentOutcome(chats.get(threadId))
        this.finish(threadId, outcome ?? 'completed')
        if (!outcome && !isAgentChatId(threadId)) this.settle(threadId)
      }
      for (const threadId of next) {
        this.running.add(threadId)
        this.forget(threadId)
      }
      this.persistFinished()
      this.emit()
      if (completed.length) this.scheduleExpiry()
      for (const threadId of completed) this.scheduleVisibleAcknowledgement(threadId)
      return
    }
    if (event.type !== 'codex.notification') {
      if (blockedChanged) this.emit()
      return
    }
    const threadId = notificationThreadId(event.payload)
      ?? this.session.snapshot().threadId
    if (!threadId) return
    if (event.payload.method === 'turn/started') {
      const changed = !this.running.has(threadId) || this.finished.has(threadId)
      this.running.add(threadId)
      this.forget(threadId)
      if (!changed) return
      this.persistFinished()
      this.emit()
      return
    }
    if (event.payload.method !== 'turn/completed') return
    const turn = isRecord(event.payload.params?.turn) ? event.payload.params.turn : undefined
    this.running.delete(threadId)
    this.finish(threadId, turn?.status === 'failed' ? 'failed' : 'completed')
    this.persistFinished()
    this.emit()
    this.scheduleExpiry()
    this.scheduleVisibleAcknowledgement(threadId)
  }

  private refreshBlocked(event: HarnessEvent): boolean {
    if (
      event.type !== 'snapshot'
      && event.type !== 'codex.status'
      && event.type !== 'codex.serverRequest'
      && event.type !== 'codex.serverRequest.resolved'
      && event.type !== 'extensions.updated'
    ) return false
    const next = blockedThreads(this.host.snapshot().snapshot)
    if (sameBlocked(this.blocked, next)) return false
    this.blocked = next
    return true
  }

  private finish(threadId: string, outcome: 'completed' | 'failed'): void {
    this.finished.set(threadId, Date.now())
    if (outcome === 'failed') this.failed.add(threadId)
    else this.failed.delete(threadId)
    this.clearSettling(threadId)
  }

  /** Removes a chat's completion badge. Returns whether one was shown. */
  private forget(threadId: string): boolean {
    this.clearSettling(threadId)
    this.failed.delete(threadId)
    return this.finished.delete(threadId)
  }

  private settle(threadId: string): void {
    this.clearSettling(threadId)
    if (!this.outcomeSettleMs) return
    this.settling.set(threadId, window.setTimeout(() => {
      this.settling.delete(threadId)
      this.emit()
    }, this.outcomeSettleMs))
  }

  private clearSettling(threadId: string): void {
    const timer = this.settling.get(threadId)
    if (timer === undefined) return
    window.clearTimeout(timer)
    this.settling.delete(threadId)
  }

  private scheduleVisibleAcknowledgement(threadId: string): void {
    if (threadId !== this.activeThreadId || !visible()) return
    if (this.visibleFinishedTimer !== undefined) window.clearTimeout(this.visibleFinishedTimer)
    this.visibleFinishedTimer = window.setTimeout(() => {
      delete this.visibleFinishedTimer
      if (threadId === this.activeThreadId && visible()) this.acknowledge(threadId)
    }, this.visibleFinishedMs)
  }

  private syncSession(): void {
    const nextThreadId = this.session.snapshot().threadId
    if (nextThreadId === this.activeThreadId) return
    this.activeThreadId = nextThreadId
    if (nextThreadId && visible()) this.acknowledge(nextThreadId)
  }

  private pruneFinished(): void {
    const cutoff = Date.now() - this.retentionMs
    for (const [threadId, finishedAt] of this.finished) {
      if (finishedAt < cutoff) this.forget(threadId)
    }
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer !== undefined) window.clearTimeout(this.expiryTimer)
    const oldest = Math.min(...this.finished.values())
    if (!Number.isFinite(oldest)) {
      delete this.expiryTimer
      return
    }
    const delay = Math.max(1, Math.min(2_147_483_647, oldest + this.retentionMs - Date.now()))
    this.expiryTimer = window.setTimeout(() => {
      delete this.expiryTimer
      const before = this.finished.size
      this.pruneFinished()
      if (this.finished.size !== before) {
        this.persistFinished()
        this.emit()
      }
      this.scheduleExpiry()
    }, delay)
  }

  private persistFinished(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        finished: [...this.finished],
        ...(this.failed.size ? { failed: [...this.failed] } : {}),
      } satisfies PersistedThreadStatus))
    } catch {
      // Completion indicators remain available for this session when storage is unavailable.
    }
  }

  private buildSnapshot(revision: number): ClientThreadStatusSnapshot {
    const blocked = [...this.blocked].sort(([left], [right]) => left.localeCompare(right))
    return {
      revision,
      // A chat waiting for the user still has a turn in progress.
      running: [...new Set([...this.running, ...this.blocked.keys()])].sort(),
      finished: [...this.finished].sort(([leftId, leftTime], [rightId, rightTime]) => (
        rightTime - leftTime || leftId.localeCompare(rightId)
      )).map(([id]) => id),
      ...(blocked.length ? { blocked: Object.fromEntries(blocked) } : {}),
      ...(this.failed.size ? { failed: [...this.failed].sort() } : {}),
      ...(this.settling.size ? { settling: [...this.settling.keys()].sort() } : {}),
    }
  }

  private emit(): void {
    if (this.disposed) return
    this.state = this.buildSnapshot(this.state.revision + 1)
    for (const listener of this.listeners) listener()
  }
}

const threadStatusClient: Plugin<ThreadStatusConfig> = (ctx, config) => {
  const service = new ThreadStatusService(ctx.clientHost, ctx.clientConversation, config)
  ctx.provide('clientThreadStatus', service)
  ctx.clientUi.registerStyle(ctx, 'thread-status', String(styles))
  return () => service.dispose()
}

threadStatusClient.inject = ['clientHost', 'clientConversation', 'clientUi']
threadStatusClient.provide = 'clientThreadStatus'

export default threadStatusClient
