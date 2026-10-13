export interface VimCursor {
  /** One-based line number. */
  line: number
  /** Zero-based UTF-16 offset in the line. Tabs occupy one offset. */
  column: number
}

export type VimMotion =
  | 'left' | 'right' | 'down' | 'up'
  | 'line-start' | 'line-first' | 'line-end' | 'line-last'
  | 'word-forward' | 'word-backward' | 'word-end' | 'word-end-backward'
  | 'WORD-forward' | 'WORD-backward' | 'WORD-end' | 'WORD-end-backward'

export function clampVimCursor(source: string, cursor: VimCursor): VimCursor {
  const lines = source.split('\n')
  const line = Math.max(1, Math.min(lines.length, Math.floor(cursor.line) || 1))
  const text = lines[line - 1]!
  let column = Math.max(0, Math.min(Math.max(0, text.length - 1), Math.floor(cursor.column) || 0))
  if (column > 0 && /[\uDC00-\uDFFF]/u.test(text[column]!) && /[\uD800-\uDBFF]/u.test(text[column - 1]!)) column -= 1
  return { line, column }
}

export function vimCharacterLength(source: string, offset: number): number {
  return (source.codePointAt(offset) ?? 0) > 0xFFFF ? 2 : 1
}

export function vimCursorOffset(source: string, cursor: VimCursor): number {
  const current = clampVimCursor(source, cursor)
  const lines = source.split('\n')
  let offset = current.column
  for (let line = 1; line < current.line; line += 1) offset += lines[line - 1]!.length + 1
  return offset
}

export function vimOffsetCursor(source: string, requestedOffset: number): VimCursor {
  const offset = Math.max(0, Math.min(source.length, requestedOffset))
  const before = source.slice(0, offset)
  return clampVimCursor(source, {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  })
}

export function vimCharacterClass(character: string | undefined, bigWord = false): 0 | 1 | 2 {
  if (!character || /\s/u.test(character)) return 0
  return bigWord || /[\p{L}\p{N}_]/u.test(character) ? 1 : 2
}

function wordOffset(source: string, offset: number, motion: VimMotion): number {
  const bigWord = motion.startsWith('WORD')
  const kind = motion.slice(motion.indexOf('-') + 1)
  const cls = (at: number) => vimCharacterClass(source[at], bigWord)
  const last = Math.max(0, source.length - 1)
  let next = offset
  if (kind === 'forward') {
    const currentClass = cls(next)
    while (next < source.length && cls(next) === currentClass) next += 1
    while (next < source.length && cls(next) === 0) next += 1
  } else if (kind === 'backward') {
    next = Math.max(0, next - 1)
    while (next > 0 && cls(next) === 0) next -= 1
    const currentClass = cls(next)
    while (next > 0 && cls(next - 1) === currentClass) next -= 1
  } else if (kind === 'end') {
    next = Math.min(last, next + 1)
    while (next < last && cls(next) === 0) next += 1
    const currentClass = cls(next)
    while (next < last && cls(next + 1) === currentClass) next += 1
  } else {
    const currentClass = cls(next)
    while (next > 0 && cls(next - 1) === currentClass) next -= 1
    next = Math.max(0, next - 1)
    while (next > 0 && cls(next) === 0) next -= 1
  }
  return Math.max(0, Math.min(source.length, next))
}

export function moveVimCursor(
  source: string,
  cursor: VimCursor,
  motion: VimMotion,
  requestedCount = 1,
): VimCursor {
  const lines = source.split('\n')
  const current = clampVimCursor(source, cursor)
  const count = Math.max(1, Math.min(100_000, Math.floor(requestedCount) || 1))
  const text = lines[current.line - 1]!
  switch (motion) {
    case 'left':
    case 'right': {
      let column = current.column
      for (let index = 0; index < count; index += 1) {
        if (motion === 'left') {
          if (column === 0) break
          column -= 1
          if (column > 0 && /[\uDC00-\uDFFF]/u.test(text[column]!)) column -= 1
        } else {
          if (column >= text.length - 1) break
          column += vimCharacterLength(text, column)
        }
      }
      return clampVimCursor(source, { ...current, column })
    }
    case 'down': return clampVimCursor(source, { ...current, line: current.line + count })
    case 'up': return clampVimCursor(source, { ...current, line: current.line - count })
    case 'line-start': return { ...current, column: 0 }
    case 'line-first': return { ...current, column: Math.max(0, text.search(/\S/u)) }
    case 'line-end': return clampVimCursor(source, { ...current, column: Math.max(0, text.length - 1) })
    case 'line-last': return clampVimCursor(source, { ...current, column: Math.max(0, text.trimEnd().length - 1) })
    default: {
      let offset = vimCursorOffset(source, current)
      for (let index = 0; index < count; index += 1) {
        const next = wordOffset(source, offset, motion)
        if (next === offset) break
        offset = next
      }
      return vimOffsetCursor(source, offset)
    }
  }
}
