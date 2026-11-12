import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentSessionService } from '../program/plugins/agent-session.client.js'
import { RoutedSessionService, SessionService } from '../program/plugins/session.client.js'
import { initialAgentConfig } from '../program/plugins/agent-model-options.js'
import type { AgentChat } from '../program/plugins/agent-chats-api.js'
import { MODEL_DEFAULTS_SET, applyModelDefaultsUpdate, modelDefaults, type ModelDefaultsPreferences, type ModelDefaultsUpdate } from '../program/plugins/model-defaults-api.js'
import type { ClientHostService, ClientHostSnapshot } from '../src/client/plugin-api.js'
import type { AgentConfigOption } from '../src/server/services/agent-registry.js'
import type { HarnessEvent, HarnessSnapshot, JsonValue } from '../src/shared/protocol.js'

const chatId = 'acp-11111111-1111-1111-1111-111111111111'
const nativeThread = { id: 'native-thread', title: 'Saved', preview: '', cwd: '/repo', createdAt: 1, updatedAt: 2 }
const geminiConfig: AgentConfigOption[] = [{ id: '__model', name: 'Model', category: 'model', currentValue: 'auto',
  options: [{ value: 'auto', name: 'Auto' }, { value: 'gemini-4-argon', name: 'Gemini 4 Argon' }] }]
const draft = { text: 'Hello', images: [], attachments: [], skills: [] }

function fixture(preferences?: ModelDefaultsPreferences, configured = true) {
  const listeners = new Set<() => void>()
  const events = new Set<(event: HarnessEvent) => void>()
  const snapshot: HarnessSnapshot = {
    codex: { status: 'ready', activeThreadIds: [], models: [
      { id: 'one', displayName: 'One', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
      { id: 'two', displayName: 'Two', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
    ] },
    program: { revision: 1, profileText: '', plugins: [], files: [], tools: [], proposals: [] },
    projects: { revision: 0, projects: [] }, ui: { regions: [], surfaces: [], contributions: [] }, pendingRequests: [],
    extensions: { ...(configured ? { 'session.defaults': { model: 'one', effort: 'low', permissionMode: 'ask' } } : {}),
      'agent-chats': { providers: [
        { id: 'gemini', label: 'Gemini', capabilities: {}, configOptions: initialAgentConfig('gemini') },
        { id: 'claude', label: 'Claude', capabilities: {}, configOptions: initialAgentConfig('claude') },
      ], threads: [] } as unknown as JsonValue,
      ...(preferences ? { 'model-defaults': preferences as unknown as JsonValue } : {}),
    },
    server: { host: '127.0.0.1', port: 0, projectRoot: '/repo' },
  }
  const chat: AgentChat = { summary: { id: chatId, providerId: 'gemini', providerSessionId: 'session', cwd: '/repo',
    title: 'New Gemini chat', preview: '', createdAt: 1, updatedAt: 1 },
    permissionMode: 'ask', turn: 'idle', activities: [], requests: [], configOptions: structuredClone(geminiConfig) }
  const state: ClientHostSnapshot = { revision: 0, connectionEpoch: 1, connected: true, connection: 'online', snapshot }
  const command = vi.fn(async (type: string) => {
    if (type === 'thread.list' || type === 'skill.list') return []
    if (type === 'thread.open') return { summary: nativeThread, session: { workspace: '/repo', permissionMode: 'ask', model: 'one', effort: 'low' }, messages: [{ id: 'saved', role: 'user', text: 'Saved message' }] }
    throw Error(type)
  })
  const call = vi.fn(async (method: string, payload?: { configId?: string; value?: string } & Partial<ModelDefaultsUpdate>) => {
    if (method === MODEL_DEFAULTS_SET) {
      const next = applyModelDefaultsUpdate(modelDefaults(snapshot.extensions['model-defaults']) ?? { providerId: 'codex', choices: {} }, payload as ModelDefaultsUpdate)
      update(next)
      return next
    }
    if (method === 'agent-chats.configure') {
      const option = chat.configOptions?.find((option) => option.id === payload?.configId)
      if (!option || !payload?.value) throw Error('Unknown configuration')
      option.currentValue = payload.value
      return { configOptions: structuredClone(chat.configOptions) }
    }
    if (method === 'agent-chats.create' || method === 'agent-chats.open' || method === 'agent-chats.send') return structuredClone(chat)
    throw Error(method)
  })
  const host = { snapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    onEvent: (listener: (event: HarnessEvent) => void) => { events.add(listener); return () => events.delete(listener) },
    journal: () => [], programActivated: () => {}, command, call } as unknown as ClientHostService
  const native = new SessionService(host, { restoreActiveThread: false })
  const session = new AgentSessionService(native, host)
  const update = (next: ModelDefaultsPreferences) => {
    snapshot.extensions['model-defaults'] = next as unknown as JsonValue
    state.revision++
    for (const listener of listeners) listener()
  }
  return { session, native, host, call, command, chat, snapshot, update, close: () => { session.dispose(); native.dispose() } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('starts fresh panes with saved Gemini Argon and configures it before the first message', async () => {
  const f = fixture({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' } } })
  try {
    expect(f.session.snapshot()).toMatchObject({ providerId: 'gemini', session: { model: 'gemini-4-argon' } })
    expect(f.call).not.toHaveBeenCalled()
    await f.session.send(draft)
    expect(f.call.mock.calls.map(([method]) => method)).toEqual(['agent-chats.create', 'agent-chats.configure', 'agent-chats.send'])
    expect(f.call).toHaveBeenCalledWith('agent-chats.configure', { id: chatId, configId: '__model', value: 'gemini-4-argon' })
  } finally { f.close() }
})

it('inherits late preferences in an untouched draft while respecting explicit agent selection', () => {
  const f = fixture()
  try {
    f.update({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' } } })
    expect(f.session.snapshot().providerId).toBe('gemini')
    f.session.setProvider('claude')
    f.update({ providerId: 'codex', choices: {} })
    expect(f.session.snapshot().providerId).toBe('claude')
  } finally { f.close() }
})

it('returns to saved global defaults for a new chat after a manual provider choice', () => {
  const f = fixture({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' } } })
  try {
    f.session.setProvider('claude')
    f.session.newThread()
    expect(f.session.snapshot()).toMatchObject({ providerId: 'gemini', session: { model: 'gemini-4-argon' } })
    expect(f.call).not.toHaveBeenCalled()
  } finally { f.close() }
})

it('allows Agent default in a Gemini draft to override a saved Argon choice without sending a fake model ID', async () => {
  const f = fixture({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' } } })
  try {
    f.session.setModel('default')
    await f.session.send(draft)
    expect(f.call.mock.calls.map(([method]) => method)).toEqual([MODEL_DEFAULTS_SET, 'agent-chats.create', 'agent-chats.send'])
  } finally { f.close() }
})

it('applies remembered choices when manually selecting a provider that is not the global default', () => {
  const f = fixture({ providerId: 'codex', choices: { gemini: { model: 'gemini-4-argon' } } })
  try {
    f.session.setProvider('gemini')
    expect(f.session.snapshot().session.model).toBe('gemini-4-argon')
    expect(f.call).not.toHaveBeenCalled()
  } finally { f.close() }
})

it('applies late Codex defaults only to untouched drafts and resets explicit choices for a new chat', async () => {
  const f = fixture()
  try {
    f.update({ providerId: 'codex', choices: { codex: { model: 'two', effort: 'high' } } })
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'high' })
    f.session.setModel('one')
    await Promise.resolve()
    f.update({ providerId: 'codex', choices: { codex: { model: 'two', effort: 'medium' } } })
    expect(f.session.snapshot().session).toMatchObject({ model: 'one', effort: 'low' })
    f.session.newThread()
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'medium' })
  } finally { f.close() }
})

it('retains a reopened native chat and its model when global defaults change to Gemini', async () => {
  const f = fixture()
  try {
    await f.session.openThread(nativeThread)
    f.update({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' }, codex: { model: 'two', effort: 'high' } } })
    expect(f.session.snapshot()).toMatchObject({ providerId: 'codex', threadId: nativeThread.id, session: { model: 'one', effort: 'low' } })
    expect(f.call).not.toHaveBeenCalled()
  } finally { f.close() }
})

it('retains restored native model and effort when the first defaults arrive after the chat opens', async () => {
  const f = fixture(undefined, false)
  try {
    f.command.mockImplementation(async (type: string) => {
      if (type === 'thread.list' || type === 'skill.list') return []
      if (type === 'thread.open') return { summary: nativeThread,
        session: { workspace: '/repo', permissionMode: 'ask', model: 'two', effort: 'high' },
        messages: [{ id: 'saved', role: 'user', text: 'Saved message' }] }
      throw Error(type)
    })
    await f.session.openThread(nativeThread)
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'high' })
    f.update({ providerId: 'codex', choices: { codex: { model: 'one', effort: 'low' } } })
    expect(f.session.snapshot()).toMatchObject({ providerId: 'codex', threadId: nativeThread.id,
      session: { model: 'two', effort: 'high' } })
  } finally { f.close() }
})

it('configures a saved model before validating its reasoning against the returned catalog', async () => {
  const f = fixture({ providerId: 'claude', choices: { claude: { model: 'opus', effort: 'max' } } })
  const model: AgentConfigOption = { id: 'model', name: 'Model', category: 'model', currentValue: 'opus',
    options: [{ value: 'sonnet', name: 'Sonnet' }, { value: 'opus', name: 'Opus' }] }
  const effort: AgentConfigOption = { id: 'effort', name: 'Reasoning', category: 'thought_level', currentValue: 'max',
    options: [{ value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] }
  try {
    const catalog = f.snapshot.extensions['agent-chats'] as unknown as { providers: { id: string; configOptions?: AgentConfigOption[] }[] }
    catalog.providers.find((provider) => provider.id === 'claude')!.configOptions = [effort, model]
    f.update({ providerId: 'claude', choices: { claude: { model: 'opus', effort: 'max' } } })
    f.chat.configOptions = [{ ...effort, currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
      { ...model, currentValue: 'sonnet' }]
    f.call.mockImplementation(async (method: string, payload?: { configId?: string; value?: string }) => {
      if (method === 'agent-chats.configure') {
        const option = f.chat.configOptions?.find((option) => option.id === payload?.configId)
        if (!option || !payload?.value || !option.options.some((choice) => choice.value === payload.value)) throw Error('Unavailable configuration')
        option.currentValue = payload.value
        if (payload.configId === 'model') f.chat.configOptions![0] = { ...effort, currentValue: 'high' }
        return { configOptions: structuredClone(f.chat.configOptions) }
      }
      if (method === 'agent-chats.create' || method === 'agent-chats.send') return structuredClone(f.chat)
      throw Error(method)
    })
    await f.session.send(draft)
    expect(f.call.mock.calls.map(([method, payload]) => [method, payload?.configId])).toEqual([
      ['agent-chats.create', undefined], ['agent-chats.configure', 'model'],
      ['agent-chats.configure', 'effort'], ['agent-chats.send', undefined],
    ])
  } finally { f.close() }
})

it('rejects an unavailable saved model before sending, leaving the actual choices visible', async () => {
  const f = fixture({ providerId: 'gemini', choices: { gemini: { model: 'unavailable-model' } } })
  try {
    await expect(f.session.send(draft)).rejects.toThrow('unavailable')
    expect(f.call.mock.calls.map(([method]) => method)).toEqual(['agent-chats.create'])
    expect(f.session.snapshot().threadId).toBe(chatId)
    expect(f.session.snapshot().models?.map((model) => model.id)).toContain('gemini-4-argon')
  } finally { f.close() }
})

it('remembers explicit native model and reasoning choices without resetting reasoning on the same model', () => {
  const f = fixture({ providerId: 'codex', choices: { codex: { model: 'one', effort: 'low' }, gemini: { model: 'gemini-4-argon' } } })
  try {
    f.session.setModel('two')
    f.session.setEffort('high')
    f.session.setModel('two')
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'high' })
    expect(f.call.mock.calls.filter(([method]) => method === MODEL_DEFAULTS_SET)).toHaveLength(2)
    f.session.setEffort('unsupported')
    expect(f.session.snapshot().session.effort).toBe('high')
    expect(f.call.mock.calls.filter(([method]) => method === MODEL_DEFAULTS_SET)).toHaveLength(2)
    f.session.newThread()
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'high' })
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])).toEqual({ providerId: 'codex', choices: {
      codex: { model: 'two', effort: 'high' }, gemini: { model: 'gemini-4-argon' },
    } })
  } finally { f.close() }
})

it('uses an in-flight explicit choice in immediate new chats and independent panes', async () => {
  const f = fixture({ providerId: 'codex', choices: { codex: { model: 'one', effort: 'low' } } })
  let acknowledge!: (value: ModelDefaultsPreferences) => void
  f.call.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve }))
  let fresh: SessionService | undefined
  try {
    f.session.setModel('two')
    f.session.newThread()
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'medium' })
    fresh = new SessionService(f.host, { restoreActiveThread: false })
    expect(fresh.snapshot().session).toMatchObject({ model: 'two', effort: 'medium' })
    expect(f.command).not.toHaveBeenCalled()
    const next: ModelDefaultsPreferences = { providerId: 'codex', choices: { codex: { model: 'two', effort: 'medium' } } }
    f.update(next)
    acknowledge(next)
    await Promise.resolve()
  } finally { fresh?.dispose(); f.close() }
})

it('remembers a provider choice without changing the default agent or another open thread', async () => {
  const f = fixture({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' }, codex: { model: 'one', effort: 'low' } } })
  const other = new SessionService(f.host, { restoreActiveThread: false })
  try {
    await other.openThread(nativeThread)
    f.session.setProvider('codex')
    f.session.setModel('two')
    f.session.setEffort('high')
    expect(other.snapshot().session).toMatchObject({ model: 'one', effort: 'low' })
    f.session.newThread()
    expect(f.session.snapshot()).toMatchObject({ providerId: 'gemini', session: { model: 'gemini-4-argon' } })
    f.session.setProvider('codex')
    expect(f.session.snapshot().session).toMatchObject({ model: 'two', effort: 'high' })
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.providerId).toBe('gemini')
  } finally { other.dispose(); f.close() }
})

it('remembers ACP draft choices and clears reasoning unavailable on the selected model', () => {
  const f = fixture({ providerId: 'claude', choices: { claude: { model: 'opus', effort: 'max' }, gemini: { model: 'gemini-4-argon' } } })
  try {
    f.session.setModel('sonnet')
    expect(f.session.snapshot().session).toMatchObject({ model: 'sonnet', effort: 'default' })
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'sonnet' })
    f.session.setEffort('high')
    f.session.newThread()
    expect(f.session.snapshot().session).toMatchObject({ model: 'sonnet', effort: 'high' })
    f.session.setModel('haiku')
    f.session.newThread()
    expect(f.session.snapshot().session.model).toBe('haiku')
    expect(f.session.snapshot().agentConfig?.some((option) => option.category === 'thought_level')).toBe(false)
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'haiku' })
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.gemini).toEqual({ model: 'gemini-4-argon' })
    expect(f.call.mock.calls.every(([method]) => method === MODEL_DEFAULTS_SET)).toBe(true)
  } finally { f.close() }
})

it('remembers a custom Claude model and configures the same ID before submitting the first prompt', async () => {
  const f = fixture({ providerId: 'claude', choices: { claude: { model: 'sonnet' } } })
  f.chat.summary.providerId = 'claude'
  f.chat.configOptions = initialAgentConfig('claude')
  try {
    f.session.setModel('  claude-tenant-preview  ')
    expect(f.session.snapshot().session.model).toBe('claude-tenant-preview')
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude?.model).toBe('claude-tenant-preview')
    expect(f.call.mock.calls.every(([method]) => method === MODEL_DEFAULTS_SET)).toBe(true)
    f.session.newThread()
    expect(f.session.snapshot().session.model).toBe('claude-tenant-preview')
    await f.session.send(draft)
    expect(f.call).toHaveBeenCalledWith('agent-chats.configure', { id: chatId, configId: 'model', value: 'claude-tenant-preview' })
    const operations = f.call.mock.calls.map(([method]) => method)
    expect(operations.indexOf('agent-chats.configure')).toBeLessThan(operations.indexOf('agent-chats.send'))
    expect(f.session.snapshot().session.model).toBe('claude-tenant-preview')
  } finally { f.close() }
})

it('keeps a native custom model on its selected route after saving and opening a fresh chat', () => {
  const f = fixture({ providerId: 'codex', choices: {} })
  try {
    f.snapshot.codex.models = [...f.snapshot.codex.models, { id: 'listed-external', displayName: 'External model', modelProvider: 'external' }]
    f.update({ providerId: 'codex', choices: {} })
    f.session.setModel('listed-external')
    f.session.setModel('tenant/model-preview')
    expect(f.session.snapshot().session).toMatchObject({ model: 'tenant/model-preview', modelProvider: 'external' })
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.codex).toEqual({ model: 'tenant/model-preview', modelProvider: 'external' })
    f.session.newThread()
    expect(f.session.snapshot().session).toMatchObject({ model: 'tenant/model-preview', modelProvider: 'external' })
    expect(f.session.snapshot().session.effort).toBeUndefined()
    f.session.setModel('one')
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.codex?.modelProvider).toBeUndefined()
    expect(f.call.mock.calls.every(([method]) => method === MODEL_DEFAULTS_SET)).toBe(true)
  } finally { f.close() }
})

it('persists live ACP choices only after successful model-specific configuration', async () => {
  const f = fixture({ providerId: 'gemini', choices: { gemini: { model: 'gemini-4-argon' }, claude: { model: 'sonnet', effort: 'high' } } })
  const original = f.call.getMockImplementation()!
  f.chat.summary.providerId = 'claude'
  f.chat.configOptions = [{ id: 'model', name: 'Model', category: 'model', currentValue: 'sonnet', options: [{ value: 'sonnet', name: 'Sonnet' }, { value: 'opus', name: 'Opus' }] },
    { id: 'effort', name: 'Reasoning', category: 'thought_level', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }]
  try {
    await f.session.openThread(f.chat.summary)
    f.call.mockRejectedValueOnce(new Error('Unavailable configuration'))
    const rejected = f.session.setModel('opus')
    await expect(rejected).rejects.toThrow('Unavailable configuration')
    expect(f.call.mock.calls.some(([method]) => method === MODEL_DEFAULTS_SET)).toBe(false)
    f.call.mockImplementation(async (method, payload) => {
      if (method === 'agent-chats.configure' && payload?.configId === 'model') {
        f.chat.configOptions![0]!.currentValue = payload.value!
        f.chat.configOptions![1] = { id: 'effort', name: 'Reasoning', category: 'thought_level', currentValue: 'medium',
          options: [{ value: 'medium', name: 'Medium' }, { value: 'max', name: 'Max' }] }
        return { configOptions: structuredClone(f.chat.configOptions) }
      }
      return original(method, payload)
    })
    f.session.setModel('opus')
    f.session.setEffort('max')
    await vi.advanceTimersByTimeAsync(0)
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])).toEqual({ providerId: 'gemini', choices: {
      gemini: { model: 'gemini-4-argon' }, claude: { model: 'opus', effort: 'max' },
    } })
    expect(f.call.mock.calls.filter(([method]) => method === 'agent-chats.configure').map(([, payload]) => payload?.configId)).toEqual(['model', 'model', 'effort'])
  } finally { f.close() }
})

async function heldLiveModel() {
  const f = fixture({ providerId: 'claude', choices: { claude: { model: 'haiku' } } })
  f.chat.summary.providerId = 'claude'
  const model: AgentConfigOption = { id: 'model', name: 'Model', category: 'model', currentValue: 'haiku',
    options: [{ value: 'haiku', name: 'Haiku' }, { value: 'sonnet', name: 'Sonnet' }, { value: 'opus', name: 'Opus' }] }
  f.chat.configOptions = [model]
  await f.session.openThread(f.chat.summary)
  const original = f.call.getMockImplementation()!
  let release!: (value: { configOptions: AgentConfigOption[] }) => void
  f.call.mockImplementation(async (method, payload) => {
    if (method === 'agent-chats.configure' && payload?.value === 'opus') return new Promise((resolve) => { release = resolve })
    return original(method, payload)
  })
  f.session.setModel('opus')
  await vi.advanceTimersByTimeAsync(0)
  return { ...f, release: () => release({ configOptions: [{ ...model, currentValue: 'opus' },
    { id: 'effort', name: 'Reasoning', category: 'thought_level', currentValue: 'max', options: [{ value: 'max', name: 'Max' }] }] }) }
}

it.each(['new chat', 'another pane'] as const)('does not let an older live configuration overwrite a newer choice in %s', async (target) => {
  const f = await heldLiveModel()
  const native = target === 'another pane' ? new SessionService(f.host, { restoreActiveThread: false }) : undefined
  const other = native ? new AgentSessionService(native, f.host) : undefined
  try {
    if (target === 'new chat') f.session.newThread()
    const selected = other ?? f.session
    selected.setModel('sonnet')
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'sonnet' })
    f.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'sonnet' })
    selected.newThread()
    expect(selected.snapshot().session.model).toBe('sonnet')
  } finally { other?.dispose(); native?.dispose(); f.close() }
})

it('keeps a successful live choice after navigation alone', async () => {
  const f = await heldLiveModel()
  try {
    f.session.newThread()
    f.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'opus', effort: 'max' })
    expect(f.session.snapshot().session).toMatchObject({ model: 'opus', effort: 'max' })
  } finally { f.close() }
})

it('does not let a newer failed configuration suppress an earlier successful choice in another pane', async () => {
  const f = await heldLiveModel()
  const native = new SessionService(f.host, { restoreActiveThread: false })
  const other = new AgentSessionService(native, f.host)
  try {
    await other.openThread(f.chat.summary)
    f.call.mockRejectedValueOnce(new Error('Model unavailable'))
    other.setModel('sonnet')
    await vi.advanceTimersByTimeAsync(0)
    f.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'opus', effort: 'max' })
  } finally { other.dispose(); native.dispose(); f.close() }
})

it.each(['pending', 'completed'] as const)('does not let an older ACP result overwrite a newer %s Settings save', async (phase) => {
  const f = await heldLiveModel()
  const router = new RoutedSessionService(f.session)
  const original = f.call.getMockImplementation()!
  let finish!: () => Promise<void>
  f.call.mockImplementationOnce((method, payload) => new Promise((resolve) => {
    expect(method).toBe(MODEL_DEFAULTS_SET)
    finish = async () => { resolve(await original(method, payload)) }
  }))
  try {
    const saving = router.saveModelDefaults({ providerId: 'claude', model: 'sonnet', effort: 'high' })
    if (phase === 'completed') { await finish(); await saving }
    f.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.call.mock.calls.filter(([method]) => method === MODEL_DEFAULTS_SET)).toHaveLength(1)
    if (phase === 'pending') { await finish(); await saving }
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'sonnet', effort: 'high' })
    f.session.newThread()
    expect(f.session.snapshot().session).toMatchObject({ model: 'sonnet', effort: 'high' })
  } finally { router.dispose(); f.close() }
})

it('remembers the older successful ACP result when a newer Settings save fails', async () => {
  const f = await heldLiveModel()
  let reject!: (error: Error) => void
  f.call.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  try {
    const saving = f.session.saveModelDefaults({ providerId: 'claude', model: 'sonnet', effort: 'high' })
    f.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.call.mock.calls.filter(([method]) => method === MODEL_DEFAULTS_SET)).toHaveLength(1)
    reject(new Error('Disk full'))
    await expect(saving).rejects.toThrow('Disk full')
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])?.choices.claude).toEqual({ model: 'opus', effort: 'max' })
  } finally { f.close() }
})

it('keeps default-agent-only Settings changes independent of remembered model intent', async () => {
  const f = await heldLiveModel()
  try {
    await f.session.saveModelDefaults({ providerId: 'gemini' })
    f.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(modelDefaults(f.snapshot.extensions['model-defaults'])).toEqual({ providerId: 'gemini', choices: {
      claude: { model: 'opus', effort: 'max' }, gemini: {},
    } })
  } finally { f.close() }
})
