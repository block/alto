import { z } from 'zod'
import { registerConversationTools } from './conversation-tools.js'
import type { HarnessPlugin, TurnDraft } from '../../src/server/plugin-api.js'
import { readThreadSummary } from '../../src/server/services/thread-view.js'
import { errorMessage, isRecord, type JsonValue, type ThreadSummary } from '../../src/shared/protocol.js'
import { CHAT_HISTORY_LIST, CHAT_HISTORY_SEARCH, CHAT_HISTORY_PAGE_SIZE, type ChatHistoryPage, type ChatHistorySearchPage } from './chat-history-api.js'

export const conversationDiscoveryGuidance = `When the user asks to find or revisit an Alto tab or chat, use the live Cordis tools first. Avoid clicking through History, reopening unrelated closed tabs, or inspecting internal storage when these tools are available.
Use cordis with operation: "list" when capabilities may have changed, "describe" with the tool name for its schema, and "invoke" with tool and arguments to run it.
- workspace/list_tabs with {} lists current tab titles, pane IDs, and conversation IDs without changing focus. Use it when the user refers to an open tab.
- conversation/search with {"query":"jptrv"} searches current and saved former tab names, chat titles, and previews. Start with this fast default titles scope for a remembered name. If that does not identify the chat, try a distinctive topic keyword, for example {"query":"Japan","scope":"messages"}, to include saved user and assistant text. Queries are case-insensitive literal text or phrases, not semantic search; shorten or vary the query if needed.
- conversation/read with {"id":"<result id>"} reads saved messages without opening a tab or resuming an agent. Inspect likely candidates to distinguish them; it starts with recent messages. Pass its nextCursor as cursor to read older content. maxCharacters controls the per-message limit, and truncated marks clipped messages.
- conversation/open with {"id":"<confirmed result id>"} brings the requested chat into view. It focuses an existing pane or opens a full-size tab, and never sends a prompt. Optional placement: "right" or "below" requests a split. Use the returned IDs to confirm what opened.
Use exact conversation IDs from tool results. Search returns aliases, matches, snippets, and openTabs to help identify the right chat. Pass search nextCursor back as cursor with the same query and scope when more results are needed. Treat warnings as an incomplete search, not proof that a chat is absent. Tab aliases are retained only from feature activation, so an older missing name may require a message search. If reading candidates still leaves ambiguity, ask the user to choose instead of opening unrelated chats.`

interface HistoryRuntime {
  request(method: string, params: Record<string, unknown>): Promise<unknown>
}

export async function readChatHistoryPage(
  runtime: HistoryRuntime,
  classify: (threads: ThreadSummary[]) => Promise<ThreadSummary[]>,
  cursor?: string,
): Promise<ChatHistoryPage> {
  const response = await runtime.request('thread/list', {
    ...(cursor ? { cursor } : {}),
    limit: CHAT_HISTORY_PAGE_SIZE,
    sortKey: 'recency_at',
    sortDirection: 'desc',
    sourceKinds: ['cli', 'vscode', 'appServer'],
  })
  if (!isRecord(response) || !Array.isArray(response.data)) {
    throw new Error('The chat service returned an invalid history page.')
  }
  const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor
    ? response.nextCursor : null
  if (nextCursor && nextCursor === cursor) throw new Error('The chat service repeated a history page. Try Refresh.')
  const threads = response.data.flatMap((value) => {
    const thread = readThreadSummary(value)
    return thread ? [thread] : []
  })
  return { threads: await classify(threads), nextCursor }
}

export async function searchChatHistoryPage(
  runtime: HistoryRuntime,
  classify: (threads: ThreadSummary[]) => Promise<ThreadSummary[]>,
  query: string,
  cursor?: string,
): Promise<ChatHistorySearchPage> {
  const response = await runtime.request('thread/search', {
    searchTerm: query,
    ...(cursor ? { cursor } : {}),
    limit: 40,
    sortKey: 'recency_at',
    sortDirection: 'desc',
    sourceKinds: ['cli', 'vscode', 'appServer'],
  })
  if (!isRecord(response) || !Array.isArray(response.data)) throw new Error('The chat service returned invalid search results.')
  const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null
  if (nextCursor && nextCursor === cursor) throw new Error('The chat service repeated a search page. Try searching again.')
  const snippets: Record<string, string> = Object.create(null)
  const threads = response.data.flatMap((value) => {
    if (!isRecord(value)) return []
    const thread = readThreadSummary(value.thread)
    if (!thread) return []
    if (typeof value.snippet === 'string') snippets[thread.id] = value.snippet.slice(0, 1000)
    return [thread]
  })
  return { threads: await classify(threads), nextCursor, snippets }
}

const chatHistory: HarnessPlugin = (ctx) => {
  // The standard listThreads method gathers the first N entries each time.
  // Keep the native cursor here so scrolling only fetches the next page.
  const access = ctx.codex as unknown as { client?: HistoryRuntime }
  let active = true
  // Native message search scans saved chats. Reuse recent pages and concurrent
  // requests without retaining a second copy of the full conversation history.
  const searchCache = new Map<string, { expires: number; page: Promise<ChatHistorySearchPage> }>()
  const native = ctx.codex as unknown as HistoryRuntime & { client?: HistoryRuntime }
  const runtime: HistoryRuntime = { request: (method, params) => {
    if (!active) throw new Error('Chat history is unavailable.')
    if (typeof native.request === 'function') return native.request(method, params)
    if (native.client) return native.client.request(method, params)
    throw new Error('Chat history is unavailable.')
  } }
  ctx.effect(() => () => { active = false; searchCache.clear() }, 'chat-history.lifetime')
  ctx.clientExtensions.registerMethod(ctx, CHAT_HISTORY_LIST, async (payload) => {
    const { cursor } = z.object({ cursor: z.string().min(1).max(8192).optional() }).parse(payload ?? {})
    if (!active) throw new Error('Chat history is unavailable.')
    if (!cursor) await ctx.agentChats.refreshHistory()
    let page: ChatHistoryPage
    try {
      if (!access.client) throw new Error('Codex history is unavailable.')
      await ctx.codex.start()
      page = await readChatHistoryPage(access.client, async (threads) => {
        if (!active) throw new Error('Chat history was closed.')
        return ctx.projects.classifyThreads(threads)
      }, cursor)
    } catch (error) {
      if (cursor) throw error
      page = { threads: [], nextCursor: null, warnings: [`Codex history: ${errorMessage(error)}`] }
    }
    if (!active) throw new Error('Chat history was closed.')
    if (!cursor) {
      page.threads = await ctx.projects.classifyThreads([...page.threads, ...ctx.agentChats.threads()])
      page.warnings = [...(page.warnings ?? []), ...ctx.agentChats.historyErrors()]
    }
    return page as unknown as JsonValue
  })
  const search = async (payload: unknown): Promise<ChatHistorySearchPage> => {
    const { query, cursor, refresh } = z.object({
      query: z.string().trim().min(1).max(2000),
      cursor: z.string().min(1).max(8192).optional(),
      refresh: z.boolean().optional(),
    }).parse(payload)
    if (!active) throw new Error('Chat history is unavailable.')
    if (refresh) searchCache.clear()
    const key = JSON.stringify([query, cursor ?? null])
    let cached = searchCache.get(key)
    if (!cached || cached.expires < Date.now()) {
      const page = searchChatHistoryPage(runtime, async (threads) => {
        if (!active) throw new Error('Chat history was closed.')
        return ctx.projects.classifyThreads(threads)
      }, query, cursor)
      cached = { expires: Date.now() + 30_000, page }
      searchCache.set(key, cached)
      while (searchCache.size > 24) searchCache.delete(searchCache.keys().next().value!)
      void page.catch(() => { if (searchCache.get(key)?.page === page) searchCache.delete(key) })
    }
    const page = await cached.page
    if (!active) throw new Error('Chat history was closed.')
    return page
  }
  ctx.clientExtensions.registerMethod(ctx, CHAT_HISTORY_SEARCH, async (payload) => await search(payload) as unknown as JsonValue)
  registerConversationTools(ctx, runtime, (query, cursor) => search({ query, ...(cursor ? { cursor } : {}) }))
  ctx.on('codex/turn/prepare', async (_draft: TurnDraft, next) => {
    const prepared = await next()
    return {
      ...prepared,
      additionalContext: {
        ...prepared.additionalContext,
        conversation_discovery: { kind: 'application' as const, value: conversationDiscoveryGuidance },
      },
    }
  })
}
chatHistory.inject = ['codex', 'projects', 'clientExtensions', 'agentChats', 'tools', 'workspaceHistory', 'workspaceCommands', 'turnProgram']
export default chatHistory
