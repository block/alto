import {
  Check,
  FolderPlus,
  MessageSquareText,
  Plus,
  Puzzle,
  Search,
  Settings2,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  clientStyles,
  type BrowserPlugin,
  type ClientOverlays,
} from '../../src/client/plugin-api.js'
import { searchSurface } from './search-api.js'
import type { ClientSessionService, ClientSessionSnapshot } from './session-api.js'
import type {
  ClientThreadStatusService,
  ThreadWorkStatus,
} from './thread-status-api.js'
import {
  OptionalThreadStatusService,
  threadWorkStatus,
} from './thread-status-api.js'
import { ConversationPaneOverlay } from './ui/conversation-overlay.js'
import { useStoreSelector } from './ui/store-selector.js'
import { ThreadStatusIndicator } from './ui/thread-status.js'
import styles from './search.css'

export interface SearchItem {
  id: string
  label: string
  detail?: string
  keywords?: string
  kind: 'thread' | 'new-thread' | 'new-workspace' | 'settings' | 'plugins'
  active?: boolean
  status?: ThreadWorkStatus | undefined
  disabled?: boolean
  onSelect: () => void
}

export function isSearchShortcut(event: Pick<globalThis.KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>): boolean {
  return event.key.toLocaleLowerCase() === 'k'
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey
}

export function filterSearchItems(
  items: SearchItem[],
  query: string,
  limit: number,
): SearchItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((item) => {
    if (!terms.length) return true
    const searchable = `${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`.toLocaleLowerCase()
    return terms.every((term) => searchable.includes(term))
  }).slice(0, limit)
}

function ItemIcon({ kind }: { kind: SearchItem['kind'] }): ReactNode {
  switch (kind) {
    case 'thread': return <MessageSquareText size={16} />
    case 'new-thread': return <Plus size={16} />
    case 'new-workspace': return <FolderPlus size={16} />
    case 'settings': return <Settings2 size={16} />
    case 'plugins': return <Puzzle size={16} />
  }
}

function SearchPalette({
  open,
  label,
  placeholder,
  items,
  limit,
  onClose,
}: {
  open: boolean
  label: string
  placeholder: string
  items: SearchItem[]
  limit: number
  onClose: () => void
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const results = useMemo(
    () => filterSearchItems(items, query, limit),
    [items, limit, query],
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => setActiveIndex(0), [query])

  if (!open) return null

  const select = (item: SearchItem | undefined): void => {
    if (!item || item.disabled) return
    onClose()
    item.onSelect()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => results.length ? (current + 1) % results.length : 0)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => results.length
        ? (current - 1 + results.length) % results.length
        : 0)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      select(results[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <ConversationPaneOverlay className={`${clientStyles.overlayLayer} search-backdrop`} onMouseDown={onClose}>
      <section
        className={`${clientStyles.floatingPanel} search-palette`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            aria-label={label}
            placeholder={placeholder}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>esc</kbd>
        </div>
        <div className="search-results" role="listbox" aria-label="Search results">
          {results.map((item, index) => (
            <button
              className={`search-result ${index === activeIndex ? 'active' : ''}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              disabled={item.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(item)}
              key={item.id}
            >
              <span className="search-result-icon"><ItemIcon kind={item.kind} /></span>
              <span className="search-result-copy">
                <strong>{item.label}</strong>
                {item.detail && <span>{item.detail}</span>}
              </span>
              <span className="search-result-meta">
                <ThreadStatusIndicator status={item.status} />
                {item.active && <Check className="search-result-check" size={15} />}
              </span>
            </button>
          ))}
          {!results.length && <div className="search-empty">No matching conversations or actions.</div>}
        </div>
        <footer className="search-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
        </footer>
      </section>
    </ConversationPaneOverlay>
  )
}

interface SearchSessionSnapshot {
  threads: ClientSessionSnapshot['threads']
  threadId?: string
  turn: ClientSessionSnapshot['turn']['tag']
  surfaces: NonNullable<ClientSessionSnapshot['harness']>['ui']['surfaces'] | undefined
}

function searchSessionSnapshot(
  state: ClientSessionSnapshot,
): SearchSessionSnapshot {
  return {
    threads: state.threads,
    ...(state.threadId ? { threadId: state.threadId } : {}),
    turn: state.turn.tag,
    surfaces: state.harness?.ui.surfaces,
  }
}

function searchSessionSnapshotEqual(
  left: SearchSessionSnapshot,
  right: SearchSessionSnapshot,
): boolean {
  return left.threads === right.threads
    && left.threadId === right.threadId
    && left.turn === right.turn
    && left.surfaces === right.surfaces
}

function OpenSearchSurface({
  surface,
  session,
  threadStatus,
  overlays,
}: {
  surface: typeof searchSurface
  session: ClientSessionService
  threadStatus: ClientThreadStatusService
  overlays: ClientOverlays
}): ReactNode {
  const state = useStoreSelector(session, searchSessionSnapshot, searchSessionSnapshotEqual)
  const statusState = useSyncExternalStore(threadStatus.subscribe, threadStatus.snapshot)
  const label = surface.label ?? 'Search'
  const limit = surface.kind === 'search' ? surface.limit ?? 8 : 8
  const placeholder = surface.kind === 'search'
    ? surface.placeholder ?? 'Search conversations and actions…'
    : 'Search conversations and actions…'
  const items: SearchItem[] = [
    {
      id: 'action:new-thread',
      label: 'New chat',
      detail: 'Start a new conversation',
      keywords: 'new thread conversation',
      kind: 'new-thread',
      disabled: state.turn !== 'idle',
      onSelect: () => session.newThread(),
    },
    ...(state.surfaces?.some((candidate) => candidate.id === 'default-new-workspace') ? [{
      id: 'action:new-workspace',
      label: 'New workspace',
      detail: 'Add a folder-backed workspace',
      keywords: 'project folder repository',
      kind: 'new-workspace' as const,
      disabled: state.turn !== 'idle',
      onSelect: () => overlays.open('new-workspace'),
    }] : []),
    ...(state.surfaces?.some((candidate) => candidate.id === 'default-settings') ? [{
      id: 'action:settings',
      label: 'Settings',
      detail: 'Change workspace, model, effort, and permissions',
      keywords: 'preferences configuration',
      kind: 'settings' as const,
      onSelect: () => overlays.open('settings'),
    }] : []),
    ...(state.surfaces?.some((candidate) => candidate.id === 'default-plugins') ? [{
      id: 'action:plugins',
      label: 'Plugins',
      detail: 'Manage active plugins and tools',
      keywords: 'extensions tools fibers',
      kind: 'plugins' as const,
      onSelect: () => overlays.open('plugins'),
    }] : []),
    ...state.threads.map((thread): SearchItem => ({
      id: `thread:${thread.id}`,
      label: thread.title,
      detail: thread.preview || thread.cwd,
      keywords: thread.cwd,
      kind: 'thread',
      active: thread.id === state.threadId,
      status: threadWorkStatus(statusState, thread.id),
      disabled: state.turn !== 'idle',
      onSelect: () => void session.openThread(thread),
    })),
  ]

  return (
    <SearchPalette
      open
      label={label}
      placeholder={placeholder}
      items={items}
      limit={limit}
      onClose={() => overlays.close('search')}
    />
  )
}

function SearchSurface({
  surface,
  session,
  threadStatus,
  overlays,
}: {
  surface: typeof searchSurface
  session: ClientSessionService
  threadStatus: ClientThreadStatusService
  overlays: ClientOverlays
}): ReactNode {
  const activeOverlay = useSyncExternalStore(overlays.subscribe, overlays.snapshot)
  if (activeOverlay !== 'search') return null
  return (
    <OpenSearchSurface
      surface={surface}
      session={session}
      threadStatus={threadStatus}
      overlays={overlays}
    />
  )
}

const searchClient: BrowserPlugin = (ctx) => {
  const session = ctx.clientSession
  const threadStatus = new OptionalThreadStatusService(ctx)
  const overlays = ctx.clientUi.overlays
  ctx.effect(() => {
    const shortcut = (event: globalThis.KeyboardEvent): void => {
      if (!isSearchShortcut(event)) return
      event.preventDefault()
      if (!event.repeat) overlays.toggle('search')
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, 'search.shortcut')
  const BoundSearchRoot = () => (
    <SearchSurface
      surface={searchSurface}
      session={session}
      threadStatus={threadStatus}
      overlays={overlays}
    />
  )
  ctx.clientUi.registerRoot(ctx, 'default-search', BoundSearchRoot)
  ctx.clientUi.registerStyle(ctx, 'default-search', String(styles))
  return () => threadStatus.dispose()
}

searchClient.inject = ['clientUi', 'clientSession']
searchClient.resources = { provides: { roots: ['default-search'] } }

export default searchClient
