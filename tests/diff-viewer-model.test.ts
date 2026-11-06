import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '../program/plugins/diff-review-comments.js'
import { createDiffReviewProjection } from '../program/plugins/diff-viewer-model.js'

const patch = ['first.ts', 'second.ts', 'nested/third.ts'].map(path => (
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`
)).join('')
const document = { id: 'review-a', patch }
const note = (path: string, id = path): ReviewComment => ({
  id,
  itemId: 'a-different-viewer-item',
  path,
  side: 'additions',
  start: 1,
  end: 1,
  body: 'Keep the validation.',
  createdAt: '2026-11-06T12:00:00Z',
})

describe('immutable diff review projection', () => {
  it('keeps parsed files and unaffected viewer records stable as notes are added and removed', () => {
    const projection = createDiffReviewProjection(document)
    const empty = projection.items([])
    expect(projection.items([])).toBe(empty)

    const first = note('first.ts')
    const saved = projection.items([first])
    expect(saved[0]).not.toBe(empty[0])
    expect(saved[0]?.fileDiff).toBe(empty[0]?.fileDiff)
    expect(saved[0]?.annotations?.[0]?.metadata).toBe(first)
    expect(saved[1]).toBe(empty[1])
    expect(saved[2]).toBe(empty[2])
    expect(projection.items([first])).toBe(saved)

    const second = note('second.ts')
    const added = projection.items([first, second])
    expect(added[0]).toBe(saved[0])
    expect(added[1]).not.toBe(saved[1])
    expect(added[2]).toBe(saved[2])
    const removed = projection.items([second])
    expect(removed[0]?.annotations).toEqual([])
    expect(removed[0]?.version).toBeGreaterThan(saved[0]!.version!)
    expect(removed[1]).toBe(added[1])
    expect(removed[2]).toBe(added[2])
    expect(removed.map(item => item.fileDiff)).toEqual(empty.map(item => item.fileDiff))
    expect(removed.every((item, index) => item.fileDiff === empty[index]?.fileDiff)).toBe(true)
  })

  it('publishes replacement note metadata without invalidating another file or reparsing its contents', () => {
    const projection = createDiffReviewProjection(document)
    const first = note('first.ts')
    const before = projection.items([first])
    const edited = { ...first, body: 'Preserve the original error message.' }
    const after = projection.items([edited])
    expect(after[0]?.annotations?.[0]?.metadata).toBe(edited)
    expect(after[0]?.version).toBeGreaterThan(before[0]!.version!)
    expect(after[0]?.fileDiff).toBe(before[0]?.fileDiff)
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
    expect(projection.items([edited, note('not-in-this-patch.ts')])).toBe(after)
  })

  it('keeps navigation independent of annotation versions and gives a new snapshot distinct file identities', () => {
    const projection = createDiffReviewProjection(document)
    const initial = projection.items([])
    const paths = projection.paths
    const thirdId = projection.itemForPath('nested/third.ts')
    expect(thirdId).toBe(initial[2]?.id)
    expect(projection.pathForItem(thirdId!)).toBe('nested/third.ts')
    projection.items([note('nested/third.ts')])
    expect(projection.paths).toBe(paths)
    expect(projection.itemForPath('third.ts')).toBe(thirdId)
    expect(projection.itemForPath('missing.ts')).toBeUndefined()
    expect(projection.pathForItem('a-previous-document:0:2')).toBeUndefined()

    const next = createDiffReviewProjection({ id: 'review-b', patch: patch.replaceAll('+new', '+changed') }).items([])
    expect(next[2]?.id).not.toBe(thirdId)
    expect(next[2]?.fileDiff).not.toBe(initial[2]?.fileDiff)
    expect(next[2]?.fileDiff.cacheKey).not.toBe(initial[2]?.fileDiff.cacheKey)
    expect(next[2]?.annotations).toEqual([])
  })

  it('changes Pierre versions and content cache keys when a working-tree id is reused for new bytes', () => {
    const firstNote = note('first.ts')
    const previous = createDiffReviewProjection(document).items([firstNote])
    const refreshed = createDiffReviewProjection({ ...document, patch: patch.replaceAll('+new', '+changed') }).items([firstNote])
    for (let index = 0; index < previous.length; index++) {
      expect(refreshed[index]?.id).toBe(previous[index]?.id)
      expect(refreshed[index]?.version).not.toBe(previous[index]?.version)
      expect(refreshed[index]?.fileDiff.cacheKey).not.toBe(previous[index]?.fileDiff.cacheKey)
      expect(refreshed[index]?.fileDiff.additionLines.join('')).toContain('changed')
    }
    expect(refreshed[0]?.annotations?.[0]?.metadata).toBe(firstNote)
  })
})
