import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { AcpProcessProvider, type AcpConnectionFactory } from '../program/plugins/acp-provider.js'
import type { AgentConfigOption } from '../src/server/services/agent-registry.js'

function modelConfig(values: string[]): AgentConfigOption[] {
  return values.length ? [{ id: 'model', name: 'Model', category: 'model', currentValue: values[0]!,
    options: values.map(value => ({ value, name: value })) }] : []
}

function directConnection(agent: acp.AgentApp): AcpConnectionFactory {
  return client => {
    const connection = client.connect(agent)
    return { connection, close: () => connection.close() }
  }
}

describe('configured ACP draft choices', () => {
  it('makes configured choices available without starting an agent and isolates returned snapshots', async () => {
    const initialConfig = modelConfig(['configured/first', 'configured/second'])
    const openConnection = vi.fn<AcpConnectionFactory>()
    const provider = new AcpProcessProvider({ id: 'custom-agent', label: 'Custom agent', command: 'unused',
      initialConfig, openConnection })
    try {
      expect(provider.snapshot().configOptions).toEqual(initialConfig)
      const snapshot = provider.snapshot()
      snapshot.configOptions![0]!.options[0]!.name = 'Changed by a consumer'
      expect(provider.snapshot().configOptions).toEqual(initialConfig)
      expect(provider.snapshot().activeSessionIds).toEqual([])
      expect(openConnection).not.toHaveBeenCalled()
    } finally { await provider.stop() }
  })

  it.each([{ values: ['live/first', 'live/second'] }, { values: [] }])(
    'replaces configured draft choices with the discovered catalog $values, including an empty one', async ({ values }) => {
      const discovered = modelConfig(values)
      const agent = acp.agent()
        .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
        .onRequest('session/new', () => ({ sessionId: 'discovery',
          configOptions: discovered.map(option => ({ ...option, type: 'select' as const })) }))
      const provider = new AcpProcessProvider({ id: 'custom-agent', label: 'Custom agent', command: 'unused',
        initialConfig: modelConfig(['draft-only']), openConnection: directConnection(agent) })
      try {
        const session = await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
        expect(session.configOptions).toEqual(discovered)
        expect(provider.snapshot().configOptions).toEqual(discovered)
        await provider.closeSession(session.id)
        expect(provider.snapshot().configOptions).toEqual(discovered)
      } finally { await provider.stop() }
    },
  )

  it('rejects a draft-only model against the session catalog before making a configuration request', async () => {
    const configured = vi.fn((value: string) => value)
    const live = (currentValue = 'live/first'): acp.SessionConfigOption[] => [{
      ...modelConfig(['live/first', 'live/second'])[0]!, type: 'select', currentValue,
    }]
    const agent = acp.agent()
      .onRequest('initialize', () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
      .onRequest('session/new', () => ({ sessionId: 'session', configOptions: live() }))
      .onRequest('session/set_config_option', ctx => ({ configOptions: live(configured(String(ctx.params.value))) }))
    const provider = new AcpProcessProvider({ id: 'custom-agent', label: 'Custom agent', command: 'unused',
      initialConfig: modelConfig(['draft-only']), openConnection: directConnection(agent) })
    try {
      const session = await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
      await expect(provider.configure(session.id, 'model', 'draft-only')).rejects.toThrow('Invalid agent configuration')
      expect(configured).not.toHaveBeenCalled()
      expect((await provider.configure(session.id, 'model', 'live/second'))[0]?.currentValue).toBe('live/second')
      expect(configured).toHaveBeenCalledWith('live/second')
      expect(provider.snapshot().configOptions?.[0]?.currentValue).toBe('live/second')
    } finally { await provider.stop() }
  })
})
