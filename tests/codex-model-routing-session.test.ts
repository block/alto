import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientHostService, ClientHostSnapshot } from '../src/client/plugin-api.js'
import type {
  HarnessEvent,
  HarnessSnapshot,
  ModelOption,
  ThreadSummary,
  ThreadView,
} from '../src/shared/protocol.js'
import { SessionService } from '../program/plugins/session.client.js'
import { AgentSessionService } from '../program/plugins/agent-session.client.js'

const CUSTOM_PROVIDER = 'example-gateway'
const CUSTOM_MODEL = 'example-reasoner'

function harness(): HarnessSnapshot {
  return {
    codex: {
      status: 'ready',
      models: [
        {
          id: 'native-primary', displayName: 'Native primary', isDefault: true,
          defaultReasoningEffort: 'medium',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
        },
        {
          id: 'native-alternate', displayName: 'Native alternate',
          defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
        },
        {
          id: CUSTOM_MODEL, displayName: 'Example reasoner', modelProvider: CUSTOM_PROVIDER,
          defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
        },
        {
          id: 'example-fast', displayName: 'Example fast', modelProvider: CUSTOM_PROVIDER,
          defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
        },
        {
          id: 'other-reasoner', displayName: 'Other reasoner', modelProvider: 'other-gateway',
          defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
        },
      ],
      activeThreadIds: [],
      threadStates: {},
      threadSettings: {},
    },
    program: { revision: 0, profileText: '', plugins: [], files: [], tools: [], proposals: [] },
    projects: { revision: 0, projects: [] },
    ui: { regions: [], surfaces: [], contributions: [] },
    extensions: {
      'session.workspace': '/tmp/model-routing-project',
      'session.defaults': { model: 'native-primary', effort: 'medium', permissionMode: 'ask' },
    },
    pendingRequests: [],
    server: { port: 4317, host: '127.0.0.1', projectRoot: '/tmp/model-routing-project' },
  }
}

function summary(id: string, modelProvider?: string): ThreadSummary {
  return {
    id, title: id, preview: id, cwd: '/tmp/model-routing-project', createdAt: 1, updatedAt: 2,
    ...(modelProvider ? { modelProvider } : {}),
  }
}

function resumed(
  thread: ThreadSummary,
  model: string,
  modelProvider?: string,
): ThreadView {
  return {
    summary: thread,
    messages: [{ id: `${thread.id}-prompt`, role: 'user', text: 'Existing conversation' }],
    session: {
      workspace: thread.cwd, permissionMode: 'ask', model,
      effort: model === 'native-primary' ? 'medium' : 'high',
      ...(modelProvider ? { modelProvider } : {}),
    },
  }
}

class Host {
  programActivated(_revision: number): void {}
  private state: ClientHostSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly eventListeners = new Set<(event: HarnessEvent) => void>()
  readonly command = vi.fn(async (_type: string, _payload?: unknown): Promise<unknown> => [])
  readonly call = vi.fn(async (): Promise<unknown> => undefined)

  constructor(snapshot: HarnessSnapshot) {
    this.state = { revision: 0, connectionEpoch: 1, connection: 'online', connected: true, snapshot }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): ClientHostSnapshot => this.state
  journal = (): readonly HarnessEvent[] => []

  onEvent = (listener: (event: HarnessEvent) => void): (() => void) => {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  update(snapshot: HarnessSnapshot): void {
    this.state = { ...this.state, revision: this.state.revision + 1, snapshot }
    for (const listener of this.listeners) listener()
    for (const listener of this.eventListeners) listener({ type: 'snapshot', payload: snapshot })
  }
}

const cleanup: Array<() => void> = []

function fixture(snapshot = harness()) {
  const host = new Host(snapshot)
  const session = new SessionService(host as unknown as ClientHostService, { restoreActiveThread: false, persistActiveThread: false })
  cleanup.push(() => session.dispose())
  return { host, session }
}

function visibleModels(session: SessionService | AgentSessionService): ModelOption[] {
  const snapshot = session.snapshot()
  return snapshot.models ?? snapshot.harness?.codex.models ?? []
}

function provider(session: SessionService | AgentSessionService): string {
  const snapshot = session.snapshot()
  return snapshot.session.modelProvider ?? snapshot.harness?.codex.defaults?.modelProvider ?? 'openai'
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
})

afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('native Codex model routing in sessions', () => {
  it('keeps the native default and carries an explicitly selected model provider into creation and submission', async () => {
    const { host, session } = fixture()
    expect(session.snapshot().session.model).toBe('native-primary')
    expect(provider(session)).toBe('openai')
    expect(visibleModels(session).map((model) => model.id)).toContain(CUSTOM_MODEL)

    session.setModel(CUSTOM_MODEL)
    expect(session.snapshot().session).toMatchObject({ model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER, effort: 'high' })
    session.setModel('native-alternate')
    expect(provider(session)).toBe('openai')
    session.setModel(CUSTOM_MODEL)

    host.command.mockImplementation(async (type) => {
      if (type === 'thread.new') return { thread: summary('new-custom-thread', CUSTOM_PROVIDER) }
      if (type === 'chat.send') return { threadId: 'new-custom-thread' }
      return []
    })
    await session.send({ text: 'Inspect this repository', images: [], attachments: [], skills: [] })

    expect(host.command).toHaveBeenCalledWith('thread.new', expect.objectContaining({
      model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER,
    }))
    expect(host.command).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      threadId: 'new-custom-thread', model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER,
    }))
  })

  it('uses a routed model as a new-chat default only when that model is explicitly saved', () => {
    const snapshot = harness()
    snapshot.extensions['model-defaults'] = {
      providerId: 'codex', choices: { codex: { model: CUSTOM_MODEL, effort: 'high' } },
    }
    const { session } = fixture(snapshot)
    expect(session.snapshot().session).toMatchObject({ model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER })

    session.setModel('native-primary')
    session.newThread(null)
    expect(session.snapshot().session).toMatchObject({ model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER })
  })

  it('uses the native configured provider for catalog models without an explicit route', () => {
    const snapshot = harness()
    delete snapshot.extensions['session.defaults']
    snapshot.codex.defaults = {
      model: 'native-primary', modelProvider: 'native-gateway', effort: 'medium', permissionMode: 'ask',
    }
    const { session } = fixture(snapshot)
    expect(provider(session)).toBe('native-gateway')
    session.setModel('native-alternate')
    expect(provider(session)).toBe('native-gateway')
    session.setModel(CUSTOM_MODEL)
    expect(provider(session)).toBe(CUSTOM_PROVIDER)
  })

  it('clears a stale custom draft provider while an OpenAI chat is resuming, even when returned settings omit the provider', async () => {
    const { host, session } = fixture()
    session.setModel(CUSTOM_MODEL)
    const thread = summary('existing-native-thread', 'openai')
    let finishOpen!: (view: ThreadView) => void
    host.command.mockImplementation(async (type) => {
      if (type === 'thread.open') return new Promise<ThreadView>((resolve) => { finishOpen = resolve })
      return []
    })

    const opening = session.openThread(thread)
    expect(session.snapshot().threadId).toBe(thread.id)
    expect(provider(session)).toBe('openai')
    finishOpen(resumed(thread, 'native-primary'))
    await opening

    expect(provider(session)).toBe('openai')
    expect(session.snapshot().session.model).toBe('native-primary')
    expect(visibleModels(session).some((model) => model.modelProvider && model.modelProvider !== 'openai')).toBe(false)
    const before = { ...session.snapshot().session }
    expect(() => session.setModel(CUSTOM_MODEL)).toThrow()
    expect(session.snapshot().session).toEqual(before)
    session.setModel('native-alternate')
    expect(session.snapshot().session.model).toBe('native-alternate')
    expect(provider(session)).toBe('openai')
  })

  it.each(['session', 'summary'] as const)('restores a custom provider from authoritative %s metadata and permits only its models', async (source) => {
    const { host, session } = fixture()
    const thread = summary('existing-custom-thread', CUSTOM_PROVIDER)
    host.command.mockImplementation(async (type) => type === 'thread.open'
      ? resumed(thread, CUSTOM_MODEL, source === 'session' ? CUSTOM_PROVIDER : undefined)
      : [])

    await session.openThread(thread)
    expect(provider(session)).toBe(CUSTOM_PROVIDER)
    expect(visibleModels(session).map((model) => model.id).sort()).toEqual([CUSTOM_MODEL, 'example-fast'].sort())
    const before = { ...session.snapshot().session }
    expect(() => session.setModel('native-primary')).toThrow()
    expect(() => session.setModel('other-reasoner')).toThrow()
    expect(session.snapshot().session).toEqual(before)

    session.setModel('example-fast')
    expect(session.snapshot().session).toMatchObject({ model: 'example-fast', modelProvider: CUSTOM_PROVIDER, effort: 'low' })
  })

  it('does not apply a newly saved custom default to an existing OpenAI conversation', async () => {
    const snapshot = harness()
    const { host, session } = fixture(snapshot)
    const thread = summary('existing-native-thread', 'openai')
    host.command.mockImplementation(async (type) => type === 'thread.open' ? resumed(thread, 'native-primary', 'openai') : [])
    await session.openThread(thread)

    const updated = structuredClone(snapshot)
    updated.extensions['model-defaults'] = {
      providerId: 'codex', choices: { codex: { model: CUSTOM_MODEL, effort: 'high' } },
    }
    host.update(updated)

    expect(provider(session)).toBe('openai')
    expect(session.snapshot().session.model).toBe('native-primary')
    expect(visibleModels(session).map((model) => model.id)).not.toContain(CUSTOM_MODEL)
    session.newThread(null)
    expect(session.snapshot().session).toMatchObject({ model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER })
  })

  it('keeps local routed choices and their saved reasoning default out of a remote Codex draft', () => {
    const snapshot = harness()
    snapshot.extensions['model-defaults'] = {
      providerId: 'codex', choices: { codex: { model: CUSTOM_MODEL, effort: 'high' } },
    }
    snapshot.extensions['agent-chats'] = {
      providers: [{ id: 'remote-codex', agentId: 'codex', label: 'Remote Codex', capabilities: {} }], threads: [],
    }
    const { host, session: native } = fixture(snapshot)
    const session = new AgentSessionService(native, host as unknown as ClientHostService)
    cleanup.push(() => session.dispose())
    expect(provider(native)).toBe(CUSTOM_PROVIDER)

    session.setProvider('remote-codex')

    const ids = visibleModels(session).map((model) => model.id)
    expect(ids).toContain('native-primary')
    expect(ids).toContain('native-alternate')
    expect(ids).not.toContain(CUSTOM_MODEL)
    expect(ids).not.toContain('example-fast')
    expect(ids).not.toContain('other-reasoner')
    expect(session.snapshot().session).toMatchObject({ model: 'native-primary', effort: 'medium' })
    expect(session.snapshot().session.modelProvider).toBeUndefined()
    expect(host.command).not.toHaveBeenCalledWith('thread.new', expect.anything())
    expect(host.call).not.toHaveBeenCalled()
  })

  it('does not mutate shared native defaults when filtering them for remote Codex', () => {
    const snapshot = harness()
    delete snapshot.extensions['session.defaults']
    const defaults = {
      model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER, effort: 'high', permissionMode: 'ask' as const,
    }
    snapshot.codex.defaults = defaults
    snapshot.extensions['agent-chats'] = {
      providers: [{ id: 'remote-codex', agentId: 'codex', label: 'Remote Codex', capabilities: {} }], threads: [],
    }
    const before = structuredClone(defaults)
    const { host, session: native } = fixture(snapshot)
    const session = new AgentSessionService(native, host as unknown as ClientHostService)
    cleanup.push(() => session.dispose())

    session.setProvider('remote-codex')

    expect(session.snapshot().session).toMatchObject({ model: 'native-primary', effort: 'medium' })
    expect(host.snapshot().snapshot?.codex.defaults).toBe(defaults)
    expect(defaults).toEqual(before)
    native.newThread(null)
    expect(native.snapshot().session).toMatchObject({ model: CUSTOM_MODEL, modelProvider: CUSTOM_PROVIDER, effort: 'high' })
  })
})
