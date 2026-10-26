import { ArrowRight, History, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { clientStyles, type BrowserPlugin, type ClientHostService } from '../../src/client/plugin-api.js'
import { WORKSPACE_HISTORY_STATE, type NamedConversation } from './workspace-history-api.js'
import { errorMessage, threadRecencyAt, type LocalProject, type ThreadSummary } from '../../src/shared/protocol.js'
import { CHAT_HISTORY_LIST, CHAT_HISTORY_SEARCH, type ChatHistoryPage, type ChatHistorySearchPage } from './chat-history-api.js'
import { ChatHistoryStore, groupChatHistory, mergeChatHistory } from './chat-history-model.js'
import type { ClientSessionService } from './session-api.js'
import { OptionalThreadStatusService, threadWorkStatus, type ClientThreadStatusService } from './thread-status-api.js'
import type { ClientWorkspaceLayoutService, WorkspacePaneKindProps } from './workspace-layout-api.js'
import { threadHistoryTitle } from './ui/history.js'
import { ThreadStatusIndicator } from './ui/thread-status.js'
import { useStoreSelector } from './ui/store-selector.js'
import styles from './chat-history.css'

interface HistoryServices {
  host?: ClientHostService
  store: ChatHistoryStore
  session: ClientSessionService
  layout: ClientWorkspaceLayoutService
  status: ClientThreadStatusService
  searchMessages: (query: string, cursor?: string, refresh?: boolean) => Promise<ChatHistorySearchPage>
}

const emptyNamedConversations: NamedConversation[] = []
const noSubscription = (): (() => void) => () => undefined

interface MessageSearch extends ChatHistorySearchPage {
  query: string
  loading: boolean
  error: string
  retryCursor: string | undefined
}

export function historyWorkspace(thread: ThreadSummary, projects: readonly LocalProject[]): string {
  if (!thread.projectId) return 'No workspace'
  return projects.find((project) => project.id === thread.projectId)?.name
    ?? thread.cwd.replaceAll('\\', '/').replace(/\/+$/u, '').split('/').pop()
    ?? 'Workspace'
}

export function openHistoryChat(layout: ClientWorkspaceLayoutService, thread: ThreadSummary): void {
  if (layout.focusThread(thread.id)) return
  layout.openPane({
    kind: 'chat', direction: 'horizontal', thread,
    workspace: thread.cwd,
    ...(thread.projectId ? { projectId: thread.projectId } : {}),
  })
}

export function ChatHistoryPane({ visible, services }: WorkspacePaneKindProps & { services: HistoryServices }): ReactNode {
  const { store, session, layout, status } = services
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const projects = useStoreSelector(session, (snapshot) => snapshot.projects)
  const providers = useStoreSelector(session, (snapshot) => snapshot.providers)
  const statuses = useSyncExternalStore(status.subscribe, status.snapshot, status.snapshot)
  const layoutRevision = useSyncExternalStore(layout.subscribe, layout.snapshot, layout.snapshot)
  const named = useSyncExternalStore(services.host?.subscribe ?? noSubscription,
    () => services.host?.snapshot().snapshot?.extensions[WORKSPACE_HISTORY_STATE] as unknown as NamedConversation[] | undefined ?? emptyNamedConversations)
  const tabTitles = useMemo(() => {
    const titles = new Map(named.map((record) => [record.thread.id, record.titles]))
    for (const tab of layout.tabs()) {
      for (const id of tab.threadIds) titles.set(id, [...new Set([...(titles.get(id) ?? []), tab.title])])
    }
    return titles
  }, [layout, layoutRevision, named])
  const [openError, setOpenError] = useState('')
  const [query, setQuery] = useState('')
  const [messageSearch, setMessageSearch] = useState<MessageSearch | null>(null)
  const searchRequest = useRef(0)
  const search = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLDivElement>(null)
  const searching = Boolean(query.trim())
  const filteredThreads = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    if (!terms.length) return state.threads
    const candidates = mergeChatHistory(state.threads, [...named.map((record) => record.thread), ...layout.tabs().flatMap((tab) => tab.threads ?? [])])
    return candidates.filter((thread) => {
      const text = [thread.title, thread.preview, ...(tabTitles.get(thread.id) ?? []), historyWorkspace(thread, projects), thread.cwd, thread.gitInfo?.branch]
        .filter(Boolean).join(' ').toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    })
  }, [state.threads, projects, query, layout, tabTitles, named])
  const matches = useMemo(() => mergeChatHistory(filteredThreads, messageSearch?.threads ?? []), [filteredThreads, messageSearch?.threads])
  const groups = useMemo(() => groupChatHistory(matches), [matches, visible])

  useEffect(() => () => { searchRequest.current++ }, [])

  const changeQuery = (value: string): void => {
    searchRequest.current++
    setQuery(value)
    setMessageSearch(null)
    if (scroll.current) scroll.current.scrollTop = 0
  }
  const searchMessages = async (cursor?: string, refresh = false): Promise<void> => {
    const term = query.trim()
    if (!term) return
    const request = ++searchRequest.current
    const previous = cursor && messageSearch?.query === term ? messageSearch : null
    const current: MessageSearch = {
      query: term, threads: previous?.threads ?? [], snippets: previous?.snippets ?? {},
      nextCursor: previous?.nextCursor ?? null, loading: true, error: '', retryCursor: cursor,
    }
    setMessageSearch(current)
    try {
      const page = await services.searchMessages(term, cursor, refresh)
      if (request !== searchRequest.current) return
      setMessageSearch({
        ...current, threads: mergeChatHistory(current.threads, page.threads),
        snippets: { ...current.snippets, ...page.snippets }, nextCursor: page.nextCursor, loading: false,
      })
    } catch (failure) {
      if (request === searchRequest.current) setMessageSearch({ ...current, loading: false, error: errorMessage(failure) })
    }
  }

  useEffect(() => {
    if (visible && !store.snapshot().loaded && !store.snapshot().error) void store.load()
  }, [store, visible])
  useEffect(() => {
    // Search every page, even when the current matches fill the viewport.
    // The shared store caches pages and stops concurrent or repeated requests.
    if (visible && searching && state.loaded && !state.loading && !state.error && state.nextCursor) void store.load()
  }, [store, visible, searching, state.loaded, state.loading, state.error, state.nextCursor])
  useEffect(() => {
    if (!visible || !state.loaded || state.loading || state.error || !state.nextCursor || !more.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void store.load()
    }, { root: scroll.current, rootMargin: '400px' })
    observer.observe(more.current)
    return () => observer.disconnect()
  }, [store, visible, state.loaded, state.loading, state.error, state.nextCursor])

  const open = (thread: ThreadSummary): void => {
    try { openHistoryChat(layout, thread); status.acknowledge(thread.id); setOpenError('') }
    catch (failure) { setOpenError(errorMessage(failure)) }
  }
  return <section className={clientStyles.pane + ' chat-history'} aria-label="Chat history">
    <header className={clientStyles.paneHeader + ' ' + clientStyles.paneToolbar + ' chat-history-toolbar'}>
      <h1 className={clientStyles.toolbarTitle}>History</h1>
      <button type="button" className={clientStyles.iconButton} title="Refresh history" aria-label="Refresh history"
        disabled={state.loading || messageSearch?.loading} onClick={() => {
          void store.load(true)
          if (messageSearch) void searchMessages(undefined, true)
        }}><RefreshCw size={16} /></button>
    </header>
    <div className="chat-history-search-area">
      <form className="chat-history-search" role="search" aria-label="Chat history"
        onSubmit={(event) => { event.preventDefault(); if (!messageSearch?.loading) void searchMessages() }}>
        <Search size={16} aria-hidden="true" />
        <input ref={search} type="search" aria-label="Search history" placeholder="Search chats and messages…" maxLength={2000}
          title="Filter chat and tab titles, first messages, workspaces, and branches as you type. Press Enter to search messages."
          value={query} onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.stopPropagation()
              changeQuery('')
            }
          }} />
        {query && <button type="button" className={clientStyles.iconButton} aria-label="Clear history search" title="Clear search"
          onClick={() => { changeQuery(''); search.current?.focus() }}><X size={14} /></button>}
        <button type="submit" className={clientStyles.iconButton} aria-label="Search messages" title="Search messages (Enter)"
          disabled={!searching || messageSearch?.loading}><ArrowRight size={16} /></button>
      </form>
    </div>
    <div ref={scroll} className="chat-history-scroll" tabIndex={0} aria-label="Chat history, most recent first">
      <div className="chat-history-content">
        <div className="chat-history-scope">
          <span role="status">{searching
            ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}${!state.loaded || state.loading || state.nextCursor || messageSearch?.loading || messageSearch?.nextCursor ? ' so far' : ''}`
            : 'All workspaces'}</span>
          <span role="status">{messageSearch?.loading ? 'Searching messages…' : searching && !messageSearch ? 'Enter to search messages' : 'Most recent first'}</span>
        </div>
        {state.warnings.map((warning) => <p key={warning} className="chat-history-notice" role="status">{warning.split('\n')[0]?.slice(0, 200)}. Try Refresh.</p>)}
        {openError && <p className="chat-history-notice" role="alert">{openError}</p>}
        {messageSearch?.error && <div className="chat-history-search-error" role="alert">
          <span>Message search failed: {messageSearch.error}</span>
          <button type="button" className={clientStyles.button} onClick={() => { void searchMessages(messageSearch.retryCursor) }}>Retry message search</button>
        </div>}
        {groups.map((group) => <section className="chat-history-day" key={group.key} aria-label={group.label}>
          <h2>{group.label}</h2>
          <ul>
            {group.threads.map((thread) => {
              const title = threadHistoryTitle(thread)
              const timestamp = threadRecencyAt(thread)
              const date = new Date(timestamp * 1000)
              const validDate = timestamp > 0 && Number.isFinite(date.getTime())
              const workspace = historyWorkspace(thread, projects)
              const provider = providers?.find((provider) => provider.id === thread.providerId)?.label ?? thread.providerId
              return <li key={thread.id}>
                <button type="button" className={clientStyles.button + ' chat-history-row'} onClick={() => open(thread)} title={title} aria-label={'Open chat: ' + title}>
                  <span className="chat-history-row-content">
                    <span className="chat-history-row-title">{title}</span>
                    {searching && tabTitles.has(thread.id) && <span className="chat-history-row-tab">Tab: {tabTitles.get(thread.id)!.join(' · ')}</span>}
                    {messageSearch?.snippets[thread.id] && <span className="chat-history-row-snippet">{messageSearch.snippets[thread.id]}</span>}
                    <span className="chat-history-row-detail" title={[workspace, provider, thread.gitInfo?.branch].filter(Boolean).join(' · ')}>
                      <span>{workspace}</span>{provider && <><span aria-hidden="true">·</span><span>{provider}</span></>}{thread.gitInfo?.branch && <><span aria-hidden="true">·</span><span>{thread.gitInfo.branch}</span></>}
                    </span>
                  </span>
                  <span className="chat-history-row-end">
                    <ThreadStatusIndicator status={threadWorkStatus(statuses, thread.id) ?? (thread.status?.type === 'active' ? 'running' : undefined)} />
                    {validDate && <time dateTime={date.toISOString()} title={date.toLocaleString()}>{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>}
                  </span>
                </button>
              </li>
            })}
          </ul>
        </section>)}
        <div ref={more} className="chat-history-more" aria-live="polite">
          {state.error
            ? <><p role="alert">{state.error}</p><button className={clientStyles.button} type="button" onClick={() => { void store.retry() }}>Retry</button></>
            : state.loading ? <span>{searching ? 'Searching history…' : 'Loading history…'}</span>
            : !state.loaded ? null
            : !state.threads.length && !searching ? <span>No chats yet.</span>
            : state.nextCursor ? <button className={clientStyles.button} type="button" onClick={() => { void store.load() }}>Load older chats</button>
            : searching ? (!matches.length && !messageSearch?.loading && !messageSearch?.error
              ? <span>{messageSearch ? 'No chats match your search.' : 'No chat or tab matches. Press Enter to search messages.'}</span> : null)
            : <span>Beginning of your history</span>}
          {messageSearch?.nextCursor && !messageSearch.error && <button className={clientStyles.button} type="button"
            disabled={messageSearch.loading} onClick={() => { void searchMessages(messageSearch.nextCursor!) }}>Load more message matches</button>}
        </div>
      </div>
    </div>
  </section>
}

const chatHistory: BrowserPlugin = (ctx) => {
  const store = new ChatHistoryStore(async (cursor) => (
    await ctx.clientHost.call(CHAT_HISTORY_LIST, cursor ? { cursor } : {}) as unknown as ChatHistoryPage
  ))
  const status = new OptionalThreadStatusService(ctx)
  ctx.effect(() => () => { store.dispose(); status.dispose() }, 'chat-history.store')
  const services: HistoryServices = {
    store, status, session: ctx.clientSession, layout: ctx.clientWorkspaceLayout, host: ctx.clientHost,
    searchMessages: async (query, cursor, refresh) => await ctx.clientHost.call(CHAT_HISTORY_SEARCH, {
      query, ...(cursor ? { cursor } : {}), ...(refresh ? { refresh } : {}),
    }) as unknown as ChatHistorySearchPage,
  }
  ctx.clientWorkspaceLayout.registerPaneKind(ctx, {
    id: 'history', label: 'History', description: 'Browse all chats by date',
    shortcut: 'h', icon: History,
    renderer: (props) => <ChatHistoryPane {...props} services={services} />,
  })
  ctx.clientUi.registerStyle(ctx, 'chat-history', String(styles))
}
chatHistory.inject = ['clientHost', 'clientSession', 'clientUi', 'clientWorkspaceLayout']
export default chatHistory
