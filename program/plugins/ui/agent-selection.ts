import type { AgentConfigOption } from '../../../src/server/services/agent-registry.js'
import type { AgentConfigSelection, ClientSessionSnapshot } from '../session-api.js'

type Provider = NonNullable<ClientSessionSnapshot['providers']>[number]

function unavailableReason(provider: Provider): string | undefined {
  return provider.status !== 'ready' && provider.status !== 'starting' ? provider.error : undefined
}

export interface AgentPickerChoice {
  key: string
  providerId: string
  label: string
  description?: string
  selection?: AgentConfigSelection
  selected: boolean
}

export function agentSelection(providers: readonly Provider[], providerId: string, config: readonly AgentConfigOption[] = []) {
  const selected = providers.find((provider) => provider.id === providerId)
  const selectedConfig = config.find((option) => option.category === 'agent')
    ?? selected?.configOptions?.find((option) => option.category === 'agent')
  const agentId = selected?.agentId ?? providerId
  const locationId = selected?.location?.id ?? 'local'
  const locations = [...new Map(providers.map((provider) => {
    const location = provider.location ?? { id: 'local', label: 'Local' }
    return [location.id, location] as const
  })).values()].sort((a, b) => Number(b.id === 'local') - Number(a.id === 'local') || a.label.localeCompare(b.label)).map((location) => ({
    ...location,
    provider: providers.find((provider) => (provider.location?.id ?? 'local') === location.id
      && (provider.agentId ?? provider.id) === agentId),
  }))
  return {
    label: selectedConfig?.options.find((option) => option.value === selectedConfig.currentValue)?.name ?? selected?.label ?? 'Codex',
    locationId,
    locationLabel: selected?.location?.label ?? 'Local',
    locations,
    agentGroups: locations.map(({ id, label }) => ({
      id,
      label,
      unavailable: providers.filter((provider) => (provider.location?.id ?? 'local') === id && unavailableReason(provider))
        .map((provider) => ({ label: provider.label, reason: unavailableReason(provider)! })),
      agents: providers.filter((provider) => (provider.location?.id ?? 'local') === id && !unavailableReason(provider)).flatMap((provider): AgentPickerChoice[] => {
        const option = provider.configOptions?.find((option) => option.category === 'agent')
          ?? (provider.id === providerId ? selectedConfig : undefined)
        if (!option) return [{ key: provider.id, providerId: provider.id, label: provider.label, selected: provider.id === providerId }]
        const choices = [...option.options]
        const current = provider.id === providerId ? selectedConfig : undefined
        const bound = current?.options.find((choice) => choice.value === current.currentValue)
        if (bound && !choices.some((choice) => choice.value === bound.value)) choices.push(bound)
        return choices.map((choice) => ({
          key: JSON.stringify([provider.id, option.id, choice.value]),
          providerId: provider.id,
          label: choice.name,
          ...(choice.description ? { description: choice.description } : {}),
          selection: { configId: option.id, value: choice.value },
          selected: provider.id === providerId && choice.value === (selectedConfig ?? option).currentValue,
        }))
      }),
    })),
    agents: providers.filter((provider) => (provider.location?.id ?? 'local') === locationId),
  }
}
