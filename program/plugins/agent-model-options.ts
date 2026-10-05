import type { AgentConfigOption } from '../../src/server/services/agent-registry.js'

const claudeEffort: AgentConfigOption = {
  id: 'effort', name: 'Reasoning', category: 'thought_level', currentValue: 'default',
  options: [
    { value: 'default', name: 'Agent default' },
    { value: 'low', name: 'Low' },
    { value: 'medium', name: 'Medium' },
    { value: 'high', name: 'High' },
    { value: 'xhigh', name: 'Extra high' },
    { value: 'max', name: 'Max' },
  ],
}

export function initialAgentConfig(agentId: string, known?: AgentConfigOption[]): AgentConfigOption[] {
  if (known?.some((option) => option.category === 'model')) return structuredClone(known)
  if (agentId !== 'claude') return []
  // Draft choices must not start a remote machine. Validate both the version
  // and effort against the running agent before sending the first prompt.
  // https://code.claude.com/docs/en/model-config
  return [{ id: 'model', name: 'Model', category: 'model', currentValue: 'default', options: [
    { value: 'default', name: 'Agent default' },
    { value: 'claude-opus-5-5', name: 'Opus 5.5' },
    { value: 'opus', name: 'Opus (latest)' },
    { value: 'sonnet', name: 'Sonnet (latest)' },
    { value: 'haiku', name: 'Haiku (latest)' },
  ] }, structuredClone(claudeEffort)]
}

export function draftAgentConfig(agentId: string, config: AgentConfigOption[], selectedModel?: string): AgentConfigOption[] {
  if (agentId !== 'claude') return config
  const model = config.find((option) => option.category === 'model')
  const value = selectedModel ?? model?.currentValue
  const choice = model?.options.find((option) => option.value === value)
  const family = /^(?:claude-)?(opus|sonnet|haiku)(?:$|[-\[])/i.exec(value ?? '')?.[1]?.toLowerCase()
    ?? /^(?:Claude )?(Opus|Sonnet|Haiku)\b/i.exec(choice?.name ?? '')?.[1]?.toLowerCase()
  const withoutEffort = config.filter((option) => option.category !== 'thought_level')
  if (family === 'haiku') return withoutEffort
  if (value === model?.currentValue && config.some((option) => option.category === 'thought_level')) return config
  if (family !== 'opus' && family !== 'sonnet') return withoutEffort
  const effort = structuredClone(claudeEffort)
  if (family === 'sonnet') effort.options = effort.options.filter((option) => !['xhigh', 'max'].includes(option.value))
  return [...withoutEffort, effort]
}

export function resolveDraftConfigValue(agentId: string, option: AgentConfigOption, value: string): string | undefined {
  if (option.options.some((candidate) => candidate.value === value)) return value
  if (agentId !== 'claude' || option.category !== 'model') return undefined

  // Claude can advertise a generic family name with the exact version in its
  // description. Preserve the current context variant when both are offered.
  const versioned = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?$/.exec(value)
  const expectedName = versioned ? `${versioned[1]} ${versioned[2]}${versioned[3] ? `.${versioned[3]}` : ''}` : undefined
  const candidates = option.options.filter((candidate) => {
    const id = candidate.value.replace(/\[1m\]$/, '')
    if (id === value) return true
    const description = candidate.description?.toLowerCase() ?? ''
    return expectedName !== undefined && id === versioned![1] && (
      candidate.name.replace(/^Claude /i, '').toLowerCase() === expectedName
      || description === expectedName
      || description.startsWith(`${expectedName} · `)
      || description.startsWith(`${expectedName} with `)
    )
  })
  return candidates.find((candidate) => candidate.value === option.currentValue)?.value
    ?? (candidates.length === 1 ? candidates[0]!.value : undefined)
}
