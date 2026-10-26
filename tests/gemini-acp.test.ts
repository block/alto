import { readFileSync } from 'node:fs'
import * as acp from '@agentclientprotocol/sdk'
import { Context } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import acpPlugin, { AcpProcessProvider, type AcpProcessProviderOptions } from '../program/plugins/acp-provider.js'
import { configOptions } from '../program/plugins/acp-format.js'
import { initialAgentConfig } from '../program/plugins/agent-model-options.js'
import { entriesOf, parseProgramProfile } from '../src/server/program-profile.js'
import { agentRegistryPlugin, type AgentEvent } from '../src/server/services/agent-registry.js'

const models = {
  currentModelId: 'auto',
  availableModels: [
    { modelId: 'auto', name: 'Auto', description: 'Let Gemini choose' },
    { modelId: 'gemini-test-flash', name: 'Flash' },
  ],
}
const modes = {
  currentModeId: 'default',
  availableModes: [{ id: 'default', name: 'Default', description: 'Prompts for approval' }, { id: 'plan', name: 'Plan' }],
}
const setupHint = 'Run `gemini` in a terminal to sign in, then select Gemini again.'
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

function fixture(agent: acp.AgentApp) {
  const provider = new AcpProcessProvider({
    id: 'gemini', label: 'Gemini', command: 'unused', setupHint,
    openConnection: client => {
      const toAgent = new TransformStream<Uint8Array>()
      const toClient = new TransformStream<Uint8Array>()
      const remote = agent.connect(acp.ndJsonStream(toClient.writable, toAgent.readable))
      const connection = client.connect(acp.ndJsonStream(toAgent.writable, toClient.readable))
      return { connection, close: () => { connection.close(); remote.close() } }
    },
  })
  cleanup.push(() => provider.stop())
  const events: AgentEvent[] = []
  provider.subscribe(event => events.push(event))
  return { provider, events }
}

function gemini() {
  return acp.agent({ name: 'gemini-cli' })
    .onRequest('initialize', () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, promptCapabilities: { image: true } },
    }))
}

describe('Gemini ACP integration', () => {
  it('registers Gemini lazily in the default profile and unloads only its provider', async () => {
    const profile = parseProgramProfile(readFileSync(new URL('../program/cordis.json', import.meta.url), 'utf8'))
    const entry = entriesOf(profile).find(({ entry }) => entry.id === 'gemini-acp')!.entry
    expect(entry).toMatchObject({ enabled: true, module: 'plugins/acp-provider.ts', config: {
      id: 'gemini', label: 'Gemini', command: 'gemini', args: ['--acp'], env: { GEMINI_CLI_NO_RELAUNCH: 'true' },
    } })
    const root = new Context()
    const registry = await root.plugin(agentRegistryPlugin)
    cleanup.push(() => registry.dispose())
    const fiber = await root.plugin(acpPlugin, entry.config as unknown as AcpProcessProviderOptions)
    cleanup.push(() => fiber.dispose())
    const provider = root.agents.provider('gemini').snapshot()
    expect(provider).toMatchObject({
      label: 'Gemini', protocol: 'acp', status: 'stopped', activeSessionIds: [],
      configOptions: [{ id: '__model', category: 'model', currentValue: 'default', options: expect.arrayContaining([
        { value: 'gemini-4-argon', name: 'Gemini 4 Argon' },
      ]) }],
    })
    expect(provider.configOptions).toEqual(initialAgentConfig('gemini'))
    await fiber.dispose()
    expect(() => root.agents.provider('gemini')).toThrow()
  })

  it('round-trips the legacy model API through the SDK transport and streams through the shared provider', async () => {
    const setModel = vi.fn()
    const setMode = vi.fn()
    const agent = gemini()
      .onRequest('session/new', ctx => {
        expect(ctx.params.mcpServers).toEqual([{ type: 'http', name: 'alto', url: 'http://127.0.0.1:1234/mcp', headers: [] }])
        return { sessionId: 'gemini-session', models, modes }
      })
      .onRequest('session/set_model', z.object({ sessionId: z.string(), modelId: z.string() }), ctx => {
        setModel(ctx.params)
        return {}
      })
      .onRequest('session/set_mode', ctx => { setMode(ctx.params); return {} })
      .onRequest('session/prompt', async ctx => {
        expect(ctx.params.prompt).toEqual([{ type: 'text', text: 'Hello Gemini' }])
        await ctx.client.notify('session/update', { sessionId: ctx.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello from Gemini' } } })
        return { stopReason: 'end_turn' }
      })
    const { provider, events } = fixture(agent)
    const session = await provider.createSession({ cwd: '/tmp', permissionMode: 'ask',
      mcpServers: [{ type: 'http', name: 'alto', url: 'http://127.0.0.1:1234/mcp' }] })
    expect(session.configOptions?.find(option => option.category === 'model')).toMatchObject({
      id: '__model', currentValue: 'auto', options: expect.arrayContaining([
        { value: 'auto', name: 'Auto', description: 'Let Gemini choose' },
        { value: 'gemini-test-flash', name: 'Flash' },
      ]),
    })
    await expect(provider.configure(session.id, '__model', 'unoffered-model')).rejects.toThrow('Invalid agent configuration')
    expect(setModel).not.toHaveBeenCalled()
    const configured = await provider.configure(session.id, '__model', 'gemini-test-flash')
    expect(setModel).toHaveBeenCalledWith({ sessionId: session.id, modelId: 'gemini-test-flash' })
    expect(configured.find(option => option.category === 'model')?.currentValue).toBe('gemini-test-flash')
    expect(events).toContainEqual(expect.objectContaining({ type: 'config.updated', providerId: 'gemini',
      sessionId: session.id, configOptions: configured }))
    await provider.configure(session.id, '__mode', 'plan')
    expect(setMode).toHaveBeenCalledWith({ sessionId: session.id, modeId: 'plan' })
    await provider.prompt(session.id, [{ type: 'text', text: 'Hello Gemini' }])
    await vi.waitFor(() => expect(events.some(event => event.type === 'turn.completed')).toBe(true))
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.delta', providerId: 'gemini',
      content: { type: 'text', text: 'Hello from Gemini' } }))
    expect(provider.snapshot().capabilities).toMatchObject({ images: true, mcpServers: true, steering: false })
  })

  it('resumes the exact saved session and can select Argon through the legacy setter', async () => {
    const load = vi.fn()
    const setModel = vi.fn()
    const { provider } = fixture(gemini().onRequest('session/load', ctx => {
      load(ctx.params)
      return { models, modes }
    }).onRequest('session/set_model', z.object({ sessionId: z.string(), modelId: z.string() }), ctx => {
      setModel(ctx.params)
      return {}
    }))
    const session = await provider.loadSession('saved-gemini', { cwd: '/tmp', permissionMode: 'ask' })
    expect(load).toHaveBeenCalledWith({ sessionId: 'saved-gemini', cwd: '/tmp', mcpServers: [] })
    expect(session).toMatchObject({ id: 'saved-gemini', providerId: 'gemini' })
    expect(session.configOptions?.some(option => option.category === 'model')).toBe(true)
    await provider.configure(session.id, '__model', 'gemini-4-argon')
    expect(setModel).toHaveBeenCalledWith({ sessionId: 'saved-gemini', modelId: 'gemini-4-argon' })
    expect(provider.snapshot().configOptions?.some(option => option.category === 'thought_level')).toBe(false)
  })

  it('keeps an explicit empty modern catalog authoritative after its discovery session closes', async () => {
    const { provider } = fixture(gemini().onRequest('session/new', () => ({
      sessionId: 'empty', configOptions: [], models, modes,
    })))
    const session = await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
    expect(session.configOptions).toEqual([])
    await expect(provider.configure(session.id, '__model', 'gemini-4-argon')).rejects.toThrow('Invalid agent configuration')
    await provider.closeSession(session.id)
    expect(provider.snapshot().configOptions).toEqual([])
  })

  it('uses modern setters even when a modern option has the legacy model ID', async () => {
    const setConfig = vi.fn()
    const setLegacyModel = vi.fn()
    const modern = [{ id: '__model', name: 'Model', type: 'select', category: 'model',
      currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }, { value: 'flash', name: 'Flash' }] }] satisfies acp.SessionConfigOption[]
    const { provider } = fixture(gemini()
      .onRequest('session/new', () => ({ sessionId: 'modern', configOptions: modern, models, modes }))
      .onRequest('session/set_config_option', ctx => {
        setConfig(ctx.params)
        return { configOptions: [{ ...modern[0]!, currentValue: String(ctx.params.value) }] }
      })
      .onRequest('session/set_model', z.unknown(), () => { setLegacyModel(); return {} }))
    const session = await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
    expect(session.configOptions?.[0]?.options).toHaveLength(2)
    await provider.configure(session.id, '__model', 'flash')
    expect(setConfig).toHaveBeenCalledWith({ sessionId: session.id, configId: '__model', value: 'flash' })
    expect(setLegacyModel).not.toHaveBeenCalled()
  })

  it('switches from legacy configuration to an authoritative modern update', async () => {
    let peer!: acp.AgentContext
    const setConfig = vi.fn()
    const modern = [{ id: '__model', name: 'Model', type: 'select', category: 'model',
      currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }] satisfies acp.SessionConfigOption[]
    const { provider, events } = fixture(gemini()
      .onRequest('session/new', ctx => { peer = ctx.client; return { sessionId: 'transition', models, modes } })
      .onRequest('session/set_config_option', ctx => {
        setConfig(ctx.params)
        return { configOptions: [{ ...modern[0]!, currentValue: String(ctx.params.value) }] }
      }))
    await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
    await peer.notify('session/update', { sessionId: 'transition', update: {
      sessionUpdate: 'config_option_update', configOptions: modern,
    } })
    await vi.waitFor(() => expect(events.some(event => event.type === 'config.updated')).toBe(true))
    await provider.configure('transition', '__model', 'b')
    expect(setConfig).toHaveBeenCalledWith({ sessionId: 'transition', configId: '__model', value: 'b' })
    await provider.closeSession('transition')
    expect(provider.snapshot().configOptions?.[0]?.currentValue).toBe('b')
    expect(provider.snapshot().configOptions?.[0]?.options).toHaveLength(2)
  })

  it('does not publish a delayed legacy model change after its session closes', async () => {
    let finish!: () => void
    const { provider, events } = fixture(gemini()
      .onRequest('session/new', () => ({ sessionId: 'legacy', models, modes }))
      .onRequest('session/set_model', z.unknown(), () => new Promise(resolve => { finish = () => resolve({}) })))
    await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
    const change = provider.configure('legacy', '__model', 'gemini-test-flash')
    const rejected = expect(change).rejects.toThrow('session closed')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await provider.closeSession('legacy')
    finish()
    await rejected
    expect(events.some(event => event.type === 'config.updated')).toBe(false)
    expect(provider.snapshot().configOptions?.[0]?.currentValue).toBe('auto')
  })

  it('does not publish a configuration change after its session is closed', async () => {
    let finish!: () => void
    const options = (value: string): acp.SessionConfigOption[] => [{ id: 'model', name: 'Model', type: 'select', category: 'model',
      currentValue: value, options: [{ value: 'auto', name: 'Auto' }, { value: 'flash', name: 'Flash' }] }]
    const { provider, events } = fixture(gemini()
      .onRequest('session/new', () => ({ sessionId: 'session', configOptions: options('auto') }))
      .onRequest('session/set_config_option', () => new Promise(resolve => { finish = () => resolve({ configOptions: options('flash') }) })))
    await provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })
    const change = provider.configure('session', 'model', 'flash')
    const rejected = expect(change).rejects.toThrow('session closed')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await provider.closeSession('session')
    finish()
    await rejected
    expect(events.some(event => event.type === 'config.updated')).toBe(false)
  })

  it.each(['create', 'load'])('gives sign-in guidance when authentication fails during %s', async operation => {
    const { provider } = fixture(gemini()
      .onRequest('session/new', () => { throw acp.RequestError.authRequired() })
      .onRequest('session/load', () => { throw acp.RequestError.authRequired() }))
    const options = { cwd: '/tmp', permissionMode: 'ask' as const }
    await expect(operation === 'create' ? provider.createSession(options) : provider.loadSession('saved', options)).rejects.toThrow(setupHint)
    expect(provider.snapshot().activeSessionIds).toEqual([])
  })

  it('retains protocol failures without presenting them as authentication failures', async () => {
    const { provider } = fixture(gemini().onRequest('session/new', () => { throw acp.RequestError.invalidParams() }))
    await expect(provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })).rejects.toMatchObject({ code: -32602 })
  })

  it('includes setup guidance when the Gemini executable is missing', async () => {
    const provider = new AcpProcessProvider({ id: 'gemini', label: 'Gemini', command: '/missing/alto-gemini-cli', setupHint })
    cleanup.push(() => provider.stop())
    await expect(provider.createSession({ cwd: '/tmp', permissionMode: 'ask' })).rejects.toThrow(setupHint)
    expect(provider.snapshot()).toMatchObject({ status: 'failed', error: expect.stringContaining('ENOENT') })
  })
})

it('uses standard ACP configuration before legacy model and mode catalogs, including an explicit empty list', () => {
  const response = { models, modes, configOptions: [{ id: 'model', name: 'Model', type: 'select' as const, category: 'model',
    currentValue: 'new', options: [{ value: 'new', name: 'New model' }] }] }
  expect(configOptions(response)).toEqual([{ id: 'model', name: 'Model', category: 'model', currentValue: 'new',
    options: [{ value: 'new', name: 'New model' }] }])
  expect(configOptions({ ...response, configOptions: [] })).toEqual([])
})

it('projects legacy model and mode catalogs without inventing reasoning options', () => {
  expect(configOptions({ models, modes })).toEqual([
    { id: '__model', name: 'Model', category: 'model', currentValue: 'auto', options: [
      { value: 'auto', name: 'Auto', description: 'Let Gemini choose' }, { value: 'gemini-test-flash', name: 'Flash' },
    ] },
    { id: '__mode', name: 'Mode', category: 'mode', currentValue: 'default', options: [
      { value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' },
    ] },
  ])
})
