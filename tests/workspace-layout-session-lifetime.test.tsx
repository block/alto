import type { Context } from 'cordis'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserPlugin, ClientHostService, ClientHostSnapshot, ClientSurfaceRenderer } from '../src/client/plugin-api.js'
import type { HarnessEvent, HarnessSnapshot, ProgramPluginView, ThreadSummary } from '../src/shared/protocol.js'
import type { ClientSessionFactoryService, ClientSessionHandle } from '../program/plugins/session-api.js'
import { BrowserProgramRuntime } from '../src/client/plugin-runtime.js'
import sessionPlugin from '../program/plugins/session.client.js'
import workspaceLayout, { restoreWorkspacePaneSession } from '../program/plugins/workspace-layout.client.js'
import type { WorkspacePaneNode } from '../program/plugins/workspace-layout-state.js'

const codexThread: ThreadSummary = { id: 'codex-thread', title: 'Codex chat', preview: '', cwd: '/repo', createdAt: 1, updatedAt: 2 }
const acpThread: ThreadSummary = { ...codexThread, id: 'acp-11111111-1111-1111-1111-111111111111', title: 'Gemini chat', providerId: 'gemini' }
function harness(): HarnessSnapshot {
  return {
    codex: { status: 'ready', models: [], activeThreadIds: [], threadStates: {}, threadSettings: {} },
    program: { revision: 1, profileText: '', plugins: [], files: [], tools: [], proposals: [] },
    projects: { revision: 0, projects: [] }, ui: { regions: [], surfaces: [], contributions: [] }, pendingRequests: [],
    extensions: { 'session.defaults': { permissionMode: 'ask' }, 'agent-chats': { providers: [{ id: 'gemini', label: 'Gemini', capabilities: {} }], threads: [acpThread] } },
    server: { port: 4317, host: '127.0.0.1', projectRoot: '/repo' },
  } as unknown as HarnessSnapshot
}
class Host implements ClientHostService {
  private state: ClientHostSnapshot = { revision: 0, connectionEpoch: 1, connected: true, connection: 'online', snapshot: harness() }
  private listeners = new Set<() => void>()
  private events = new Set<(event: HarnessEvent) => void>()
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  onEvent = (fn: (event: HarnessEvent) => void) => { this.events.add(fn); return () => this.events.delete(fn) }
  snapshot = () => this.state
  journal = () => []
  programActivated = () => {}
  command = vi.fn(async (type: string, payload?: Record<string, string>) => {
    if (type === 'thread.list') return [codexThread]
    if (type === 'skill.list') return []
    if (type === 'thread.open') return { summary: codexThread, messages: [{ id: 'codex-message', role: 'user', text: 'Saved Codex message' }] }
    if (type === 'chat.send') return { threadId: payload?.threadId, turn: {} }
    throw Error('Unexpected native command: ' + type)
  }) as unknown as ClientHostService['command']
  call = vi.fn(async (method: string) => {
    if (method === 'agent-chats.open') return { summary: acpThread, turn: 'idle', permissionMode: 'ask', requests: [], activities: [{ id: 'acp-message', kind: 'user', title: 'You', content: 'Saved Gemini message', timestamp: '' }] }
    if (method === 'agent-chats.send') return { ok: true }
    throw Error('Unexpected extension: ' + method)
  }) as unknown as ClientHostService['call']
  disconnect() {
    this.state = { ...this.state, revision: this.state.revision + 1, connected: false, connection: 'retrying' }
    for (const fn of this.listeners) fn()
  }
  reconnect() {
    this.state = { ...this.state, revision: this.state.revision + 1, connectionEpoch: this.state.connectionEpoch + 1, connected: true, connection: 'online', snapshot: harness() }
    for (const fn of this.listeners) fn()
    for (const fn of this.events) fn({ type: 'snapshot', payload: this.state.snapshot! })
  }
}
function view(id: string, hash: string, url: string): ProgramPluginView {
  return { id, name: id, description: id, protocolVersion: 1, depth: 0, enabled: true, effectiveEnabled: true, state: 'active', inject: [], provides: [], config: {}, isolate: {}, intercept: {},
    client: { module: 'plugins/' + id + '.client.ts', hash, url, loadedAt: '' } }
}
function surfaceFactory(renderer: ClientSurfaceRenderer): ClientSessionFactoryService {
  const element = (renderer as (props: unknown) => ReactElement<{ factory: ClientSessionFactoryService }>)({ surface: { id: 'workspace-layout', kind: 'custom' } })
  return element.props.factory
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps workspace chat surfaces usable while the shared session provider is replaced, then restores and reconnects Codex and Gemini panes', async () => {
  const host = new Host()
  let start!: () => void, finish!: () => void
  const started = new Promise<void>((resolve) => { start = resolve })
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const replacement: BrowserPlugin = async (ctx) => { start(); await pending; await (sessionPlugin as (ctx: Context) => unknown)(ctx) }
  if (sessionPlugin.inject) replacement.inject = sessionPlugin.inject
  if (sessionPlugin.provide) replacement.provide = sessionPlugin.provide
  if (sessionPlugin.resources) replacement.resources = sessionPlugin.resources
  const modules = new Map([
    ['/baseline', { default: sessionPlugin }], ['/replacement', { default: replacement }], ['/workspace', { default: workspaceLayout }],
  ])
  const runtime = new BrowserProgramRuntime(async (url) => modules.get(url)!, host)
  const views = (hash: string, url: string) => [view('session', hash, url), view('workspace-layout', 'workspace', '/workspace')]
  const handles: ClientSessionHandle[] = []
  const cleanup: Array<() => void> = []
  let swap: Promise<void> | undefined
  try {
    await runtime.reconcile(1, views('baseline', '/baseline'))
    const published = runtime.ui.renderer({ id: 'workspace-layout', kind: 'custom' })!
    expect(() => surfaceFactory(published)).not.toThrow()
    swap = runtime.reconcile(2, views('replacement', '/replacement'))
    await started
    // UI batching deliberately leaves the old registered surface published.
    expect(runtime.ui.renderer({ id: 'workspace-layout', kind: 'custom' })).toBe(published)
    expect(host.snapshot().connected).toBe(true)
    expect(() => surfaceFactory(published)).not.toThrow()
    finish()
    await swap
    const active = runtime.ui.renderer({ id: 'workspace-layout', kind: 'custom' })!
    const factory = surfaceFactory(active)
    host.disconnect()
    for (const thread of [codexThread, acpThread]) {
      const handle = factory.create({ initialWorkspace: '/repo', restoreActiveThread: false, persistActiveThread: false })
      handles.push(handle)
      expect(handle.session.snapshot().connected).toBe(false)
      cleanup.push(restoreWorkspacePaneSession(handle.session, { id: thread.id + '-pane', kind: 'chat', workspace: '/repo', thread } as WorkspacePaneNode))
    }
    host.reconnect()
    await vi.waitFor(() => {
      expect(handles[0]!.session.snapshot()).toMatchObject({ connected: true, providerId: 'codex', threadId: codexThread.id })
      expect(handles[1]!.session.snapshot()).toMatchObject({ connected: true, providerId: 'gemini', threadId: acpThread.id })
    })
    expect(handles[0]!.session.snapshot().activities.some((item) => item.content === 'Saved Codex message')).toBe(true)
    expect(handles[1]!.session.snapshot().activities.some((item) => item.content === 'Saved Gemini message')).toBe(true)
    host.disconnect()
    expect(handles.every((handle) => !handle.session.snapshot().connected)).toBe(true)
    host.reconnect()
    await vi.waitFor(() => expect(handles.every((handle) => handle.session.snapshot().connected)).toBe(true))
    const draft = { text: 'Continue', images: [], attachments: [], skills: [] }
    await handles[0]!.session.send(draft)
    await handles[1]!.session.send(draft)
    expect(host.command).toHaveBeenCalledWith('chat.send', expect.objectContaining({ threadId: codexThread.id, text: 'Continue' }))
    expect(host.call).toHaveBeenCalledWith('agent-chats.send', expect.objectContaining({ id: acpThread.id }))
  } finally {
    finish()
    await swap?.catch(() => {})
    cleanup.forEach((dispose) => dispose())
    handles.forEach((handle) => handle.dispose())
    await runtime.dispose()
  }
})
