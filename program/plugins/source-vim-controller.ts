import {
  clampVimCursor, moveVimCursor, vimCharacterClass, vimCharacterLength, vimCursorOffset, vimOffsetCursor,
  type VimCursor, type VimMotion,
} from './source-vim.js'

export interface VimState {
  cursor: VimCursor
  mode: 'normal' | 'visual' | 'visual-line'
  anchor?: VimCursor | undefined
  pending: string
  message?: string | undefined
}

export interface VimSelection { start: VimCursor; end: VimCursor; linewise: boolean }
export interface VimContext { viewportLines?: number; firstVisibleLine?: number; lastVisibleLine?: number }
export interface VimResult {
  handled: boolean
  cursor?: VimCursor
  jump?: boolean | undefined
  scroll?: 'top' | 'center' | 'bottom' | 'line-up' | 'line-down' | 'page-up' | 'page-down'
  scrollLines?: number
  yank?: string
  command?: 'forward' | 'backward' | 'ex'
  comment?: boolean
  edit?: boolean
  help?: boolean
}

type Find = { character: string; direction: 1 | -1; till: boolean }
type Search = { query: string; direction: 1 | -1; wholeWord: boolean }
const MAX_COUNT = 100_000
const READ_ONLY = 'Source is read-only. Use c to comment or e to request an edit.'
const MOTIONS: Record<string, VimMotion> = {
  h: 'left', ArrowLeft: 'left', Backspace: 'left', l: 'right', ArrowRight: 'right',
  j: 'down', ArrowDown: 'down', k: 'up', ArrowUp: 'up',
  w: 'word-forward', b: 'word-backward', e: 'word-end',
  W: 'WORD-forward', B: 'WORD-backward', E: 'WORD-end',
  '0': 'line-start', Home: 'line-start', '^': 'line-first', '$': 'line-end', End: 'line-end',
}

/** Read-only Vim commands. Positions use UTF-16 offsets, independently of rendered tab width. */
export class SourceVimController {
  private source: string
  private lines: string[]
  private cursor: VimCursor
  private mode: VimState['mode'] = 'normal'
  private anchor: VimCursor | undefined
  private message: string | undefined
  private preferredColumn: number | undefined
  private count = ''
  private operatorCount = 1
  private operator: 'y' | undefined
  private prefix = ''
  private sequence = ''
  private find: Find | undefined
  private pattern: Search | undefined
  private marks = new Map<string, VimCursor>()
  private jumps: VimCursor[] = []
  private jumpIndex = -1

  constructor(source: string, initial: VimCursor = { line: 1, column: 0 }) {
    this.source = source
    this.lines = source.split('\n')
    this.cursor = clampVimCursor(source, initial)
  }

  get state(): VimState {
    return { cursor: { ...this.cursor }, mode: this.mode, anchor: this.anchor && { ...this.anchor }, pending: this.sequence, message: this.message }
  }

  reset(source: string, initial: VimCursor = { line: 1, column: 0 }): void {
    this.source = source
    this.lines = source.split('\n')
    this.marks.clear()
    this.jumps = []
    this.jumpIndex = -1
    this.find = undefined
    this.pattern = undefined
    this.setCursor(initial)
  }

  setCursor(cursor: VimCursor): void {
    this.cursor = clampVimCursor(this.source, cursor)
    this.preferredColumn = undefined
    this.mode = 'normal'
    this.anchor = undefined
    this.message = undefined
    this.clearPending()
  }

  select(anchor: VimCursor, cursor: VimCursor, linewise: boolean): void {
    this.setCursor(cursor)
    this.anchor = clampVimCursor(this.source, anchor)
    this.mode = linewise ? 'visual-line' : 'visual'
  }

  selection(): VimSelection | undefined {
    if (!this.anchor || this.mode === 'normal') return undefined
    const [start, end] = this.offset(this.anchor) <= this.offset(this.cursor)
      ? [this.anchor, this.cursor] : [this.cursor, this.anchor]
    const linewise = this.mode === 'visual-line'
    return {
      start: linewise ? { line: start.line, column: 0 } : { ...start },
      end: linewise ? clampVimCursor(this.source, { line: end.line, column: Infinity }) : { ...end },
      linewise,
    }
  }

  private offset(cursor = this.cursor): number { return vimCursorOffset(this.source, cursor) }
  private position(offset: number): VimCursor { return vimOffsetCursor(this.source, offset) }
  private totalCount(): number { return Math.min(MAX_COUNT, (Number(this.count) || 1) * this.operatorCount) }
  clearPending(): void { this.count = ''; this.operatorCount = 1; this.operator = undefined; this.prefix = ''; this.sequence = '' }
  private done(result: Omit<VimResult, 'handled'> = {}): VimResult { this.clearPending(); return { handled: true, ...result } }
  private notice(message: string): VimResult { this.message = message; return this.done() }
  private first(line: number): VimCursor { return moveVimCursor(this.source, { line, column: 0 }, 'line-first') }

  private recordJump(): void {
    if (this.jumpIndex >= 0) this.jumps = this.jumps.slice(0, this.jumpIndex + 1)
    if (this.jumps.length === 0 || this.offset(this.jumps[this.jumps.length - 1]!) !== this.offset()) this.jumps.push({ ...this.cursor })
    if (this.jumps.length > 100) this.jumps.shift()
    this.jumpIndex = -1
  }

  private move(target: VimCursor, options: { inclusive?: boolean; linewise?: boolean; jump?: boolean; vertical?: boolean } = {}): VimResult {
    const next = clampVimCursor(this.source, target)
    if (this.operator === 'y') {
      if (options.linewise) return this.yankLines(this.cursor.line, next.line)
      const from = this.offset()
      const to = this.offset(next)
      const end = Math.max(from, to)
      return this.yankOffsets(Math.min(from, to), end + (options.inclusive ? vimCharacterLength(this.source, end) : 0))
    }
    if (options.jump && this.offset(next) !== this.offset()) this.recordJump()
    if (!options.vertical) this.preferredColumn = undefined
    this.cursor = next
    return this.done({ cursor: { ...next }, jump: options.jump })
  }

  private vertical(delta: number): VimResult {
    this.preferredColumn ??= this.cursor.column
    return this.move({ line: this.cursor.line + delta, column: this.preferredColumn }, { linewise: true, vertical: true })
  }

  private yankOffsets(start: number, end: number): VimResult {
    const text = this.source.slice(start, end)
    this.cursor = this.position(start)
    this.mode = 'normal'
    this.anchor = undefined
    this.preferredColumn = undefined
    this.message = `Yanked ${text.length} character${text.length === 1 ? '' : 's'}`
    return this.done({ cursor: { ...this.cursor }, yank: text })
  }

  private yankLines(first: number, last: number): VimResult {
    const start = Math.max(1, Math.min(first, last))
    const end = Math.min(this.lines.length, Math.max(first, last))
    const text = this.lines.slice(start - 1, end).join('\n') + '\n'
    this.cursor = clampVimCursor(this.source, { line: start, column: this.cursor.column })
    this.mode = 'normal'
    this.anchor = undefined
    this.message = `Yanked ${end - start + 1} line${start === end ? '' : 's'}`
    return this.done({ cursor: { ...this.cursor }, yank: text })
  }

  private yankSelection(): VimResult {
    const selection = this.selection()!
    return selection.linewise
      ? this.yankLines(selection.start.line, selection.end.line)
      : this.yankOffsets(this.offset(selection.start), Math.min(this.source.length, this.offset(selection.end) + vimCharacterLength(this.source, this.offset(selection.end))))
  }

  private paragraph(direction: 1 | -1, count: number): VimResult {
    let line = this.cursor.line - 1
    for (let index = 0; index < count; index += 1) {
      let next = line + direction
      while (next >= 0 && next < this.lines.length && this.lines[next]!.trim() === '') next += direction
      while (next >= 0 && next < this.lines.length && this.lines[next]!.trim() !== '') next += direction
      next = Math.max(0, Math.min(this.lines.length - 1, next))
      if (next === line) break
      line = next
    }
    return this.move({ line: line + 1, column: 0 }, { jump: true })
  }

  private findCharacter(find: Find, count: number, repeat = false): VimResult {
    const text = this.lines[this.cursor.line - 1]!
    let column = this.cursor.column
    // A repeated till command skips the character beside the previous stop.
    if (repeat && find.till) {
      const adjacent = find.direction === 1 ? column + vimCharacterLength(text, column) : column - find.character.length
      if (text.slice(adjacent, adjacent + find.character.length) === find.character) column = adjacent
    }
    for (let index = 0; index < count; index += 1) {
      column = find.direction === 1
        ? text.indexOf(find.character, column + 1)
        : column > 0 ? text.lastIndexOf(find.character, column - 1) : -1
      if (column < 0) return this.notice(`Character not found: ${find.character}`)
    }
    if (find.till) column += find.direction === 1 ? -1 : find.character.length
    return this.move({ ...this.cursor, column }, { inclusive: true })
  }

  private matchingBracket(count: number, hasCount: boolean): VimResult {
    if (hasCount) {
      if (count > 100) return this.notice('Percentage must be between 1 and 100')
      return this.move(this.first(Math.ceil(this.lines.length * count / 100)), { jump: true, linewise: true })
    }
    const start = this.offset()
    const tail = this.lines[this.cursor.line - 1]!.slice(this.cursor.column)
    const found = tail.search(/[()[\]{}]/u)
    if (found < 0) return this.notice('No bracket on this line')
    const offset = start + found
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' }
    const opening = this.source[offset]!
    const direction = '([{'.includes(opening) ? 1 : -1
    let depth = 1
    for (let next = offset + direction; next >= 0 && next < this.source.length; next += direction) {
      if (this.source[next] === opening) depth += 1
      if (this.source[next] === pairs[opening]) depth -= 1
      if (depth === 0) return this.move(this.position(next), { inclusive: true, jump: true })
    }
    return this.notice('No matching bracket')
  }

  private wordObject(big: boolean, around: boolean, count: number): [number, number] | undefined {
    if (!this.source) return undefined
    const cls = (offset: number) => vimCharacterClass(this.source[offset], big)
    let start = this.offset()
    let end = start
    const kind = cls(start)
    while (start > 0 && this.source[start - 1] !== '\n' && cls(start - 1) === kind) start -= 1
    while (end < this.source.length && this.source[end] !== '\n' && cls(end) === kind) end += 1
    for (let index = 1; index < count && end < this.source.length; index += 1) {
      while (end < this.source.length && cls(end) === 0) end += 1
      const nextKind = cls(end)
      while (end < this.source.length && cls(end) === nextKind) end += 1
    }
    if (around) {
      const before = end
      while (end < this.source.length && /[\t ]/u.test(this.source[end]!)) end += 1
      if (before === end) while (start > 0 && /[\t ]/u.test(this.source[start - 1]!)) start -= 1
    }
    return end > start ? [start, end] : undefined
  }

  private delimiterObject(key: string, around: boolean, count: number): [number, number] | undefined {
    const delimiters: Record<string, [string, string]> = {
      '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'],
      '[': ['[', ']'], ']': ['[', ']'], '{': ['{', '}'], '}': ['{', '}'], B: ['{', '}'],
      '<': ['<', '>'], '>': ['<', '>'], '"': ['"', '"'], "'": ["'", "'"], '`': ['`', '`'],
    }
    const pair = delimiters[key]
    if (!pair) return undefined
    const [open, close] = pair
    const offset = this.offset()
    const escaped = (at: number): boolean => {
      let slashes = 0
      for (let before = at - 1; before >= 0 && this.source[before] === '\\'; before -= 1) slashes += 1
      return slashes % 2 === 1
    }
    const ranges: Array<[number, number]> = []
    const stack: number[] = []
    // Quotes are line-local. Brackets may surround multiple source lines.
    const lineStart = this.offset({ line: this.cursor.line, column: 0 })
    const begin = open === close ? lineStart : 0
    const limit = open === close ? lineStart + this.lines[this.cursor.line - 1]!.length : this.source.length
    for (let at = begin; at < limit; at += 1) {
      if (this.source[at] !== open && this.source[at] !== close) continue
      if (escaped(at)) continue
      if (this.source[at] === close && stack.length) {
        const start = stack.pop()!
        if (start <= offset && at >= offset) ranges.push([start, at + 1])
      } else if (this.source[at] === open) stack.push(at)
    }
    const range = ranges.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]))[count - 1]
    return range && (around ? range : [range[0] + 1, range[1] - 1])
  }

  private textObject(key: string, around: boolean): VimResult {
    const count = this.totalCount()
    const range = key === 'w' || key === 'W'
      ? this.wordObject(key === 'W', around, count)
      : this.delimiterObject(key, around, count)
    if (!range) return this.notice('No matching text object')
    if (this.operator === 'y') return this.yankOffsets(...range)
    if (range[0] === range[1]) return this.notice('Text object is empty')
    this.mode = 'visual'
    this.anchor = this.position(range[0])
    this.cursor = this.position(range[1] - 1)
    return this.done({ cursor: { ...this.cursor } })
  }

  private searchPattern(pattern: Search, direction: 1 | -1, count: number): VimResult {
    const sensitive = /\p{Lu}/u.test(pattern.query)
    const expression = new RegExp(pattern.query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), sensitive ? 'gu' : 'giu')
    const matches: number[] = []
    for (const match of this.source.matchAll(expression)) {
      const at = match.index
      if (!pattern.wholeWord || (vimCharacterClass(this.source[at - 1]) !== 1 && vimCharacterClass(this.source[at + match[0].length]) !== 1)) matches.push(at)
    }
    if (!matches.length) return this.notice(`Pattern not found: ${pattern.query}`)
    const offset = this.offset()
    const nextIndex = direction === 1 ? matches.findIndex((at) => at > offset) : matches.findLastIndex((at) => at < offset)
    const first = nextIndex >= 0 ? nextIndex : direction === 1 ? 0 : matches.length - 1
    const index = ((first + direction * (count - 1)) % matches.length + matches.length) % matches.length
    return this.move(this.position(matches[index]!), { jump: true })
  }

  search(query: string, direction: 1 | -1): VimResult {
    this.message = undefined
    if (!query && !this.pattern) return this.notice('No previous search')
    this.pattern = { query: query || this.pattern!.query, direction, wholeWord: false }
    return this.searchPattern(this.pattern, direction, this.totalCount())
  }

  ex(command: string): VimResult {
    this.message = undefined
    const text = command.replace(/^:/u, '').trim()
    if (/^\d+$/u.test(text) || text === '$') return this.move(this.first(text === '$' ? this.lines.length : Number(text)), { jump: true, linewise: true })
    if (text === 'help' || text === 'h') return this.done({ help: true })
    if (text === 'noh' || text === 'nohlsearch') return this.done()
    return this.notice(/^(w|write|x|exit|s|substitute|d|delete)(\W|$)/u.test(text) ? READ_ONLY : `Not a source command: ${text}`)
  }

  key(key: string, context: VimContext = {}): VimResult {
    this.message = undefined
    if (key === 'Escape' || key === 'Ctrl+[' || key === 'Ctrl+c') {
      this.mode = 'normal'; this.anchor = undefined; return this.done()
    }
    // Ignore standalone modifier keys without interrupting a multi-key command.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return { handled: false }
    this.sequence = (this.sequence + (key.length === 1 ? key : `<${key}>`)).slice(-24)
    const count = this.totalCount()
    const hasCount = this.count !== '' || this.operatorCount !== 1

    if (this.prefix) {
      const prefix = this.prefix
      this.prefix = ''
      if (prefix === 'f' || prefix === 'F' || prefix === 't' || prefix === 'T') {
        if ([...key].length !== 1) return this.notice('Expected a character')
        this.find = { character: key, direction: prefix === prefix.toLowerCase() ? 1 : -1, till: prefix.toLowerCase() === 't' }
        return this.findCharacter(this.find, count)
      }
      if (prefix === 'i' || prefix === 'a') return this.textObject(key, prefix === 'a')
      if (prefix === 'm') {
        if (!/^[a-z]$/u.test(key)) return this.notice('Use a lowercase mark name')
        this.marks.set(key, { ...this.cursor }); return this.notice(`Mark ${key} set`)
      }
      if (prefix === "'" || prefix === '`') {
        const mark = this.marks.get(key)
        if (!mark) return this.notice(`Mark not set: ${key}`)
        return this.move(prefix === "'" ? this.first(mark.line) : mark, { jump: true, linewise: prefix === "'" })
      }
      if (prefix === 'g') {
        if (key === 'g') return this.move(this.first(hasCount ? count : 1), { jump: true, linewise: true })
        if (key === 'e' || key === 'E') return this.move(moveVimCursor(this.source, this.cursor, key === 'e' ? 'word-end-backward' : 'WORD-end-backward', count), { inclusive: true })
        if (key === '_') return this.move(moveVimCursor(this.source, { line: this.cursor.line + count - 1, column: 0 }, 'line-last'), { inclusive: true })
        if (key === 'j' || key === 'k') return this.vertical((key === 'j' ? 1 : -1) * count)
        return this.notice(`Unknown source motion: g${key}`)
      }
      if (prefix === 'z' && ['z', 't', 'b'].includes(key)) return this.done({ scroll: key === 'z' ? 'center' : key === 't' ? 'top' : 'bottom' })
      return this.notice(`Unknown source command: ${prefix}${key}`)
    }

    if (/^[0-9]$/u.test(key) && (key !== '0' || this.count !== '')) {
      this.count = String(Math.min(MAX_COUNT, Number(this.count + key)))
      return { handled: true }
    }
    if (key === 'y') {
      if (this.mode !== 'normal') return this.yankSelection()
      if (this.operator === 'y') return this.yankLines(this.cursor.line, this.cursor.line + count - 1)
      this.operator = 'y'; this.operatorCount = count; this.count = ''; return { handled: true }
    }
    if ((key === 'i' || key === 'a') && (this.operator || this.mode !== 'normal')) { this.prefix = key; return { handled: true } }
    if (['g', 'z', 'f', 'F', 't', 'T', 'm', "'", '`'].includes(key)) { this.prefix = key; return { handled: true } }

    // Bare e opens an edit request; counted and operator motions still use Vim's word end.
    if (key === 'e' && !hasCount && !this.operator) return this.done({ edit: true })
    const motion = MOTIONS[key]
    if (motion) {
      if (motion === 'down' || motion === 'up') return this.vertical((motion === 'down' ? 1 : -1) * count)
      const start = motion === 'line-end' ? { ...this.cursor, line: this.cursor.line + count - 1 } : this.cursor
      const target = moveVimCursor(this.source, start, motion, count)
      const result = this.move(target, { inclusive: motion.endsWith('end') })
      if (motion === 'line-end' && result.yank === undefined) this.preferredColumn = Infinity
      return result
    }
    if (key === 'G') return this.move(this.first(hasCount ? count : this.lines.length), { jump: true, linewise: true })
    if (key === '+' || key === 'Enter' || key === '-' || key === '_') {
      const delta = key === '_' ? count - 1 : (key === '-' ? -1 : 1) * count
      return this.move(this.first(this.cursor.line + delta), { linewise: true })
    }
    if (key === '{' || key === '}') return this.paragraph(key === '}' ? 1 : -1, count)
    if (key === '%') return this.matchingBracket(count, hasCount)
    if (key === ';' || key === ',') {
      if (!this.find) return this.notice('No previous character search')
      return this.findCharacter({ ...this.find, direction: key === ';' ? this.find.direction : this.find.direction === 1 ? -1 : 1 }, count, true)
    }
    if (key === '/' || key === '?' || key === ':') {
      // Retain a pending operator/count until the command is submitted or cancelled.
      return { handled: true, command: key === '/' ? 'forward' : key === '?' ? 'backward' : 'ex' }
    }
    if (key === 'n' || key === 'N') {
      if (!this.pattern) return this.notice('No previous search')
      return this.searchPattern(this.pattern, key === 'n' ? this.pattern.direction : this.pattern.direction === 1 ? -1 : 1, count)
    }
    if (key === '*' || key === '#') {
      const word = this.wordObject(false, false, 1)
      if (!word || vimCharacterClass(this.source[this.offset()]) !== 1) return this.notice('No word under cursor')
      this.pattern = { query: this.source.slice(...word), direction: key === '*' ? 1 : -1, wholeWord: true }
      return this.searchPattern(this.pattern, this.pattern.direction, count)
    }
    if (this.operator && !['H', 'M', 'L', 'Ctrl+d', 'Ctrl+u', 'Ctrl+f', 'Ctrl+b', 'PageDown', 'PageUp'].includes(key)) return this.notice('Expected a yank motion or text object')
    if (key === 'v' || key === 'V') {
      const next = key === 'v' ? 'visual' : 'visual-line'
      if (this.mode === next) { this.mode = 'normal'; this.anchor = undefined }
      else { this.anchor ??= { ...this.cursor }; this.mode = next }
      return this.done()
    }
    if (key === 'o' && this.mode !== 'normal') {
      const anchor = this.anchor!; this.anchor = this.cursor; this.cursor = anchor
      return this.done({ cursor: { ...this.cursor } })
    }
    if (key === 'Y') return this.mode !== 'normal' ? this.yankSelection() : this.yankLines(this.cursor.line, this.cursor.line + count - 1)
    if (key === 'c') return this.done({ comment: true })
    if (key === 'F1') return this.done({ help: true })
    const page = Math.max(1, Math.floor(context.viewportLines ?? 20))
    if (['Ctrl+d', 'Ctrl+u', 'Ctrl+f', 'Ctrl+b', 'PageDown', 'PageUp'].includes(key)) {
      const down = key === 'Ctrl+d' || key === 'Ctrl+f' || key === 'PageDown'
      const half = key === 'Ctrl+d' || key === 'Ctrl+u'
      const lines = half ? Math.max(1, Math.floor(page / 2)) : Math.max(1, page - 2)
      const before = this.cursor.line
      const result = this.vertical((down ? 1 : -1) * (half && hasCount ? count : lines * count))
      if (result.yank !== undefined) return result
      return { ...result, scroll: down ? 'page-down' : 'page-up', scrollLines: Math.abs(this.cursor.line - before) }
    }
    if (key === 'Ctrl+e' || key === 'Ctrl+y') {
      const scroll = key === 'Ctrl+e' ? 'line-down' : 'line-up'
      if (context.firstVisibleLine === undefined || context.lastVisibleLine === undefined) return this.done({ scroll, scrollLines: count })
      const first = Math.max(1, Math.min(this.lines.length, context.firstVisibleLine))
      const last = Math.max(first, Math.min(this.lines.length, context.lastVisibleLine))
      const height = last - first
      const nextFirst = Math.max(1, Math.min(this.lines.length - height, first + (key === 'Ctrl+e' ? count : -count)))
      const line = Math.max(nextFirst, Math.min(nextFirst + height, this.cursor.line))
      const result: VimResult = { handled: true, scroll, scrollLines: Math.abs(nextFirst - first) }
      if (line !== this.cursor.line) {
        this.preferredColumn ??= this.cursor.column
        this.cursor = clampVimCursor(this.source, { line, column: this.preferredColumn })
        result.cursor = { ...this.cursor }
      }
      return this.done(result)
    }
    if (key === 'H' || key === 'M' || key === 'L') {
      const top = context.firstVisibleLine ?? 1
      const bottom = context.lastVisibleLine ?? Math.min(this.lines.length, top + page - 1)
      return this.move(this.first(key === 'H' ? Math.min(bottom, top + count - 1) : key === 'L' ? Math.max(top, bottom - count + 1) : Math.floor((top + bottom) / 2)), { linewise: true })
    }
    if (key === 'Ctrl+o' || key === 'Ctrl+i') {
      if (this.jumps.length === 0) return this.notice('Jump list is empty')
      if (this.jumpIndex < 0) { this.jumps.push({ ...this.cursor }); this.jumpIndex = this.jumps.length - 1 }
      this.jumpIndex = Math.max(0, Math.min(this.jumps.length - 1, this.jumpIndex + (key === 'Ctrl+o' ? -count : count)))
      this.cursor = { ...this.jumps[this.jumpIndex]! }
      this.preferredColumn = undefined
      return this.done({ cursor: { ...this.cursor }, jump: true })
    }
    if (['i', 'I', 'a', 'A', 'o', 'O', 'd', 'D', 's', 'S', 'x', 'X', 'p', 'P', 'r', 'R', 'u', 'U', 'C', 'J', '~', '.', 'Ctrl+r'].includes(key)) return this.notice(READ_ONLY)
    this.clearPending()
    return { handled: false }
  }
}
