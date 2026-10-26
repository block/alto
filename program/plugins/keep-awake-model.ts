import type { CodexSnapshot } from '../../src/server/services/codex-service.js'
import { isRecord, type JsonValue, type PendingServerRequest } from '../../src/shared/protocol.js'
import { AGENT_CHATS_STATE, isAgentChatId, type AgentChat } from './agent-chats-api.js'
import { ORCHESTRATOR_STATE, type OrchestratorSnapshot } from './orchestrator-api.js'
import type { KeepAwakeState } from './keep-awake-api.js'

export interface IdleSleepBlocker {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): boolean
}

const workingTask = (status: string): boolean => ['starting', 'working', 'stopping'].includes(status)

function blockingRequest(request: PendingServerRequest): boolean {
  return request.method.endsWith('/requestApproval')
    || request.method === 'item/tool/requestUserInput'
    || request.method === 'agent/requestUserInput'
}

export function localAgentsWorking(
  codex: CodexSnapshot,
  requests: readonly PendingServerRequest[],
  extensions: Record<string, JsonValue>,
): boolean {
  if (codex.status === 'ready') {
    const waiting = new Set(requests.filter(blockingRequest).map((request) => request.params.threadId))
    const threadWorking = (id: string): boolean => {
      const status = codex.threadStates[id]?.status
      return (!status || status.type === 'active') && !waiting.has(id) && !status?.activeFlags?.some((flag) => (
        flag === 'waitingOnApproval' || flag === 'waitingOnUserInput'
      ))
    }
    if (codex.activeThreadIds.some(threadWorking)) return true

    // The monitor also knows about children that were already running when
    // Alto connected. Their parent can finish while those children keep working.
    const orchestrator = extensions[ORCHESTRATOR_STATE] as unknown as OrchestratorSnapshot | undefined
    if (orchestrator?.tasks.some((task) => (
      !isAgentChatId(task.parentThreadId) && workingTask(task.status)
      && Boolean(task.threadId && threadWorking(task.threadId))
    ))) return true
  }

  const catalog = extensions[AGENT_CHATS_STATE]
  const localProviders = new Set(isRecord(catalog) && Array.isArray(catalog.providers)
    ? catalog.providers.filter((provider) => isRecord(provider)
      && provider.protocol === 'acp' && provider.status === 'ready').map((provider) => (provider as Record<string, unknown>).id)
    : [])
  for (const [key, value] of Object.entries(extensions)) {
    if (!key.startsWith(AGENT_CHATS_STATE + '.') || !isRecord(value)) continue
    const chat = value as unknown as AgentChat
    if (chat.remote || !localProviders.has(chat.summary.providerId)) continue
    const waiting = new Set(chat.requests.filter(blockingRequest).map((request) => (
      request.params.agentSessionId ?? chat.summary.providerSessionId
    )))
    if (chat.turn !== 'idle' && !waiting.has(chat.summary.providerSessionId)) return true
    if (chat.children?.some((child) => workingTask(child.task.status) && !waiting.has(child.sessionId))) return true
  }
  return false
}

export class KeepAwakeController {
  private id: number | undefined
  private disposed = false
  private enabled = false
  private working = false
  private problem: string | undefined

  constructor(private readonly blocker?: IdleSleepBlocker) {}

  update(enabled: boolean, working: boolean): KeepAwakeState {
    this.enabled = enabled
    this.working = working
    if (this.disposed) return this.snapshot()
    try {
      if (enabled && working && this.blocker) {
        this.id ??= this.blocker.start('prevent-app-suspension')
      } else if (this.id !== undefined) {
        this.blocker?.stop(this.id)
        this.id = undefined
      }
      this.problem = undefined
    } catch (error) {
      this.problem = error instanceof Error ? error.message : String(error)
    }
    return this.snapshot()
  }

  snapshot(): KeepAwakeState {
    return { enabled: this.enabled, available: Boolean(this.blocker), active: this.id !== undefined,
      ...(this.problem ? { problem: this.problem } : {}) }
  }

  dispose(): void {
    this.update(false, this.working)
    this.disposed = true
  }
}
