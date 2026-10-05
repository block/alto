import { describe, expect, it, vi } from 'vitest'
import {
  filterSearchItems,
  isSearchShortcut,
  type SearchItem,
} from '../program/plugins/search.client.js'

const items: SearchItem[] = [
  {
    id: 'action:settings',
    label: 'Settings',
    detail: 'Change workspace and model',
    keywords: 'preferences configuration',
    kind: 'settings',
    onSelect: vi.fn(),
  },
  {
    id: 'thread:one',
    label: 'Fix composer spacing',
    detail: 'Adjusted the input layout',
    keywords: '/workspace/codex-cordis',
    kind: 'thread',
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
    expect(filterSearchItems(items, 'SETTINGS', 8).map((item) => item.id))
      .toEqual(['action:settings'])
    expect(filterSearchItems(items, 'input layout', 8).map((item) => item.id))
      .toEqual(['thread:one'])
    expect(filterSearchItems(items, 'codex cordis', 8).map((item) => item.id))
      .toEqual(['thread:one'])
  })

  it('keeps source order and applies the result limit', () => {
    expect(filterSearchItems(items, '', 1)).toEqual([items[0]])
  })
})
