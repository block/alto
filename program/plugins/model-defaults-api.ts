import type { AgentConfigOption, AgentProviderSnapshot } from '../../src/server/services/agent-registry.js'
import { isRecord } from '../../src/shared/protocol.js'

export const MODEL_DEFAULTS_STATE = 'model-defaults'
export const MODEL_DEFAULTS_SET = 'model-defaults.set'
export const MODEL_DEFAULTS_DISCOVER = 'model-defaults.discover'
export const MODEL_DEFAULTS_STATUS = 'model-defaults.status'

export interface ModelDefaultsChoice {
  model?: string
  /** Native Codex route for a custom model absent from the catalog. */
  modelProvider?: string
  effort?: string
}

export interface ModelDefaultsPreferences {
  providerId: string
  choices: Record<string, ModelDefaultsChoice>
}

export interface ModelDefaultsUpdate {
  providerId: string
  model?: string | null
  modelProvider?: string | null
  effort?: string | null
  /** Remember this provider's choices without changing the default agent. */
  selectProvider?: boolean
}

export interface ModelDefaultsSaveFence {
  saveEpoch: string
  saveRevision: number
}

/** Publication metadata is separate from the persisted preference format. */
export function modelDefaultsSaveFence(value: unknown): ModelDefaultsSaveFence | undefined {
  if (!isRecord(value) || typeof value.saveEpoch !== 'string' || !value.saveEpoch
    || typeof value.saveRevision !== 'number' || !Number.isSafeInteger(value.saveRevision) || value.saveRevision < 0) return undefined
  return { saveEpoch: value.saveEpoch, saveRevision: value.saveRevision }
}

export function applyModelDefaultsUpdate(preferences: ModelDefaultsPreferences, update: ModelDefaultsUpdate): ModelDefaultsPreferences {
  const choice = { ...preferences.choices[update.providerId] }
  if (update.model !== undefined && update.modelProvider === undefined) delete choice.modelProvider
  for (const key of ['model', 'modelProvider', 'effort'] as const) {
    if (update[key] === null) delete choice[key]
    else if (typeof update[key] === 'string') choice[key] = update[key]
  }
  return {
    providerId: update.selectProvider === false ? preferences.providerId : update.providerId,
    choices: { ...preferences.choices, [update.providerId]: choice },
  }
}

export interface ModelDefaultsDiscovery {
  configOptions: AgentConfigOption[]
  provider: AgentProviderSnapshot
}

export interface ModelDefaultsStatus {
  preferences: ModelDefaultsPreferences
  providers: AgentProviderSnapshot[]
  nativeCodex: Pick<AgentProviderSnapshot, 'status' | 'activeSessionIds'>
}

export function validDefaultProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
}

export function validDefaultChoice(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value.length <= 256 && !/[\r\n\0]/.test(value)
}

/** Missing or malformed extension state does not change an existing draft. */
export function modelDefaults(value: unknown): ModelDefaultsPreferences | undefined {
  if (!isRecord(value) || !validDefaultProviderId(value.providerId) || !isRecord(value.choices)) return undefined
  const choices: Array<[string, ModelDefaultsChoice]> = []
  for (const [id, choice] of Object.entries(value.choices)) {
    if (!validDefaultProviderId(id) || !isRecord(choice)) return undefined
    if (choice.model !== undefined && !validDefaultChoice(choice.model)) return undefined
    if (choice.modelProvider !== undefined && !validDefaultChoice(choice.modelProvider)) return undefined
    if (choice.effort !== undefined && !validDefaultChoice(choice.effort)) return undefined
    choices.push([id, {
      ...(typeof choice.model === 'string' ? { model: choice.model } : {}),
      ...(typeof choice.modelProvider === 'string' ? { modelProvider: choice.modelProvider } : {}),
      ...(typeof choice.effort === 'string' ? { effort: choice.effort } : {}),
    }])
  }
  return { providerId: value.providerId, choices: Object.fromEntries(choices) }
}
