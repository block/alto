import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import type { CodexSnapshot } from '../../src/server/services/codex-service.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import { KEEP_AWAKE_SET, KEEP_AWAKE_STATE } from './keep-awake-api.js'
import { KeepAwakeController, localAgentsWorking, type IdleSleepBlocker } from './keep-awake-model.js'

function desktopBlocker(): IdleSleepBlocker | undefined {
  if (!process.versions.electron) return undefined
  return (createRequire(import.meta.url)('electron') as typeof import('electron')).powerSaveBlocker
}

const keepAwake: HarnessPlugin = async (ctx) => {
  let live = true
  ctx.effect(() => () => { live = false })
  const file = path.join(ctx.program.projectRoot, '.codex-cordis', 'keep-awake.json')
  let enabled = false
  try {
    const saved: unknown = JSON.parse(await readFile(file, 'utf8'))
    enabled = isRecord(saved) && saved.enabled === true
  } catch (error) {
    if (!(isRecord(error) && error.code === 'ENOENT')) throw error
  }
  if (!live) return

  const controller = new KeepAwakeController(desktopBlocker())
  const state = ctx.clientExtensions.registerState(ctx, KEEP_AWAKE_STATE, { ...controller.snapshot(), enabled })
  let extensions = ctx.clientExtensions.snapshot()
  let codex = ctx.codex.snapshot()
  let requests = ctx.codex.pendingRequests()
  let previous = ''
  const refresh = () => {
    if (!live) return
    const next = controller.update(enabled, localAgentsWorking(codex, requests, extensions))
    const serialized = JSON.stringify(next)
    if (serialized === previous) return
    previous = serialized
    state.update({ ...next })
  }
  let saving = Promise.resolve()
  const statusChanged = (snapshot: CodexSnapshot) => { codex = snapshot; refresh() }
  const requestsChanged = () => { requests = ctx.codex.pendingRequests(); refresh() }
  ctx.effect(() => {
    ctx.codex.on('status', statusChanged)
    ctx.codex.on('serverRequest', requestsChanged)
    ctx.codex.on('serverRequestResolved', requestsChanged)
    refresh()
    return () => {
      live = false
      ctx.codex.off('status', statusChanged)
      ctx.codex.off('serverRequest', requestsChanged)
      ctx.codex.off('serverRequestResolved', requestsChanged)
      controller.dispose()
      return saving.catch(() => {})
    }
  }, 'keepAwake.lifetime')
  ctx.on('clientExtensions/changed', (snapshot) => { extensions = snapshot; refresh() })
  ctx.clientExtensions.registerMethod(ctx, KEEP_AWAKE_SET, (payload) => {
    if (!isRecord(payload) || typeof payload.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    const next = payload.enabled
    const operation = saving.catch(() => {}).then(async () => {
      if (!live) throw new Error('Keep Awake is unavailable')
      await mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      await writeFile(temporary, JSON.stringify({ version: 1, enabled: next }) + '\n', { mode: 0o600 })
      await rename(temporary, file)
      if (!live) return
      enabled = next
      refresh()
    })
    saving = operation
    return operation.then(() => ({ ...controller.snapshot() }) as JsonValue)
  })
}

keepAwake.inject = ['codex', 'clientExtensions', 'program']
export default keepAwake
