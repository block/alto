import { parsePatchFiles, type CodeViewDiffItem } from '@pierre/diffs'
import type { DiffReviewDocument } from './diff-viewer-api.js'
import { reviewAnnotations, type ReviewComment } from './diff-review-comments.js'

// Pierre compares item versions and parsed cache keys, not patch strings. A
// working-tree document can retain its id while its contents change.
let nextVersion = 0

/** One patch owns its parsed files; review notes only update overlays. */
export function createDiffReviewProjection(document: Pick<DiffReviewDocument, 'id' | 'patch'>) {
  const version = ++nextVersion
  let items: CodeViewDiffItem<ReviewComment>[] = parsePatchFiles(document.patch, `${document.id}:${version}`, true).flatMap((patch, patchIndex) => (
    patch.files.map((fileDiff, fileIndex) => ({
      id: `${document.id}:${patchIndex}:${fileIndex}`,
      type: 'diff' as const,
      fileDiff,
      annotations: [],
      version,
    }))
  ))
  const paths = items.map(item => item.fileDiff.name)
  const pathsById = new Map(items.map(item => [item.id, item.fileDiff.name]))
  const files = items

  return {
    paths,
    pathForItem: (id: string): string | undefined => pathsById.get(id),
    itemForPath: (path: string): string | undefined => files.find(item => item.fileDiff.name === path || item.fileDiff.name.endsWith(`/${path}`))?.id,
    items: (comments: readonly ReviewComment[]): CodeViewDiffItem<ReviewComment>[] => {
      const byPath = new Map<string, ReviewComment[]>()
      for (const comment of comments) {
        const group = byPath.get(comment.path)
        if (group) group.push(comment)
        else byPath.set(comment.path, [comment])
      }
      let changed = false
      const next = items.map(item => {
        const notes = byPath.get(item.fileDiff.name) ?? []
        if (notes.length === item.annotations?.length && notes.every((note, index) => item.annotations?.[index]?.metadata === note)) return item
        changed = true
        return { ...item, annotations: reviewAnnotations(notes, item.fileDiff.name), version: ++nextVersion }
      })
      if (changed) items = next
      return items
    },
  }
}
