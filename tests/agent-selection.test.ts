import { describe, expect, it } from 'vitest'
import { agentSelection } from '../program/plugins/ui/agent-selection.js'

const providers = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'pi', label: 'Pi' },
  ...['codex', 'claude'].map((agentId) => ({
    id: `cloud-${agentId}`, agentId, label: agentId === 'codex' ? 'Codex' : 'Claude',
    location: { id: 'cloud', label: 'Cloud' },
  })),
]

describe('agent and location selection', () => {
  it('keeps the agent when moving between local and remote execution', () => {
    const local = agentSelection(providers, 'claude')
    const remote = local.locations.find((location) => location.id === 'cloud')!
    expect(remote.provider?.id).toBe('cloud-claude')
    const cloud = agentSelection(providers, remote.provider!.id)
    expect(cloud.label).toBe('Claude')
    expect(cloud.locationLabel).toBe('Cloud')
    expect(cloud.locations.find((location) => location.id === 'local')?.provider?.id).toBe('claude')
  })

  it('only offers agents at the current location', () => {
    expect(agentSelection(providers, 'codex').agents.map((agent) => agent.id)).toEqual(['codex', 'claude', 'pi'])
    expect(agentSelection(providers, 'cloud-codex').agents.map((agent) => agent.id)).toEqual(['cloud-codex', 'cloud-claude'])
  })

  it('also groups every provider for selection, including agents only available remotely', () => {
    const remote = { id: 'managed-worker', agentId: 'worker', label: 'Worker', location: { id: 'managed', label: 'Managed' } }
    const selection = agentSelection([...providers, remote], 'codex')
    expect(selection.agentGroups.map((group) => ({ id: group.id, agents: group.agents.map((agent) => agent.providerId) }))).toEqual([
      { id: 'local', agents: providers.slice(0, 3).map((provider) => provider.id) },
      { id: 'cloud', agents: providers.slice(3).map((provider) => provider.id) },
      { id: 'managed', agents: [remote.id] },
    ])
    expect(selection.locations.find((location) => location.id === 'managed')?.provider).toBeUndefined()
    expect(agentSelection([...providers, remote], remote.id).agentGroups.at(-1)?.agents[0]?.selected).toBe(true)
  })

  it('shows named agent choices directly and identifies the selected child from the chat configuration', () => {
    const option = { id: 'worker', name: 'Agent', category: 'agent', currentValue: 'first',
      options: [{ value: 'first', name: 'Primary worker' }, { value: 'second', name: 'Backup worker' }] }
    const remote = { id: 'hosted', label: 'Hosted', location: { id: 'hosted', label: 'Hosted' }, configOptions: [option] }
    const selection = agentSelection([...providers, remote], remote.id, [{ ...option, currentValue: 'second' }])
    expect(selection.label).toBe('Backup worker')
    expect(selection.agentGroups.find((group) => group.id === 'hosted')?.agents).toEqual([
      { key: JSON.stringify(['hosted', 'worker', 'first']), providerId: 'hosted', label: 'Primary worker', selection: { configId: 'worker', value: 'first' }, selected: false },
      { key: JSON.stringify(['hosted', 'worker', 'second']), providerId: 'hosted', label: 'Backup worker', selection: { configId: 'worker', value: 'second' }, selected: true },
    ])
  })

  it('keeps a bound agent visible when it is absent from the provider default catalog', () => {
    const bound = { id: 'worker', name: 'Agent', category: 'agent', currentValue: 'retained', options: [{ value: 'retained', name: 'Current worker' }] }
    const remote = { id: 'hosted', label: 'Hosted', configOptions: [{ ...bound, currentValue: 'new', options: [{ value: 'new', name: 'New worker' }] }] }
    const selection = agentSelection([remote], remote.id, [bound])
    expect(selection.label).toBe('Current worker')
    expect(selection.agentGroups[0]?.agents.filter((agent) => agent.selected).map((agent) => agent.label)).toEqual(['Current worker'])
  })

  it('does not invent a provider row when its managed agent catalog is empty', () => {
    const remote = { id: 'hosted', label: 'Hosted', location: { id: 'hosted', label: 'Hosted' },
      configOptions: [{ id: 'worker', name: 'Agent', category: 'agent', currentValue: '', options: [] }] }
    expect(agentSelection([...providers, remote], 'codex').agentGroups.find((group) => group.id === 'hosted')?.agents).toEqual([])
  })

  it('shows setup failures as location context without offering an unusable provider', () => {
    const remote = { id: 'hosted', label: 'Hosted', location: { id: 'hosted', label: 'Hosted' }, status: 'stopped' as const, error: 'Sign in in Settings first.' }
    const group = agentSelection([...providers, remote], 'codex').agentGroups.find((group) => group.id === 'hosted')
    expect(group?.agents).toEqual([])
    expect(group?.unavailable).toEqual([{ label: 'Hosted', reason: 'Sign in in Settings first.' }])
    expect(agentSelection([{ ...remote, status: 'ready' as const }], remote.id).agentGroups[0]?.agents).toHaveLength(1)
  })

  it('does not substitute another agent when a location cannot run the selected one', () => {
    const selection = agentSelection(providers, 'pi')
    expect(selection.locations.map((location) => location.id)).toEqual(['local', 'cloud'])
    expect(selection.locations.find((location) => location.id === 'cloud')?.provider).toBeUndefined()
  })
})
