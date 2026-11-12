import type { ClientHostService } from '../../src/client/plugin-api.js'
import type { JsonValue } from '../../src/shared/protocol.js'
import {
  MODEL_DEFAULTS_SET,
  MODEL_DEFAULTS_STATE,
  applyModelDefaultsUpdate,
  modelDefaults,
  modelDefaultsSaveFence,
  type ModelDefaultsPreferences,
  type ModelDefaultsSaveFence,
  type ModelDefaultsUpdate,
} from './model-defaults-api.js'

interface PendingChoice {
  update: ModelDefaultsUpdate
  intentOrder?: number
  source: JsonValue | undefined
  sourceFence: ModelDefaultsSaveFence | undefined
  saved?: boolean
  fence?: ModelDefaultsSaveFence
  expiresAt: number
}

export interface ModelChoiceIntent {
  readonly host: ClientHostService
  readonly providerId: string
  readonly order: number
}

interface IntentMemory {
  next: number
  successful: Map<string, number>
  pending: Set<ModelChoiceIntent>
  waiting: Map<ModelChoiceIntent, { choice: PendingChoice; send: () => void }>
}

const intents = new WeakMap<ClientHostService, IntentMemory>()

/** Capture user intent before an asynchronous agent configuration starts. */
export function beginModelChoice(host: ClientHostService, providerId: string): ModelChoiceIntent {
  let state = intents.get(host)
  if (!state) intents.set(host, state = { next: 0, successful: new Map(), pending: new Set(), waiting: new Map() })
  const intent = { host, providerId, order: ++state.next }
  state.pending.add(intent)
  return intent
}

function dropChoice(host: ClientHostService, choice: PendingChoice): void {
  const remaining = pendingChoices.get(host)?.filter((pending) => pending !== choice)
  if (remaining?.length) pendingChoices.set(host, remaining)
  else pendingChoices.delete(host)
}

function flushModelChoices(host: ClientHostService, state: IntentMemory): void {
  for (const [intent, waiting] of state.waiting) {
    if (intent.order < (state.successful.get(intent.providerId) ?? 0)) {
      state.waiting.delete(intent)
      dropChoice(host, waiting.choice)
    } else if (![...state.pending].some((newer) => newer.providerId === intent.providerId && newer.order > intent.order)) {
      state.waiting.delete(intent)
      waiting.send()
    }
  }
}

function finishModelChoice(intent: ModelChoiceIntent, succeeded: boolean): boolean {
  const state = intents.get(intent.host)!
  state.pending.delete(intent)
  if (succeeded && intent.order >= (state.successful.get(intent.providerId) ?? 0)) state.successful.set(intent.providerId, intent.order)
  flushModelChoices(intent.host, state)
  return succeeded && state.successful.get(intent.providerId) === intent.order
}

export function failModelChoice(intent: ModelChoiceIntent): void { finishModelChoice(intent, false) }

const pendingChoices = new WeakMap<ClientHostService, PendingChoice[]>()
const CHOICE_SAVE_LIFETIME_MS = 30_000

function wasPublished(choice: PendingChoice, source: JsonValue | undefined, preferences: ModelDefaultsPreferences | undefined): boolean {
  if (!choice.saved) return false
  const fence = modelDefaultsSaveFence(source)
  if (choice.fence) {
    if (!fence) return false
    if (fence.saveEpoch === choice.fence.saveEpoch) return fence.saveRevision >= choice.fence.saveRevision
    return fence.saveEpoch !== choice.sourceFence?.saveEpoch
  }
  // Compatibility with older servers: never mistake a matching pre-save value
  // for publication. The overlay remains bounded if no new state arrives.
  const stored = preferences?.choices[choice.update.providerId]
  return preferences !== undefined && source !== choice.source && (['model', 'modelProvider', 'effort'] as const).every((key) =>
    choice.update[key] === undefined || stored?.[key] === (choice.update[key] ?? undefined))
}

/** New panes can use an explicit selection before its disk save is acknowledged. */
export function rememberedModelDefaults(host: ClientHostService): ModelDefaultsPreferences | undefined {
  const source = host.snapshot().snapshot?.extensions[MODEL_DEFAULTS_STATE]
  const saved = modelDefaults(source)
  const updates = pendingChoices.get(host)
  if (!updates?.length) return saved
  const published = updates.map((choice) => wasPublished(choice, source, saved))
  const acknowledged = new Map<string, number>()
  for (const [index, choice] of updates.entries()) {
    if (published[index] && choice.intentOrder !== undefined) acknowledged.set(choice.update.providerId,
      Math.max(acknowledged.get(choice.update.providerId) ?? -1, choice.intentOrder))
  }
  const pending = updates.filter((choice, index) => choice.expiresAt > Date.now()
    && !published[index]
    && (choice.intentOrder === undefined || choice.intentOrder > (acknowledged.get(choice.update.providerId) ?? -1)))
  if (!pending.length) {
    pendingChoices.delete(host)
    return saved
  }
  pendingChoices.set(host, pending)
  return pending.reduce((preferences, choice) => applyModelDefaultsUpdate(preferences, choice.update),
    saved ?? { providerId: 'codex', choices: {} })
}

/** Only explicit model/reasoning actions write; reading a snapshot never saves. */
export function rememberModelChoice(host: ClientHostService, choice: ModelDefaultsUpdate,
  intent = beginModelChoice(host, choice.providerId)): void {
  if (intent.host !== host || intent.providerId !== choice.providerId) return
  if (!finishModelChoice(intent, true)) return
  const extensions = host.snapshot().snapshot?.extensions
  if (!extensions || !Object.hasOwn(extensions, MODEL_DEFAULTS_STATE)) return
  const update = { ...choice, selectProvider: false }
  const current = rememberedModelDefaults(host)
  const next = applyModelDefaultsUpdate(current ?? { providerId: 'codex', choices: {} }, update)
  const previousChoice = current?.choices[update.providerId]
  const nextChoice = next.choices[update.providerId]
  if (previousChoice?.model === nextChoice?.model && previousChoice?.effort === nextChoice?.effort) return
  const source = extensions[MODEL_DEFAULTS_STATE]
  const pending: PendingChoice = { update, intentOrder: intent.order, source, sourceFence: modelDefaultsSaveFence(source), expiresAt: Date.now() + CHOICE_SAVE_LIFETIME_MS }
  pendingChoices.set(host, [...(pendingChoices.get(host) ?? []), pending])
  const state = intents.get(host)!
  state.waiting.set(intent, { choice: pending, send: () => {
    void host.call(MODEL_DEFAULTS_SET, update as unknown as JsonValue).then((publication) => {
      pending.saved = true
      const fence = modelDefaultsSaveFence(publication)
      if (fence) pending.fence = fence
      rememberedModelDefaults(host)
    }, (error: unknown) => {
      dropChoice(host, pending)
      console.warn('Unable to remember the selected model', error)
    })
  } })
  flushModelChoices(host, state)
}

/** Settings routes through the session owner so bundle-local intent is shared. */
export async function saveModelDefaults(host: ClientHostService, update: ModelDefaultsUpdate): Promise<void> {
  const intent = update.model !== undefined || update.effort !== undefined ? beginModelChoice(host, update.providerId) : undefined
  const source = host.snapshot().snapshot?.extensions[MODEL_DEFAULTS_STATE]
  let publication: JsonValue
  try { publication = await host.call(MODEL_DEFAULTS_SET, update as unknown as JsonValue) }
  catch (error) { if (intent) failModelChoice(intent); throw error }
  if (intent && !finishModelChoice(intent, true)) return
  const saved = modelDefaults(publication)?.choices[update.providerId]
  const pending: PendingChoice = {
    update: intent && saved ? { ...update, model: saved.model ?? null, effort: saved.effort ?? null } : update,
    ...(intent ? { intentOrder: intent.order } : {}),
    source, sourceFence: modelDefaultsSaveFence(source), saved: true, expiresAt: Date.now() + CHOICE_SAVE_LIFETIME_MS,
  }
  const fence = modelDefaultsSaveFence(publication)
  if (fence) pending.fence = fence
  pendingChoices.set(host, [...(pendingChoices.get(host) ?? []), pending])
  rememberedModelDefaults(host)
}
