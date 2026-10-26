import type { Context } from 'cordis'
import { z } from 'zod'
import { errorMessage, isRecord, threadRecencyAt, type ThreadSummary } from '../../src/shared/protocol.js'
import { readThreadSummary } from '../../src/server/services/thread-view.js'
import type { AgentChats } from './agent-chats.js'
import { isAgentChatId } from './agent-chats-api.js'
import { requireAgentChats } from './agent-chats-access.js'
import type { NamedConversation, WorkspaceHistoryService } from './workspace-history-api.js'
import type { ChatHistorySearchPage } from './chat-history-api.js'

type Scope = 'titles' | 'messages'
interface Runtime { request(method: string, params: Record<string, unknown>): Promise<unknown> }
interface SearchAccess {
  runtime: Runtime
  history: WorkspaceHistoryService
  agents?: Pick<AgentChats, 'threads' | 'read'>
  messages(query: string, cursor?: string): Promise<ChatHistorySearchPage>
}

const PAGE_SIZE = 40
const searchInput = z.object({
  query: z.string().trim().min(1).max(2000),
  scope: z.enum(['titles', 'messages']).default('titles'),
  cursor: z.string().min(1).max(16384).optional(),
})
const cursorInput = z.object({
  version: z.literal(1), query: z.string(), scope: z.enum(['titles', 'messages']),
  offset: z.number().int().nonnegative(), native: z.string().nullable(),
})

function displayTitle(thread: ThreadSummary): string {
  return thread.title && thread.title !== 'Untitled conversation'
    ? thread.title : thread.preview.replace(/\s+/gu, ' ').slice(0, 160) || 'Untitled conversation'
}

function includes(text: string, query: string): boolean { return text.toLocaleLowerCase().includes(query.toLocaleLowerCase()) }
function excerpt(text: string, query: string): string {
  const start = Math.max(0, text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 100)
  return (start ? '…' : '') + text.slice(start, start + 500)
}

export async function searchConversations(access: SearchAccess, input: unknown) {
  const { query, scope, cursor } = searchInput.parse(input)
  let offset = 0
  let nativeCursor: string | null | undefined
  if (cursor) {
    let parsed: z.infer<typeof cursorInput>
    try { parsed = cursorInput.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))) }
    catch { throw new Error('Invalid conversation search cursor') }
    if (parsed.query !== query || parsed.scope !== scope) throw new Error('Use the cursor with its original query and scope')
    offset = parsed.offset
    nativeCursor = parsed.native
  }
  const records = new Map(access.history.conversations().map((record) => [record.thread.id, record]))
  for (const thread of access.agents?.threads() ?? []) {
    records.set(thread.id, { thread, titles: records.get(thread.id)?.titles ?? [] })
  }
  const local: Array<{ record: NamedConversation; matches: string[]; snippet?: string }> = []
  const warnings: string[] = []
  for (const record of records.values()) {
    const matches: string[] = []
    if (record.titles.some((title) => includes(title, query))) matches.push('tab title')
    if (includes(displayTitle(record.thread), query)) matches.push('chat title')
    if (includes(record.thread.preview, query)) matches.push('preview')
    let snippet: string | undefined
    if (scope === 'messages' && isAgentChatId(record.thread.id) && access.agents) {
      try {
        const chat = await access.agents.read(record.thread.id)
        const message = chat.activities.find((item) => (item.kind === 'user' || item.kind === 'agent') && includes(item.content, query))
        if (message) { matches.push('message'); snippet = excerpt(message.content, query) }
      } catch (error) { warnings.push(`Could not search saved agent chat ${record.thread.id}: ${errorMessage(error)}`) }
    }
    if (matches.length) local.push({ record, matches, ...(snippet ? { snippet } : {}) })
  }
  const exact = (record: NamedConversation): number => Number([...record.titles, displayTitle(record.thread)].some((title) => title.toLocaleLowerCase() === query.toLocaleLowerCase()))
  local.sort((a, b) => exact(b.record) - exact(a.record)
    || threadRecencyAt(b.record.thread) - threadRecencyAt(a.record.thread) || a.record.thread.id.localeCompare(b.record.thread.id))
  let page: ChatHistorySearchPage = { threads: [], nextCursor: null, snippets: {} }
  if (nativeCursor !== null) {
    try {
      if (scope === 'messages') page = await access.messages(query, nativeCursor)
      else {
        const response = await access.runtime.request('thread/list', {
          searchTerm: query, limit: PAGE_SIZE, sortKey: 'recency_at', sortDirection: 'desc',
          sourceKinds: ['cli', 'vscode', 'appServer'], ...(nativeCursor ? { cursor: nativeCursor } : {}),
        })
        if (!isRecord(response) || !Array.isArray(response.data)) throw new Error('Invalid conversation search response')
        page = {
          threads: response.data.flatMap((value) => { const thread = readThreadSummary(value); return thread ? [thread] : [] }),
          nextCursor: typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null,
          snippets: {},
        }
      }
      if (page.nextCursor && page.nextCursor === nativeCursor) throw new Error('Conversation search returned a repeated cursor')
    } catch (error) {
      warnings.push(`Codex search failed: ${errorMessage(error)}`)
      page = { threads: [], nextCursor: null, snippets: {} }
    }
  }
  const tabs = access.history.tabs()
  const result = (record: NamedConversation, matches: string[], snippet?: string) => ({
    id: record.thread.id, title: displayTitle(record.thread), aliases: record.titles,
    preview: record.thread.preview.slice(0, 500), workspace: record.thread.cwd,
    updatedAt: threadRecencyAt(record.thread), matches,
    openTabs: tabs.filter((tab) => tab.panes.some((pane) => pane.threadId === record.thread.id))
      .map((tab) => ({ id: tab.id, title: tab.title })),
    ...(snippet ? { snippet } : {}),
  })
  const results = new Map(local.slice(offset, offset + PAGE_SIZE).map(({ record, matches, snippet }) => [record.thread.id, result(record, matches, snippet)]))
  for (const thread of page.threads) {
    const previous = results.get(thread.id)
    const match = scope === 'messages' ? 'chat title or message' : 'chat title'
    if (previous) {
      previous.matches = [...new Set([...previous.matches, match])]
      const snippet = page.snippets[thread.id]
      if (snippet) previous.snippet = snippet
    } else results.set(thread.id, result({ thread, titles: records.get(thread.id)?.titles ?? [] }, [match], page.snippets[thread.id]))
  }
  const nextOffset = Math.min(local.length, offset + PAGE_SIZE)
  const nextCursor = nextOffset < local.length || page.nextCursor ? Buffer.from(JSON.stringify({
    version: 1, query, scope, offset: nextOffset, native: page.nextCursor,
  })).toString('base64url') : null
  return { results: [...results.values()], nextCursor, ...(warnings.length ? { warnings } : {}) }
}

export function registerConversationTools(ctx: Context, runtime: Runtime, messages: SearchAccess['messages']): void {
  ctx.tools.register(ctx, {
    namespace: 'workspace', name: 'list_tabs',
    description: 'List Alto tabs and panes with exact tab titles, IDs, selected tab, pane kinds, and conversation IDs. Does not change focus.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }, () => ({ tabs: ctx.workspaceHistory.tabs() }))

  ctx.tools.register(ctx, {
    namespace: 'conversation', name: 'search',
    description: 'Find saved chats without navigating the UI. Search current and former tab names, chat titles, and saved previews. Use scope messages to also search user and assistant text. Returns conversation IDs, matching fields, excerpts, open tabs, and a nextCursor. Closed-tab names are retained from when this feature was installed.',
    inputSchema: {
      type: 'object', required: ['query'], additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 2000, description: 'Case-insensitive literal text or phrase.' },
        scope: { type: 'string', enum: ['titles', 'messages'], default: 'titles', description: 'Titles is fast; messages also searches saved user and assistant text.' },
        cursor: { type: 'string', description: 'nextCursor from a previous page of the same query and scope.' },
      },
    },
  }, (call) => {
    const agents = ctx.get('agentChats', false) as AgentChats | undefined
    return searchConversations({ runtime, history: ctx.workspaceHistory, messages, ...(agents ? { agents } : {}) }, call.arguments)
  })

  ctx.tools.register(ctx, {
    namespace: 'conversation', name: 'read',
    description: 'Read saved user and assistant messages by conversation ID without opening a tab, resuming an agent, or changing focus. Starts with the most recent messages; use nextCursor for older content. Tool logs and reasoning are omitted.',
    inputSchema: {
      type: 'object', required: ['id'], additionalProperties: false,
      properties: { id: { type: 'string' }, cursor: { type: 'string' }, maxCharacters: { type: 'integer', minimum: 500, maximum: 20000, default: 6000, description: 'Maximum characters per message; truncated messages are marked.' } },
    },
  }, async (call) => {
    const { id, cursor, maxCharacters } = z.object({
      id: z.string().min(1), cursor: z.string().max(8192).optional(), maxCharacters: z.number().int().min(500).max(20000).default(6000),
    }).parse(call.arguments)
    const clip = (message: { id: string; role: string; text: string }) => ({
      ...message, text: message.text.slice(0, maxCharacters), truncated: message.text.length > maxCharacters,
    })
    if (isAgentChatId(id)) {
      const chat = await requireAgentChats(ctx).read(id)
      const all = chat.activities.filter((item) => item.kind === 'user' || item.kind === 'agent')
      const end = cursor ? Number(cursor) : all.length
      if (!Number.isSafeInteger(end) || end < 0 || end > all.length) throw new Error('Invalid saved-agent conversation cursor')
      const start = Math.max(0, end - 12)
      return { id, title: displayTitle(chat.summary), messages: all.slice(start, end).map((item) => clip({ id: item.id, role: item.kind, text: item.content })), nextCursor: start ? String(start) : null }
    }
    const [summary, page] = await Promise.all([ctx.codex.threadSummary(id), ctx.codex.listThreadTurns(id, cursor, 3)])
    if (!summary) throw new Error('Conversation was not found')
    return { id, title: displayTitle(summary), messages: page.messages.map(({ id, role, text }) => clip({ id, role, text })), nextCursor: page.olderCursor ?? null }
  })

  ctx.tools.register(ctx, {
    namespace: 'conversation', name: 'open',
    description: 'Reopen a saved conversation by ID, or focus its existing pane without duplicating it. Defaults to a new full-size tab for closed chats. Returns the confirmed workspace, pane, and conversation IDs; never sends a message.',
    inputSchema: {
      type: 'object', required: ['id'], additionalProperties: false,
      properties: { id: { type: 'string' }, placement: { type: 'string', enum: ['tab', 'right', 'below'], default: 'tab' } },
    },
  }, async (call) => {
    const { id, placement } = z.object({ id: z.string().min(1), placement: z.enum(['tab', 'right', 'below']).default('tab') }).parse(call.arguments)
    const thread = isAgentChatId(id)
      ? requireAgentChats(ctx).threads().find((thread) => thread.id === id)
      : await ctx.codex.threadSummary(id)
    if (!thread) throw new Error('Conversation was not found')
    const opened = await ctx.workspaceCommands.openPane({
      kind: 'chat', direction: placement === 'below' ? 'vertical' : 'horizontal',
      anchorThreadId: call.threadId, thread, workspace: thread.cwd,
      reuseThread: true, newTab: placement === 'tab',
      ...(thread.projectId ? { projectId: thread.projectId } : {}),
    })
    return { ...opened }
  })
}
