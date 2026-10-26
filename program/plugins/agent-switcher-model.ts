import type { ModelOption } from '../../src/shared/protocol.js'
import type { ClientSessionService, ClientSessionSnapshot } from './session-api.js'
import { defaultModelProviders, defaultsModelChoices } from './ui/model-defaults.js'

type PickerProvider = ReturnType<typeof defaultModelProviders>[number]

export interface AgentPickerEffort {
  value: string
  label: string
  description?: string
}

export interface AgentPickerOption {
  key: string
  providerId: string
  providerLabel: string
  providerLocation: string
  modelId?: string
  modelLabel: string
  modelProvider?: string
  efforts: AgentPickerEffort[]
  defaultEffort?: string
  current: boolean
  disabledReason?: string
  searchText: string
}

export function providerSwitchLocked(state: Pick<ClientSessionSnapshot, 'activities' | 'threadId' | 'turn'>): boolean {
  return Boolean(state.threadId && state.activities.length) || state.turn.tag !== 'idle'
}

export function formatAgentEffort(effort: string): string {
  if (effort.toLocaleLowerCase() === 'xhigh') return 'XHigh'
  return `${effort.charAt(0).toLocaleUpperCase()}${effort.slice(1)}`
}

function providerLocation(provider: PickerProvider): string {
  return provider.location?.label ?? provider.remoteLocation
    ?? (provider.protocol === 'remote' ? 'Remote' : 'Local')
}

function optionKey(providerId: string, modelId: string | undefined): string {
  return `${providerId}:${modelId ?? '__default__'}`
}

function codexModelProvider(state: ClientSessionSnapshot): string {
  return state.session.modelProvider ?? state.harness?.codex.defaults?.modelProvider ?? 'openai'
}

function codexOptions(
  state: ClientSessionSnapshot,
  provider: PickerProvider,
  currentProvider: string,
  locked: boolean,
): AgentPickerOption[] {
  const currentModels = state.models ?? []
  const models = provider.id === currentProvider && currentModels.length
    ? currentModels
    : state.harness?.codex.models ?? []
  const activeModel = state.session.model
    ?? models.find((model) => model.isDefault)?.id
    ?? models[0]?.id
  const activeRoute = codexModelProvider(state)
  const location = providerLocation(provider)
  return models.map((model: ModelOption) => {
    const current = provider.id === currentProvider && model.id === activeModel
    const routeMismatch = provider.id === currentProvider
      && Boolean(state.threadId)
      && (model.modelProvider ?? state.harness?.codex.defaults?.modelProvider ?? 'openai') !== activeRoute
    const disabledReason = provider.id !== currentProvider && locked
      ? 'Start a new chat to switch agents.'
      : routeMismatch ? 'Start a new chat to switch model providers.' : undefined
    const efforts = (model.supportedReasoningEfforts ?? []).map((effort) => ({
      value: effort.reasoningEffort,
      label: formatAgentEffort(effort.reasoningEffort),
      ...(effort.description ? { description: effort.description } : {}),
    }))
    return {
      key: optionKey(provider.id, model.id),
      providerId: provider.id,
      providerLabel: provider.label,
      providerLocation: location,
      modelId: model.id,
      modelLabel: model.displayName,
      ...(model.modelProvider ? { modelProvider: model.modelProvider } : {}),
      efforts,
      ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}),
      current,
      ...(disabledReason ? { disabledReason } : {}),
      searchText: [
        provider.label, location, provider.agentId ?? provider.id,
        model.displayName, model.id, model.modelProvider ?? '',
        ...efforts.flatMap((effort) => [effort.value, effort.label, effort.description ?? '']),
      ].join(' ').toLocaleLowerCase(),
    }
  })
}

function configuredEffort(provider: PickerProvider): string | undefined {
  return provider.configOptions?.find((option) => option.category === 'thought_level')?.currentValue
}

function agentOptions(
  state: ClientSessionSnapshot,
  provider: PickerProvider,
  currentProvider: string,
  locked: boolean,
): AgentPickerOption[] {
  const location = providerLocation(provider)
  const catalog = defaultsModelChoices(provider, state.harness, undefined)
  const models = catalog.models
  const configuredModel = provider.configOptions?.find((option) => option.category === 'model')?.currentValue
  const currentModel = provider.id === currentProvider
    ? state.session.model ?? state.models?.find((model) => model.isDefault)?.id ?? configuredModel
    : undefined
  const disabledReason = provider.id !== currentProvider && locked
    ? 'Start a new chat to switch agents.' : undefined
  if (!models.length) {
    const defaultEffort = configuredEffort(provider)
    const efforts = catalog.efforts.map((choice) => ({
      value: choice.value,
      label: choice.name,
      ...(choice.description ? { description: choice.description } : {}),
    }))
    return [{
      key: optionKey(provider.id, undefined),
      providerId: provider.id,
      providerLabel: provider.label,
      providerLocation: location,
      modelLabel: 'Agent default',
      efforts,
      ...(defaultEffort ? { defaultEffort } : {}),
      current: provider.id === currentProvider && currentModel === undefined,
      ...(disabledReason ? { disabledReason } : {}),
      searchText: [provider.label, location, provider.agentId ?? provider.id, 'agent default',
        ...efforts.flatMap((effort) => [effort.value, effort.label, effort.description ?? ''])].join(' ').toLocaleLowerCase(),
    }]
  }
  return models.map((model) => {
    const choice = defaultsModelChoices(provider, state.harness, { model: model.value })
    const defaultEffort = configuredEffort(provider)
    const efforts = choice.efforts.map((effort) => ({
      value: effort.value,
      label: effort.name,
      ...(effort.description ? { description: effort.description } : {}),
    }))
    return {
      key: optionKey(provider.id, model.value),
      providerId: provider.id,
      providerLabel: provider.label,
      providerLocation: location,
      modelId: model.value,
      modelLabel: model.name,
      efforts,
      ...(defaultEffort ? { defaultEffort } : {}),
      current: provider.id === currentProvider && model.value === currentModel,
      ...(disabledReason ? { disabledReason } : {}),
      searchText: [provider.label, location, provider.agentId ?? provider.id, model.name, model.value,
        ...efforts.flatMap((effort) => [effort.value, effort.label, effort.description ?? ''])].join(' ').toLocaleLowerCase(),
    }
  })
}

/** All provider/model combinations, with the active combination first. */
export function buildAgentPickerOptions(state: ClientSessionSnapshot): AgentPickerOption[] {
  const currentProvider = state.providerId ?? 'codex'
  const locked = providerSwitchLocked(state)
  const providers = defaultModelProviders(state.harness).toSorted((left, right) => (
    Number(right.id === currentProvider) - Number(left.id === currentProvider)
  ))
  const options = providers.flatMap((provider) => (
    (provider.id === 'codex' || provider.agentId === 'codex')
      ? codexOptions(state, provider, currentProvider, locked)
      : agentOptions(state, provider, currentProvider, locked)
  ))
  return options.toSorted((left, right) => (
    Number(right.current) - Number(left.current)
    || Number(right.providerId === currentProvider) - Number(left.providerId === currentProvider)
  ))
}

export function initialAgentPickerKey(options: readonly AgentPickerOption[]): string | undefined {
  return options.find((option) => option.current)?.key
    ?? options.find((option) => !option.disabledReason)?.key
    ?? options[0]?.key
}

export function filterAgentPickerOptions(
  options: readonly AgentPickerOption[],
  query: string,
): AgentPickerOption[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return [...options]
  return options.filter((option) => terms.every((term) => option.searchText.includes(term)))
}

export function nextEnabledAgentPickerKey(
  options: readonly AgentPickerOption[],
  selectedKey: string | undefined,
  direction: 1 | -1,
): string | undefined {
  if (!options.length) return undefined
  const start = Math.max(0, options.findIndex((option) => option.key === selectedKey))
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + direction * step + options.length * step) % options.length
    const option = options[index]
    if (option && !option.disabledReason) return option.key
  }
  return selectedKey
}

export function preferredAgentEffort(
  state: ClientSessionSnapshot,
  option: AgentPickerOption,
): string | undefined {
  const available = option.efforts.map((effort) => effort.value)
  if (option.current && state.session.effort && available.includes(state.session.effort)) {
    return state.session.effort
  }
  if (option.defaultEffort && available.includes(option.defaultEffort)) return option.defaultEffort
  return available.find((effort) => effort === 'default') ?? available[0]
}

export function applyAgentPickerSelection(
  session: Pick<ClientSessionService, 'setEffort' | 'setModel' | 'setProvider' | 'snapshot'>,
  option: AgentPickerOption,
  effort: string | undefined,
): void {
  const state = session.snapshot()
  if (!state.connected) throw new Error('Reconnect to Alto before changing the agent.')
  if (option.disabledReason) throw new Error(option.disabledReason)
  if (effort !== undefined && !option.efforts.some((choice) => choice.value === effort)) {
    throw new Error('That reasoning level is not available for the selected model.')
  }
  if (option.providerId !== (state.providerId ?? 'codex')) {
    if (!session.setProvider) throw new Error('Agent switching is unavailable in this chat.')
    if (providerSwitchLocked(state)) throw new Error('Start a new chat to switch agents.')
    session.setProvider(option.providerId)
  }
  session.setModel(option.modelId)
  session.setEffort(effort)
}

