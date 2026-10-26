import type { FileChangeKind } from '../../../src/shared/protocol.js'

export function lineChanges(
  diff: string,
  kind: FileChangeKind,
): { additions: number; deletions: number } {
  // Add and delete events carry whole-file content; updates carry unified diffs.
  const contentLines = diff ? diff.replace(/\n$/u, '').split('\n').length : 0
  if (kind === 'add') return { additions: contentLines, deletions: 0 }
  if (kind === 'delete') return { additions: 0, deletions: contentLines }
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of diff.split('\n')) {
    // Ignore +++/--- file headers until the first hunk; only hunk lines count as changes.
    if (line.startsWith('@@')) inHunk = true
    if (line.startsWith('+') && (inHunk || !line.startsWith('+++'))) additions += 1
    if (line.startsWith('-') && (inHunk || !line.startsWith('---'))) deletions += 1
  }
  return { additions, deletions }
}
