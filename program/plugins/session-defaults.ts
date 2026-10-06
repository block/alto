import { isRecord, type CodexSessionDefaults, type HarnessSnapshot, type PermissionMode } from '../../src/shared/protocol.js'
import { SESSION_WORKSPACE_STATE } from './session-api.js'

export function defaultWorkspace(harness: HarnessSnapshot | undefined): string {
  const workspace = harness?.extensions[SESSION_WORKSPACE_STATE]
  return typeof workspace === 'string' ? workspace : ''
}

export function configuredDefaults(
  harness: HarnessSnapshot | undefined,
): CodexSessionDefaults | undefined {
  const extension = harness?.extensions['session.defaults']
  if (
    isRecord(extension)
    && typeof extension.permissionMode === 'string'
    && ['ask', 'auto', 'full'].includes(extension.permissionMode)
  ) {
    return {
      permissionMode: extension.permissionMode as PermissionMode,
      ...(typeof extension.model === 'string' ? { model: extension.model } : {}),
      ...(typeof extension.effort === 'string' ? { effort: extension.effort } : {}),
    }
  }
  return harness?.codex.defaults
}
