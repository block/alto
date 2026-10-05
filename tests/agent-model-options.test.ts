import { describe, expect, it } from 'vitest'
import { draftAgentConfig, initialAgentConfig, resolveDraftConfigValue } from '../program/plugins/agent-model-options.js'
import type { AgentConfigOption } from '../src/server/services/agent-registry.js'

describe('Claude draft model choices', () => {
  const model = (options: AgentConfigOption['options']): AgentConfigOption => ({
    id: 'model', name: 'Model', category: 'model', currentValue: 'default', options,
  })

  it('offers Opus 5.5 and effort levels without overriding the agent defaults', () => {
    const config = initialAgentConfig('claude')
    expect(config[0]).toMatchObject({ currentValue: 'default', options: expect.arrayContaining([
      { value: 'claude-opus-5-5', name: 'Opus 5.5' },
    ]) })
    expect(config[1]?.currentValue).toBe('default')
    expect(config[1]?.options.map(option => option.value)).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(initialAgentConfig('pi')).toEqual([])
  })

  it.each(['opus', 'opus[1m]', 'claude-opus-5-5', 'claude-opus-5-5[1m]'])(
    'resolves an exact Opus 5.5 choice to the advertised %s option', (value) => {
      expect(resolveDraftConfigValue('claude', model([{ value, name: 'Opus 5.5' }]), 'claude-opus-5-5')).toBe(value)
    },
  )

  it.each(['Opus 4.6', 'Opus', 'Opus 5.50', 'Opus 5.5 fast'])(
    'does not infer Opus 5.5 from the ambiguous or different model %s', (name) => {
      expect(resolveDraftConfigValue('claude', model([{ value: 'opus[1m]', name }]), 'claude-opus-5-5')).toBeUndefined()
    },
  )

  it('preserves exact IDs and does not guess between multiple context variants', () => {
    const config = model([{ value: 'opus', name: 'Opus 5.5' }, { value: 'opus[1m]', name: 'Opus 5.5' }])
    expect(resolveDraftConfigValue('claude', config, 'opus')).toBe('opus')
    expect(resolveDraftConfigValue('claude', config, 'claude-opus-5-5')).toBeUndefined()
    expect(resolveDraftConfigValue('pi', model([{ value: 'opus[1m]', name: 'Opus 5.5' }]), 'opus')).toBeUndefined()
    expect(resolveDraftConfigValue('claude', model([{ value: 'opus[1m]', name: 'Opus 5.5' }]), 'opus')).toBe('opus[1m]')
  })

  it('resolves the current adapter catalog from its versioned description without changing the context variant', () => {
    const config = model([
      { value: 'opus', name: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks' },
      { value: 'opus[1m]', name: 'Opus (1M context)', description: 'Opus 5.5 with 1M context · Best for everyday, complex tasks' },
    ])
    config.currentValue = 'opus'
    expect(resolveDraftConfigValue('claude', config, 'claude-opus-5-5')).toBe('opus')
    config.currentValue = 'opus[1m]'
    expect(resolveDraftConfigValue('claude', config, 'claude-opus-5-5')).toBe('opus[1m]')
    expect(resolveDraftConfigValue('claude', config, 'claude-opus-5-4')).toBeUndefined()
  })

  it('offers effort when moving from a cached Haiku catalog to Opus, and hides it for Haiku', () => {
    const known = [model([{ value: 'haiku', name: 'Haiku 4.5' }, { value: 'opus[1m]', name: 'Opus 5.5' }])]
    known[0]!.currentValue = 'haiku'
    expect(initialAgentConfig('claude', known)).toEqual(known)
    const config = draftAgentConfig('claude', known, 'opus[1m]')
    expect(config.find(option => option.category === 'thought_level')?.options.map(option => option.value)).toContain('max')
    expect(draftAgentConfig('claude', initialAgentConfig('claude'), 'haiku').some(option => option.category === 'thought_level')).toBe(false)
    expect(known).toHaveLength(1)
  })
})
