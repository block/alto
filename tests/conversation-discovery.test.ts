import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { WorkspaceHistory } from '../program/plugins/workspace-history.js'
import { registerConversationTools, searchConversations } from '../program/plugins/conversation-tools.js'
import { AgentChats } from '../program/plugins/agent-chats.js'
import { applyWorkspaceCommand } from '../program/plugins/workspace-commands.client.js'
import type { ClientWorkspaceLayoutService } from '../program/plugins/workspace-layout-api.js'
import type { WorkspaceLayoutState } from '../program/plugins/workspace-layout-state.js'
import type { NamedConversation } from '../program/plugins/workspace-history-api.js'
import type { ThreadSummary } from '../src/shared/protocol.js'
import type { AgentRegistry } from '../src/server/services/agent-registry.js'

const cleanups: string[] = []
afterEach(async () => { for (const folder of cleanups.splice(0)) await rm(folder, { recursive: true, force: true }) })
const thread = (id = 'chat', title = 'Travel planning'): ThreadSummary => ({ id, title, preview: 'Planning a trip', cwd: '/repo', createdAt: 1, updatedAt: 2 })
const layout = (name: string, chat = thread()): WorkspaceLayoutState => ({
  version: 2, activeViewId: 'tab', views: [{
    id: 'tab', name, workspace: '/repo', focusedPaneId: 'pane',
    root: { type: 'pane', id: 'pane', workspace: '/repo', thread: chat },
  }],
})
async function history() {
  const folder = await mkdtemp(path.join(tmpdir(), 'alto-tab-names-')); cleanups.push(folder)
  const file = path.join(folder, 'names.json')
  const publish = vi.fn()
  const store = new WorkspaceHistory(file, publish)
  await store.load()
  return { store, publish, file }
}

describe('durable tab names', () => {
  it('retains old names through rename, closure, and process restart', async () => {
    const { store, file } = await history()
    store.observe(layout('jptrv')); await store.save()
    store.observe(layout('Japan travel')); await store.save()
    store.observe({ version: 2, activeViewId: '', views: [] }); await store.save()
    const restored = new WorkspaceHistory(file, vi.fn()); await restored.load()
    expect(restored.conversations()).toEqual([{ thread: thread(), titles: ['jptrv', 'Japan travel'] }])
    expect(restored.tabs()).toEqual([])
  })

  it('keeps all chats for colliding tab names and does not relabel old navigation entries', async () => {
    const { store } = await history()
    store.observe(layout('jptrv', thread('first')))
    store.observe(layout('Japan travel', thread('second')))
    store.observe(layout('jptrv', thread('third')))
    await store.save()
    expect(store.conversations().map((r) => [r.thread.id, r.titles])).toEqual([
      ['first', ['jptrv']], ['second', ['Japan travel']], ['third', ['jptrv']],
    ])
    expect(store.tabs()[0]).toMatchObject({ id: 'tab', title: 'jptrv', active: true, panes: [{ id: 'pane', kind: 'chat', threadId: 'third' }] })
  })

  it('ignores transient status changes and deduplicates names', async () => {
    const { store, publish } = await history()
    store.observe(layout('jptrv')); await store.save(); publish.mockClear()
    store.observe(layout('jptrv', { ...thread(), status: { type: 'active' } })); await store.save()
    expect(publish).not.toHaveBeenCalled()
    expect(store.conversations()[0]?.titles).toEqual(['jptrv'])
  })
})

function searchFixture(records: NamedConversation[] = []) {
  const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null })
  const messages = vi.fn().mockResolvedValue({ threads: [], snippets: {}, nextCursor: null })
  const access = { runtime: { request }, history: { conversations: () => records, tabs: () => [] }, messages }
  return { access, request, messages }
}

describe('conversation search tools', () => {
  it('finds a closed chat by its former name without scanning message bodies', async () => {
    const { store, file } = await history()
    store.observe(layout('jptrv')); await store.save()
    store.observe({ version: 2, activeViewId: '', views: [] }); await store.save()
    const restored = new WorkspaceHistory(file, vi.fn()); await restored.load()
    const f = searchFixture(restored.conversations())
    const result = await searchConversations(f.access, { query: 'JPTRV' })
    expect(result.results).toEqual([expect.objectContaining({ id: 'chat', aliases: ['jptrv'], matches: ['tab title'], openTabs: [] })])
    expect(f.request).toHaveBeenCalledWith('thread/list', expect.objectContaining({ searchTerm: 'JPTRV' }))
    expect(f.messages).not.toHaveBeenCalled()
  })

  it('finds message-only matches with excerpts and retains native pagination', async () => {
    const f = searchFixture()
    f.messages.mockResolvedValue({ threads: [thread()], snippets: { chat: 'Japan arrival plans' }, nextCursor: 'native-2' })
    const first = await searchConversations(f.access, { query: 'Japan', scope: 'messages' })
    expect(first.results[0]).toMatchObject({ id: 'chat', snippet: 'Japan arrival plans' })
    expect(f.request).not.toHaveBeenCalled()
    f.messages.mockResolvedValue({ threads: [], snippets: {}, nextCursor: null })
    await searchConversations(f.access, { query: 'Japan', scope: 'messages', cursor: first.nextCursor })
    expect(f.messages).toHaveBeenLastCalledWith('Japan', 'native-2')
    await expect(searchConversations(f.access, { query: 'Other', scope: 'messages', cursor: first.nextCursor })).rejects.toThrow('original query')
  })

  it('paginates a large set of aliases after native results end', async () => {
    const f = searchFixture(Array.from({ length: 45 }, (_, n) => ({ thread: thread(String(n)), titles: ['travel'] })))
    const first = await searchConversations(f.access, { query: 'travel' })
    const second = await searchConversations(f.access, { query: 'travel', cursor: first.nextCursor })
    expect(first.results).toHaveLength(40); expect(second.results).toHaveLength(5)
    expect(new Set([...first.results, ...second.results].map((r) => r.id)).size).toBe(45)
    expect(second.nextCursor).toBeNull()
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it('deduplicates native and alias matches and reports incomplete searches', async () => {
    const f = searchFixture([{ thread: thread(), titles: ['jptrv'] }])
    f.request.mockResolvedValueOnce({ data: [{ ...thread(), name: 'Native title' }], nextCursor: null })
    expect((await searchConversations(f.access, { query: 'jptrv' })).results).toHaveLength(1)
    f.request.mockRejectedValueOnce(new Error('Disconnected'))
    const result = await searchConversations(f.access, { query: 'jptrv' })
    expect(result.results).toHaveLength(1)
    expect(result.warnings).toEqual(['Codex search failed: Disconnected'])
  })

  it('searches saved ACP message content without resuming the agent', async () => {
    const f = searchFixture()
    const id = 'acp-12345678-1234-1234-1234-123456789abc'
    const read = vi.fn().mockResolvedValue({ activities: [
      { kind: 'tool', content: 'secret tool log Japan' },
      { kind: 'user', content: 'Plans for Japan travel' },
    ] })
    const result = await searchConversations({ ...f.access, agents: { threads: () => [thread(id)], read } }, { query: 'Japan', scope: 'messages' })
    expect(result.results[0]).toMatchObject({ id, snippet: 'Plans for Japan travel', matches: ['message'] })
    expect(read).toHaveBeenCalledExactlyOnceWith(id)
  })
})

describe('direct conversation access', () => {
  it('focuses an already open conversation without creating a duplicate pane or tab', async () => {
    const focusThread = vi.fn(() => true), newTab = vi.fn(), openPane = vi.fn()
    const service = {
      hasThread: () => true, focusThread, newTab, openPane, subscribe: () => () => undefined,
      paneTargets: () => [{ workspaceId: 'existing', paneId: 'existing-pane', session: { snapshot: () => ({ threadId: 'chat' }) } }],
    } as unknown as ClientWorkspaceLayoutService
    await expect(applyWorkspaceCommand(service, { id: 'command', action: 'open-pane', direction: 'horizontal', kind: 'chat', thread: thread(), newTab: true, reuseThread: true }))
      .resolves.toEqual({ workspaceId: 'existing', paneId: 'existing-pane', threadId: 'chat' })
    expect(focusThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(newTab).not.toHaveBeenCalled(); expect(openPane).not.toHaveBeenCalled()
  })

  it('waits for a newly created tab to expose the correct conversation identity', async () => {
    let changed = (): void => undefined
    let mounted = false
    const unsubscribe = vi.fn()
    const newTab = vi.fn()
    const service = {
      hasThread: () => false, newTab, subscribe: (listener: () => void) => { changed = listener; return unsubscribe },
      paneTargets: () => mounted ? [{ workspaceId: 'new', paneId: 'new-pane', session: { snapshot: () => ({ threadId: 'chat' }) } }] : [],
    } as unknown as ClientWorkspaceLayoutService
    const pending = applyWorkspaceCommand(service, { id: 'command', action: 'open-pane', direction: 'horizontal', kind: 'chat', thread: thread(), newTab: true, reuseThread: true })
    expect(newTab).toHaveBeenCalledExactlyOnceWith(undefined, thread())
    mounted = true; changed()
    await expect(pending).resolves.toEqual({ workspaceId: 'new', paneId: 'new-pane', threadId: 'chat' })
    expect(unsubscribe).toHaveBeenCalled()
  })

  function fixture(agents?: AgentChats) {
    const handlers = new Map<string, (call: { threadId: string; arguments: unknown }) => Promise<unknown>>()
    const summary = vi.fn().mockResolvedValue(thread())
    const turns = vi.fn().mockResolvedValue({ messages: [{ id: 'm', role: 'user', text: 'x'.repeat(900), tracesAfter: [{ content: 'private tool output' }] }], olderCursor: 'older' })
    const openPane = vi.fn().mockResolvedValue({ workspaceId: 'tab', paneId: 'pane', threadId: 'chat' })
    const messages = vi.fn().mockResolvedValue({ threads: [], snippets: {}, nextCursor: null })
    const ctx = {
      tools: { register: (_owner: unknown, spec: { namespace: string; name: string }, handler: never) => handlers.set(`${spec.namespace}/${spec.name}`, handler) },
      codex: { threadSummary: summary, listThreadTurns: turns }, workspaceCommands: { openPane },
      workspaceHistory: { tabs: () => [], conversations: () => [] }, get: (name: string) => name === 'agentChats' ? agents : undefined,
    } as unknown as Context
    registerConversationTools(ctx, { request: vi.fn() }, messages)
    return { handlers, summary, turns, openPane }
  }

  it('reads only saved messages with truncation and an older cursor', async () => {
    const f = fixture()
    const result = await f.handlers.get('conversation/read')!({ threadId: 'invoker', arguments: { id: 'chat', maxCharacters: 500 } }) as { messages: Array<{ text: string; truncated: boolean }>; nextCursor: string }
    expect(f.turns).toHaveBeenCalledWith('chat', undefined, 3)
    expect(result.messages[0]?.text).toHaveLength(500)
    expect(result.messages[0]?.truncated).toBe(true)
    expect(result.messages[0]).not.toHaveProperty('tracesAfter')
    expect(result.nextCursor).toBe('older')
    expect(f.openPane).not.toHaveBeenCalled()
  })

  it('opens the exact saved ID with reuse enabled and waits for the compositor result', async () => {
    const f = fixture()
    const result = await f.handlers.get('conversation/open')!({ threadId: 'invoker', arguments: { id: 'chat' } })
    expect(f.summary).toHaveBeenCalledExactlyOnceWith('chat')
    expect(f.openPane).toHaveBeenCalledWith(expect.objectContaining({ anchorThreadId: 'invoker', reuseThread: true, newTab: true, thread: thread() }))
    expect(result).toEqual({ workspaceId: 'tab', paneId: 'pane', threadId: 'chat' })
  })

  it('does not attempt an open when the conversation is missing', async () => {
    const f = fixture(); f.summary.mockResolvedValue(undefined)
    await expect(f.handlers.get('conversation/open')!({ threadId: 'invoker', arguments: { id: 'missing' } })).rejects.toThrow('not found')
    expect(f.openPane).not.toHaveBeenCalled()
  })

  it('reads a disconnected ACP chat without altering it or invoking remote resume', async () => {
    const saved = { remote: { state: 'disconnected' }, activities: [] }
    const read = vi.fn().mockResolvedValue(saved)
    const service = { chats: new Map(), discovered: new Map(), store: { read } } as unknown as AgentChats
    const result = await AgentChats.prototype.read.call(service, 'saved-chat')
    expect(result).toEqual(saved)
    expect(result).not.toBe(saved)
    expect(saved.remote.state).toBe('disconnected')
  })

  it('opens provider-discovered sessions from metadata and reports uncached transcripts without resuming', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'alto-discovered-chat-')); cleanups.push(folder)
    const provider = {
      snapshot: () => ({ id: 'claude', label: 'Claude', protocol: 'acp', status: 'ready', activeSessionIds: [] }),
      listSessions: vi.fn().mockResolvedValue({ sessions: [{ id: 'saved-claude', cwd: '/repo', title: 'Claude notes' }] }),
      start: vi.fn(), loadSession: vi.fn(), createSession: vi.fn(),
    }
    const agents = { snapshot: () => [provider.snapshot()], provider: () => provider } as unknown as AgentRegistry
    const chats = new AgentChats(agents, folder, vi.fn())
    try {
      await chats.load()
      await chats.refreshHistory()
      const discovered = chats.threads()[0]!
      const f = fixture(chats)
      const read = vi.spyOn(chats, 'read')
      await f.handlers.get('conversation/open')!({ threadId: 'invoker', arguments: { id: discovered.id } })
      expect(f.openPane).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        thread: discovered, workspace: '/repo', reuseThread: true, newTab: true,
      }))
      expect(read).not.toHaveBeenCalled()
      f.openPane.mockClear()

      await expect(f.handlers.get('conversation/read')!({ threadId: 'invoker', arguments: { id: discovered.id } }))
        .rejects.toThrow('transcript is not cached in Alto')
      const result = await f.handlers.get('conversation/search')!({ threadId: 'invoker', arguments: { query: 'Claude notes', scope: 'messages' } }) as { results: Array<{ id: string }>; warnings: string[] }
      expect(result.results).toEqual([expect.objectContaining({ id: discovered.id })])
      expect(result.warnings).toEqual([expect.stringContaining('transcript is not cached in Alto')])
      expect(f.openPane).not.toHaveBeenCalled()
      expect(provider.start).not.toHaveBeenCalled()
      expect(provider.loadSession).not.toHaveBeenCalled()
      expect(provider.createSession).not.toHaveBeenCalled()
      expect(provider.listSessions).toHaveBeenCalledOnce()
    } finally { await chats.dispose() }
  })
})
