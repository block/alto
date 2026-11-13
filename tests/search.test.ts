import { describe, expect, it, vi } from 'vitest'
import {
  filterSearchItems,
  isSearchShortcut,
  searchThreads,
  openSearchThread,
  searchTabs,
  openSearchTab,
  type SearchItem,
} from '../program/plugins/search.client.js'
import type { ThreadSummary } from '../src/shared/protocol.js'
import type { ClientWorkspaceLayoutService, WorkspaceTabTarget } from '../program/plugins/workspace-layout-api.js'

const items: SearchItem[] = [
  {
    id: 'thread:two',
    label: 'Align palette spacing',
    detail: 'Updated the result layout',
    keywords: '/workspace/alto',
    onSelect: vi.fn(),
  },
  {
    id: 'thread:one',
    label: 'Fix composer spacing',
    detail: 'Adjusted the input layout',
    keywords: '/workspace/codex-cordis',
    onSelect: vi.fn(),
  },
]

describe('command palette filtering', () => {
  it('recognizes the command palette shortcut without accepting shifted chords', () => {
    expect(isSearchShortcut({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false })).toBe(true)
    expect(isSearchShortcut({ key: 'K', metaKey: false, ctrlKey: true, shiftKey: false })).toBe(true)
    expect(isSearchShortcut({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: true })).toBe(false)
  })

  it('matches labels, details, and keywords case-insensitively', () => {
    expect(filterSearchItems(items, 'input layout').map((item) => item.id))
      .toEqual(['thread:one'])
    expect(filterSearchItems(items, 'codex cordis').map((item) => item.id))
      .toEqual(['thread:one'])
  })

  it('keeps source order without truncating the results', () => {
    expect(filterSearchItems(items, '')).toEqual(items)
  })

  it('returns every conversation instead of applying a fixed cap', () => {
    const many = Array.from({ length: 24 }, (_, index): SearchItem => ({
      id: `thread:${index}`,
      label: `Conversation ${index}`,
      onSelect: vi.fn(),
    }))
    expect(filterSearchItems(many, '')).toHaveLength(24)
  })
})

describe('current tab search navigation', () => {
  const thread = (id: string, updatedAt: number): ThreadSummary => ({ id, title: `Conversation ${id}`, cwd: '/repo', preview: '', createdAt: 1, updatedAt })

  it('lists each current tab once, including split conversations, terminal-only tabs, and unsent chats', () => {
    const tabs: WorkspaceTabTarget[] = [
      { id: 'current', title: 'Current work', active: true, threadIds: ['current'], threads: [thread('current', 100)] },
      { id: 'read', title: 'Read work', active: false, threadIds: ['read'], threads: [thread('read', 90)] },
      { id: 'split', title: 'Release review', active: false, threadIds: ['first', 'new-unread'], threads: [thread('first', 80), thread('new-unread', 1)] },
      { id: 'older', title: 'Older work', active: false, threadIds: ['old-unread'], threads: [thread('old-unread', 70)] },
      { id: 'terminal', title: 'Deploy terminal', active: false, threadIds: [], paneKinds: ['terminal'] },
      { id: 'draft', title: 'Scratch plan', active: false, threadIds: [], paneKinds: ['chat'] },
    ]
    const before = structuredClone(tabs)
    const results = searchTabs(tabs, { revision: 1, running: [], finished: ['current', 'new-unread', 'old-unread'] }, 'current')
    expect(results.slice(0, 2).map(tab => tab.id)).toEqual(['split', 'older'])
    expect(results).toHaveLength(tabs.length)
    expect(new Set(results.map(tab => tab.id)).size).toBe(tabs.length)
    expect(results).toContain(tabs[4])
    expect(results).toContain(tabs[5])
    expect(tabs).toEqual(before)
  })

  it('keeps separate tabs that happen to contain the same conversation', () => {
    const shared = thread('shared', 10)
    const tabs: WorkspaceTabTarget[] = [
      { id: 'first-tab', title: 'First workspace', active: true, threadIds: [shared.id], threads: [shared] },
      { id: 'second-tab', title: 'Second workspace', active: false, threadIds: [shared.id], threads: [shared] },
    ]
    expect(searchTabs(tabs, { revision: 0, running: [], finished: [] }).map(tab => tab.id).sort()).toEqual(['first-tab', 'second-tab'])
  })

  it('selects the existing tab by its current index without changing its focused split pane or creating a chat', () => {
    const target: WorkspaceTabTarget = { id: 'target', title: 'Read work', active: false, threadIds: ['one', 'two'] }
    const other: WorkspaceTabTarget = { id: 'other', title: 'Other work', active: true, threadIds: [] }
    let tabs = [target, other]
    const layout = { tabs: vi.fn(() => tabs), selectTab: vi.fn(), focusThread: vi.fn(), focusPane: vi.fn(), newTab: vi.fn() }
    expect(openSearchTab(layout as unknown as ClientWorkspaceLayoutService, target.id)).toBe(true)
    expect(layout.selectTab).toHaveBeenLastCalledWith(0)
    tabs = [other, target]
    expect(openSearchTab(layout as unknown as ClientWorkspaceLayoutService, target.id)).toBe(true)
    expect(layout.selectTab).toHaveBeenLastCalledWith(1)
    expect(layout.focusThread).not.toHaveBeenCalled()
    expect(layout.focusPane).not.toHaveBeenCalled()
    expect(layout.newTab).not.toHaveBeenCalled()
  })

  it('leaves the workspace unchanged if the selected tab has closed', () => {
    const layout = { tabs: vi.fn(() => []), selectTab: vi.fn(), newTab: vi.fn() }
    expect(openSearchTab(layout as unknown as ClientWorkspaceLayoutService, 'closed-tab')).toBe(false)
    expect(layout.selectTab).not.toHaveBeenCalled()
    expect(layout.newTab).not.toHaveBeenCalled()
  })
})

describe('unread search navigation', () => {
  const thread = (id: string, updatedAt = 1): ThreadSummary => ({ id, title: id, cwd: '/repo', preview: '', createdAt: 1, updatedAt })

  it('prioritizes the newest unread completion, including chats only present in open tabs', () => {
    const tabs: WorkspaceTabTarget[] = [{ id: 'tab', title: 'Newest unread tab', active: false, threadIds: ['new-unread'], threads: [thread('new-unread')] }]
    const source = [thread('current', 100), thread('recent-read', 90), thread('old-unread', 80)]
    expect(searchThreads(source, tabs, { revision: 1, running: [], finished: ['current', 'new-unread', 'old-unread'] }, 'current').map((thread) => thread.id))
      .toEqual(['new-unread', 'old-unread', 'current', 'recent-read'])
    expect(source.map((thread) => thread.id)).toEqual(['current', 'recent-read', 'old-unread'])
  })

  it('deduplicates open chats and preserves the freshest summary', () => {
    const tabs: WorkspaceTabTarget[] = [{ id: 'tab', title: 'Open tab', active: false, threadIds: ['one'], threads: [thread('one', 10)] }]
    expect(searchThreads([thread('one', 5)], tabs, { revision: 0, running: [], finished: [] })).toEqual([thread('one', 10)])
  })

  it('focuses the existing tab without opening a duplicate', () => {
    const layout = { focusThread: vi.fn(() => true), newTab: vi.fn() }
    openSearchThread(layout as unknown as ClientWorkspaceLayoutService, thread('one'))
    expect(layout.focusThread).toHaveBeenCalledWith('one')
    expect(layout.newTab).not.toHaveBeenCalled()
  })

  it('opens a new tab for a conversation that is not already open', () => {
    const layout = { focusThread: vi.fn(() => false), newTab: vi.fn() }
    openSearchThread(layout as unknown as ClientWorkspaceLayoutService, thread('one'))
    expect(layout.newTab).toHaveBeenCalledWith(undefined, thread('one'))
  })
})
