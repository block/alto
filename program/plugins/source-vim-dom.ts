import type { VimCursor } from './source-vim.js'

interface VisualRange {
  start: VimCursor
  end: VimCursor
  linewise: boolean
}

// Measure the highlighted text itself: character offsets are not display columns
// when a line contains tabs, wide characters, or wraps onto another row.
function textRects(line: HTMLElement, start: number, end: number): DOMRect[] {
  const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  const rects: DOMRect[] = []
  let offset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (offset + length > start && offset < end) {
      const range = line.ownerDocument.createRange()
      range.setStart(node, Math.max(0, start - offset))
      range.setEnd(node, Math.min(length, end - offset))
      rects.push(...range.getClientRects())
    }
    offset += length
    if (offset >= end) break
  }
  return rects.filter((rect) => rect.width > 0 && rect.height > 0)
}

export function clearVimDecorations(root: ShadowRoot): void {
  root.querySelectorAll('[data-alto-vim-selection]').forEach((node) => node.remove())
  for (const line of root.querySelectorAll<HTMLElement>('[data-alto-vim-cursor]')) {
    line.removeAttribute('data-alto-vim-cursor')
  }
}

export function paintVimDecorations(root: ShadowRoot, cursor: VimCursor, selection?: VisualRange): void {
  clearVimDecorations(root)
  const cursorLine = root.querySelector<HTMLElement>(`[data-line="${cursor.line}"]`)
  if (cursorLine) {
    const bounds = cursorLine.getBoundingClientRect()
    const text = cursorLine.textContent ?? ''
    const characterLength = (text.codePointAt(cursor.column) ?? 0) > 0xffff ? 2 : 1
    const rect = textRects(cursorLine, cursor.column, cursor.column + characterLength)[0]
    const style = getComputedStyle(cursorLine)
    cursorLine.dataset.altoVimCursor = ''
    cursorLine.style.setProperty('--alto-vim-x', `${rect ? rect.left - bounds.left : parseFloat(style.paddingLeft) || 0}px`)
    cursorLine.style.setProperty('--alto-vim-y', `${rect ? rect.top - bounds.top : 1}px`)
    cursorLine.style.setProperty('--alto-vim-width', `${rect?.width || parseFloat(style.fontSize) * .6}px`)
    cursorLine.style.setProperty('--alto-vim-height', `${rect?.height || parseFloat(style.lineHeight) || 20}px`)
  }
  if (!selection || selection.linewise) return
  for (const line of root.querySelectorAll<HTMLElement>('[data-line]')) {
    const number = Number(line.dataset.line)
    if (number < selection.start.line || number > selection.end.line) continue
    const bounds = line.getBoundingClientRect()
    const text = line.textContent ?? ''
    const start = number === selection.start.line ? selection.start.column : 0
    const lastLength = (text.codePointAt(selection.end.column) ?? 0) > 0xffff ? 2 : 1
    const end = number === selection.end.line ? selection.end.column + lastLength : text.length
    for (const rect of textRects(line, start, end)) {
      const highlight = line.ownerDocument.createElement('span')
      highlight.dataset.altoVimSelection = ''
      highlight.setAttribute('aria-hidden', 'true')
      Object.assign(highlight.style, {
        left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
      })
      line.append(highlight)
    }
  }
}

export function sourceViewport(container: HTMLElement | null, root: ShadowRoot | undefined): {
  viewportLines: number
  firstVisibleLine?: number
  lastVisibleLine?: number
} {
  if (!container || !root) return { viewportLines: 30 }
  const bounds = container.getBoundingClientRect()
  const lines = [...root.querySelectorAll<HTMLElement>('[data-line]')]
  const lineHeight = lines[0] ? parseFloat(getComputedStyle(lines[0]).lineHeight) || 20 : 20
  const header = root.querySelector<HTMLElement>('[data-diffs-header]')?.getBoundingClientRect()
  const top = bounds.top + (header?.height ?? 0)
  const visible = lines.filter((line) => {
    const rect = line.getBoundingClientRect()
    return rect.top >= top - 1 && rect.bottom <= bounds.bottom + 1
  })
  const first = visible[0], last = visible.at(-1)
  return {
    viewportLines: Math.max(1, Math.floor((bounds.bottom - top) / lineHeight)),
    ...(first ? { firstVisibleLine: Number(first.dataset.line) } : {}),
    ...(last ? { lastVisibleLine: Number(last.dataset.line) } : {}),
  }
}

export function revealVimColumn(root: ShadowRoot, cursor: VimCursor, container: HTMLElement | null): boolean {
  const line = root.querySelector<HTMLElement>(`[data-line="${cursor.line}"]`)
  if (!line) return false
  const rect = textRects(line, cursor.column, cursor.column + 1)[0] ?? line.getBoundingClientRect()
  for (let parent = line.parentElement; parent; parent = parent.parentElement) {
    if (!['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)) continue
    const bounds = parent.getBoundingClientRect()
    if (rect.right > bounds.right - 8) parent.scrollLeft += rect.right - bounds.right + 8
    else if (rect.left < bounds.left + 8) parent.scrollLeft += rect.left - bounds.left - 8
    break
  }
  if (container) {
    const bounds = container.getBoundingClientRect()
    const headerHeight = root.querySelector<HTMLElement>('[data-diffs-header]')?.getBoundingClientRect().height ?? 0
    const top = bounds.top + headerHeight
    if (rect.top < top) container.scrollTop += rect.top - top
    else if (rect.bottom > bounds.bottom) container.scrollTop += rect.bottom - bounds.bottom
  }
  return true
}

function sourcePosition(root: ShadowRoot, node: Node, offset: number): VimCursor | undefined {
  const element = node instanceof HTMLElement ? node : node.parentElement
  const line = element?.closest<HTMLElement>('[data-line]')
  if (!line || line.getRootNode() !== root) return undefined
  const range = line.ownerDocument.createRange()
  range.selectNodeContents(line)
  range.setEnd(node, offset)
  return { line: Number(line.dataset.line), column: range.toString().length }
}

export function sourcePointerPosition(root: ShadowRoot, x: number, y: number): VimCursor | undefined {
  const caret = root.ownerDocument.caretPositionFromPoint(x, y, { shadowRoots: [root] })
  return caret ? sourcePosition(root, caret.offsetNode, caret.offset) : undefined
}

export function sourceTextSelection(root: ShadowRoot, source: string): { anchor: VimCursor; cursor: VimCursor; text: string } | undefined {
  const selection = root.ownerDocument.getSelection()
  if (!selection) return undefined
  const range = selection.getComposedRanges({ shadowRoots: [root] })[0]
  if (!range || (range.startContainer === range.endContainer && range.startOffset === range.endOffset)) return undefined
  const start = sourcePosition(root, range.startContainer, range.startOffset)
  const end = sourcePosition(root, range.endContainer, range.endOffset)
  if (!start || !end) return undefined
  // Browser ranges end between characters; Vim's visual endpoint is inclusive.
  const last = end.column > 0 ? { ...end, column: end.column - 1 }
    : { line: Math.max(start.line, end.line - 1), column: Math.max(0, (source.split('\n')[end.line - 2]?.length ?? 1) - 1) }
  const lines = source.split('\n')
  const offset = (point: VimCursor): number => lines.slice(0, point.line - 1).reduce((total, line) => total + line.length + 1, point.column)
  const text = source.slice(offset(start), offset(end))
  return selection.direction === 'backward' ? { anchor: last, cursor: start, text } : { anchor: start, cursor: last, text }
}

export function clearSourceTextSelection(root: ShadowRoot): void {
  const selection = root.ownerDocument.getSelection()
  if (!selection) return
  const range = selection.getComposedRanges({ shadowRoots: [root] })[0]
  if (range && sourcePosition(root, range.startContainer, range.startOffset)) selection.removeAllRanges()
}
