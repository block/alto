import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import type {
  ModelOption,
  PermissionMode,
} from '../../src/shared/protocol.js'
import { isRecord } from '../../src/shared/protocol.js'
import { SESSION_THREAD_RENAME } from './session-api.js'

interface ConfigReadResponse {
  config?: unknown
}

interface CodexConfigAccess {
  readConfig?: () => Promise<unknown>
  setThreadName?: (threadId: string, name: string) => Promise<void>
  client?: {
    request<T>(method: string, params: unknown): Promise<T>
  }
}

function sessionDefaults(
  value: unknown,
  models: ModelOption[],
): {
  model?: string
  effort?: string
  permissionMode: PermissionMode
} {
  const config = isRecord(value) ? value : {}
  const model = typeof config.model === 'string'
    ? config.model
    : models.find((candidate) => candidate.isDefault)?.id
  const selected = models.find((candidate) => candidate.id === model)
    ?? models.find((candidate) => candidate.isDefault)
  const effort = typeof config.model_reasoning_effort === 'string'
    ? config.model_reasoning_effort
    : selected?.defaultReasoningEffort
  const fullAccess = config.default_permissions === ':danger-full-access'
    || config.sandbox_mode === 'danger-full-access'
  const permissionMode: PermissionMode = fullAccess
    ? 'full'
    : config.approvals_reviewer === 'auto_review'
      ? 'auto'
      : 'ask'

  return {
    permissionMode,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  }
}

async function setThreadName(codex: unknown, threadId: string, name: string): Promise<void> {
  const access = codex as CodexConfigAccess
  if (typeof access.setThreadName === 'function') {
    await access.setThreadName(threadId, name)
    return
  }
  if (!access.client) throw new Error('Codex thread naming is unavailable')
  await access.client.request('thread/name/set', { threadId, name })
}

async function readEffectiveConfig(codex: unknown): Promise<unknown> {
  const access = codex as CodexConfigAccess
  if (typeof access.readConfig === 'function') return access.readConfig()
  if (!access.client) throw new Error('Codex config access is unavailable')

  // This fallback lets a hot-reloaded Session fiber work with a desktop host
  // that was started before readConfig became part of CodexService.
  const response = await access.client.request<ConfigReadResponse>('config/read', {
    includeLayers: false,
  })
  return response.config
}

const session: HarnessPlugin = (ctx) => {
  let active = true
  ctx.effect(() => () => {
    active = false
  }, 'session.defaults.lifetime')

  const codex = ctx.codex
  const defaults = ctx.clientExtensions.registerState(
    ctx,
    'session.defaults',
    null,
  )
  // ACP chats can open while Codex is unavailable or still starting. Publish
  // its defaults when configuration arrives without blocking the session UI.
  void readEffectiveConfig(codex).then((config) => {
    if (active) defaults.update(sessionDefaults(config, codex.snapshot().models))
  }, () => {})
  ctx.clientExtensions.registerMethod(ctx, SESSION_THREAD_RENAME, async (payload) => {
    if (!isRecord(payload)) throw new Error('thread rename request is required')
    const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : ''
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!threadId) throw new Error('threadId is required')
    if (!name) throw new Error('chat name is required')
    await setThreadName(ctx.codex, threadId, name)
    return { threadId, name }
  })
}

session.inject = ['clientExtensions', 'codex']

export default session
