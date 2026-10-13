import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags } from '@lezer/highlight'
import { getCM, Vim, vim, type CodeMirror, type ExParams } from '@replit/codemirror-vim'
import type { VimCursor } from './source-vim.js'
import { sourceEditorSource, sourceEditorText } from './source-editor-text.js'

export type SourceEditorMode = 'normal' | 'insert' | 'replace' | 'visual' | 'visual-line' | 'visual-block'

export interface SourceEditorHandle {
  focus(): void
  command(key: string): void
  cursor(): VimCursor
  setCursor(cursor: VimCursor): void
  source(): string
  /** Explicit reload; initialSource is otherwise read only at mount. */
  replaceSource(source: string, cursor?: VimCursor): void
}

export interface SourceEditorProps {
  initialSource: string
  path: string
  initialCursor: VimCursor
  lineWrap: boolean
  active: boolean
  dark?: boolean
  startKey?: string
  onChange(source: string): void
  onCursor(cursor: VimCursor): void
  onMode(mode: SourceEditorMode): void
  onSave(): Promise<boolean>
  /** Return to review while retaining this editor's buffer and undo history. */
  onReview(): void
}

interface EditorCommands {
  save(reviewAfter: boolean): void
  review(): void
}

// Vim's Ex command table is module-global. Keep callbacks attached to the exact
// editor that invoked the command, so a hidden pane cannot save a different file.
const editorCommands = new WeakMap<object, EditorCommands>()

function acceptsCurrentFile(params: ExParams, cm: Parameters<typeof Vim.handleKey>[0]): boolean {
  if (!(params.argString ?? '').trim()) return true
  cm.openNotification(document.createTextNode('This command only applies to the current file.'), { bottom: true, duration: 3500 })
  return false
}

Vim.defineEx('write', 'w', (cm, params) => {
  if (acceptsCurrentFile(params, cm)) editorCommands.get(cm)?.save(false)
})
Vim.defineEx('wq', 'wq', (cm, params) => {
  if (acceptsCurrentFile(params, cm)) editorCommands.get(cm)?.save(true)
})
Vim.defineEx('xit', 'x', (cm, params) => {
  if (acceptsCurrentFile(params, cm)) editorCommands.get(cm)?.save(true)
})
Vim.defineEx('quit', 'q', (cm, params) => {
  if (acceptsCurrentFile(params, cm)) editorCommands.get(cm)?.review()
})

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--canvas)', fontSize: 'var(--type-label)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', overscrollBehavior: 'contain', fontFamily: 'var(--mono)', lineHeight: '20px' },
  '.cm-content': { padding: 'var(--space-2) 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 var(--space-3)' },
  '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--canvas)', borderColor: 'var(--border-soft)' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3em', padding: '0 var(--space-2)' },
  '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, var(--canvas))' },
  '&.cm-focused .cm-fat-cursor': { color: 'var(--canvas)', backgroundColor: 'var(--accent)' },
  '&:not(.cm-focused) .cm-fat-cursor': { outlineColor: 'var(--accent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--yellow) 24%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)', outline: '1px solid var(--accent)' },
  '.cm-matchingBracket': { color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' },
  '.cm-panels': { color: 'var(--text)', backgroundColor: 'var(--panel-solid)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border-soft)' },
  '.cm-vim-panel': { minHeight: 'var(--control-compact)', padding: 'var(--space-1) var(--space-3)', alignItems: 'center', gap: 'var(--space-1)', fontFamily: 'var(--mono)', overflowWrap: 'anywhere' },
  '.cm-vim-panel input': { flex: '1 1 auto', width: '100%', minWidth: '0', color: 'var(--text)', font: 'inherit', caretColor: 'var(--accent)' },
  '.cm-tooltip': { color: 'var(--text)', backgroundColor: 'var(--panel-solid)', border: '1px solid var(--border)', borderRadius: 'var(--radius-dense)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: 'var(--text)', backgroundColor: 'var(--accent-soft)' },
  '.cm-foldPlaceholder': { color: 'var(--text-muted)', backgroundColor: 'var(--panel-soft)', border: '1px solid var(--border-soft)' },
})

const editorHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment, color: 'var(--code-block-comment, var(--muted))' },
  { tag: tags.keyword, color: 'var(--code-block-keyword, var(--accent))' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-block-string, var(--green))' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--code-block-number, var(--yellow))' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-block-function, var(--accent))' },
  { tag: [tags.className, tags.typeName, tags.namespace], color: 'var(--code-block-class, var(--accent))' },
  { tag: tags.propertyName, color: 'var(--code-block-property, var(--text))' },
  { tag: tags.variableName, color: 'var(--code-block-variable, var(--text))' },
  { tag: tags.operator, color: 'var(--code-block-operator, var(--text))' },
  { tag: tags.punctuation, color: 'var(--code-block-punctuation, var(--text-muted))' },
  { tag: tags.regexp, color: 'var(--code-block-regex, var(--yellow))' },
  { tag: tags.invalid, color: 'var(--danger)' },
]))

function cursorOf(view: EditorView): VimCursor {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return { line: line.number, column: head - line.from }
}

function positionOf(state: EditorState, cursor: VimCursor): number {
  const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, Math.floor(cursor.line) || 1)))
  return line.from + Math.max(0, Math.min(line.length, Math.floor(cursor.column) || 0))
}

function currentMode(cm: CodeMirror): SourceEditorMode {
  const state = cm.state.vim
  if (state?.insertMode) return cm.state.overwrite ? 'replace' : 'insert'
  if (state?.visualMode) return state.visualLine ? 'visual-line' : state.visualBlock ? 'visual-block' : 'visual'
  return 'normal'
}

/** One mounted editor per editable buffer retains undo, marks and Vim state. */
export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor(props, ref) {
  const element = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const initial = useRef(props)
  const wrapping = useRef(new Compartment())
  const appearance = useRef(new Compartment())
  const language = useRef(new Compartment())
  const replaceSource = useRef<(source: string, cursor?: VimCursor) => void>(() => {})

  useImperativeHandle(ref, () => ({
    focus() { editor.current?.focus() },
    command(key) {
      const view = editor.current
      const cm = view && getCM(view)
      if (cm) cm.operation(() => { Vim.handleKey(cm, key, 'user') })
    },
    cursor() { return editor.current ? cursorOf(editor.current) : initial.current.initialCursor },
    setCursor(cursor) {
      const view = editor.current
      if (view) view.dispatch({ selection: { anchor: positionOf(view.state, cursor) }, scrollIntoView: true })
    },
    source() { return editor.current ? sourceEditorSource(editor.current.state) : initial.current.initialSource },
    replaceSource(source, cursor) { replaceSource.current(source, cursor) },
  }), [])

  useEffect(() => {
    if (!element.current) return
    let alive = true
    let saving = false
    let view: EditorView
    let cm!: CodeMirror
    let syntaxExtension: Extension = []
    const save = (reviewAfter: boolean) => {
      if (saving || !alive) return
      saving = true
      const savedSource = sourceEditorSource(view.state)
      void Promise.resolve().then(() => alive && callbacks.current.onSave()).then((saved) => {
        if (alive && saved && reviewAfter && callbacks.current.active && sourceEditorSource(view.state) === savedSource) review()
      }).catch((error: unknown) => {
        if (!alive) return
        getCM(view)?.openNotification(document.createTextNode(error instanceof Error ? error.message : 'Could not save this file.'), { bottom: true, duration: 5000 })
      }).finally(() => { saving = false })
    }
    const review = () => {
      if (!alive) return
      const cm = getCM(view)
      if (cm) cm.operation(() => { Vim.handleKey(cm, '<Esc>', 'user') })
      callbacks.current.onReview()
    }
    const starting = initial.current
    const createState = (source: string): EditorState => {
      const text = sourceEditorText(source)
      return EditorState.create({
        doc: text.doc,
        extensions: [
          // A high-priority keymap would also lift basicSetup's Escape handler
          // ahead of Vim. Intercept only Save and leave Vim's key ordering intact.
          Prec.highest(EditorView.domEventHandlers({ keydown(event) {
            if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return false
            event.preventDefault()
            event.stopPropagation()
            save(false)
            return true
          } })),
          vim(),
          basicSetup,
          keymap.of([indentWithTab]),
          editorTheme,
          editorHighlighting,
          wrapping.current.of(callbacks.current.lineWrap ? EditorView.lineWrapping : []),
          appearance.current.of(EditorView.theme({}, { dark: callbacks.current.dark ?? false })),
          language.current.of(syntaxExtension),
          text.extension,
          EditorView.contentAttributes.of({ 'aria-label': `Edit ${starting.path}`, spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (!alive) return
            if (update.docChanged) callbacks.current.onChange(sourceEditorSource(update.state))
            if (update.docChanged || update.selectionSet) callbacks.current.onCursor(cursorOf(update.view))
          }),
        ],
      })
    }
    const state = createState(starting.initialSource)
    view = new EditorView({ state, parent: element.current })
    editor.current = view
    const modeChanged = () => { if (alive) callbacks.current.onMode(currentMode(cm)) }
    const bindCommands = () => {
      cm = getCM(view)!
      cm.on('vim-mode-change', modeChanged)
      editorCommands.set(cm, { save, review })
    }
    const unbindCommands = () => {
      editorCommands.delete(cm)
      cm.off('vim-mode-change', modeChanged)
      cm.state.currentNotificationClose?.()
      cm.state.closeVimNotification?.()
    }
    bindCommands()
    view.dispatch({ selection: { anchor: positionOf(state, starting.initialCursor) }, scrollIntoView: true })
    modeChanged()
    if (starting.startKey) cm.operation(() => { Vim.handleKey(cm, starting.startKey!, 'user') })

    replaceSource.current = (source, cursor) => {
      if (!alive || sourceEditorSource(view.state) === source) return
      const next = createState(source)
      const position = positionOf(next, cursor ?? cursorOf(view))
      unbindCommands()
      // A disk reload is a new undo baseline. It must not report a user edit.
      view.setState(next.update({ selection: { anchor: position } }).state)
      bindCommands()
      modeChanged()
      view.dispatch({ effects: EditorView.scrollIntoView(position) })
    }

    const syntax = LanguageDescription.matchFilename(languages, starting.path)
    if (syntax) void syntax.load().then((support) => {
      if (!alive) return
      syntaxExtension = support
      view.dispatch({ effects: language.current.reconfigure(support) })
    }).catch(() => { /* Plain text editing remains available if a parser fails. */ })

    return () => {
      alive = false
      unbindCommands()
      replaceSource.current = () => {}
      editor.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    editor.current?.dispatch({ effects: wrapping.current.reconfigure(props.lineWrap ? EditorView.lineWrapping : []) })
  }, [props.lineWrap])

  useEffect(() => {
    editor.current?.dispatch({ effects: appearance.current.reconfigure(EditorView.theme({}, { dark: props.dark ?? false })) })
  }, [props.dark])

  useEffect(() => {
    const view = editor.current
    if (!props.active || !view) return
    view.requestMeasure()
    view.focus()
  }, [props.active])

  return <div ref={element} className="source-editor" />
})
