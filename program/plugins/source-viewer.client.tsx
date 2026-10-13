import { paneToolbarStyles } from './pane-toolbar.js'
import {
  FileCode2,
  Keyboard as KeyboardIcon,
  MessageSquarePlus,
  RefreshCw,
  Pencil,
  Save,
  BookOpen,
  Send,
  TextWrap,
  Trash2,
  X,
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
import type {
  CodeViewFileItem,
  CodeViewLineSelection,
  LineAnnotation,
} from '@pierre/diffs'
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
} from '@pierre/diffs/react'
import {
  clientStyles,
  type BrowserPlugin,
  type ClientDraft,
  type ClientHostService,
  type ClientUiService,
} from '../../src/client/plugin-api.js'
import type { JsonValue } from '../../src/shared/protocol.js'
import type { ClientCodeExplorerService } from './code-explorer-api.js'
import type { MarkdownFileLinkDetails } from './markdown-api.js'
import {
  parseSourceDocument,
  parseSourceViewerResource,
  SOURCE_VIEWER_PANE_KIND,
  SOURCE_VIEWER_READ_METHOD,
  SOURCE_VIEWER_SAVE_METHOD,
  sourceViewerResource,
  type SourceDocument,
  type SourceLocation,
} from './source-viewer-api.js'
import {
  clampVimCursor,
  vimCursorOffset,
  type VimCursor,
} from './source-vim.js'
import { SourceEditor, type SourceEditorHandle } from './source-editor.client.js'
import { readSourceEditDraft, registerSourceDraftOwner, writeSourceEditDraft } from './source-editor-drafts.js'
import { SourceVimController, type VimResult } from './source-vim-controller.js'
import { clearSourceTextSelection, clearVimDecorations, paintVimDecorations, revealVimColumn, sourcePointerPosition, sourceTextSelection, sourceViewport } from './source-vim-dom.js'
import type {
  ClientWorkspaceLayoutService,
  WorkspacePaneKindProps,
  WorkspacePaneTarget,
} from './workspace-layout-api.js'
import { useThemeAppearance } from './theme-runtime.js'
import { useLineWrapPreference } from './viewer-preferences.js'
import {
  ALTO_SHARED_CODE_THEMES,
  ensureAltoSharedCodeTheme,
} from './shared-code-theme.js'
import { useViewerActivated } from './viewer-activation.js'
import { sourcePath } from './source-paths.js'
import styles from './source-viewer.css'

ensureAltoSharedCodeTheme()

const PIERRE_SOURCE_STYLES = `
  [data-line][data-alto-vim-cursor]::before {
    content: "";
    position: absolute;
    z-index: 4;
    top: var(--alto-vim-y, 1px);
    left: var(--alto-vim-x, 1ch);
    width: var(--alto-vim-width, .8ch);
    height: var(--alto-vim-height, 1.4em);
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--diffs-modified-base) 72%, transparent);
    border-radius: 1.5px;
    background: color-mix(in srgb, var(--diffs-modified-base) 24%, transparent);
    pointer-events: none;
  }
  [data-line] { position: relative; }
  [data-alto-vim-selection] {
    position: absolute;
    pointer-events: none;
    background: color-mix(in srgb, var(--diffs-modified-base) 24%, transparent);
    border-radius: calc(var(--radius-dense) / 6);
  }
  @media (prefers-reduced-motion: no-preference) {
    [data-line][data-alto-vim-cursor]::before {
      animation: alto-vim-cursor-blink 1.1s step-end infinite;
    }
  }
  @keyframes alto-vim-cursor-blink {
    0%, 48% { opacity: 1; }
    49%, 100% { opacity: .28; }
  }
  .source-review-comment {
    margin: 7px 12px 9px;
    padding: 9px 11px 10px;
    border: 1px solid color-mix(in srgb, var(--diffs-modified-base) 22%, var(--diffs-bg-context));
    border-radius: 10px;
    color: var(--diffs-fg);
    background: color-mix(in srgb, var(--diffs-modified-base) 4%, var(--diffs-bg));
    font-family: var(--diffs-header-font-family);
    font-size: 12px;
    line-height: 1.45;
  }
  .source-review-comment > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--diffs-fg-number);
    font-size: 10.5px;
  }
  .source-review-comment button {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    color: var(--diffs-fg-number);
    background: transparent;
  }
  .source-review-comment button:hover {
    color: var(--diffs-fg);
    background: var(--diffs-bg-context);
  }
  .source-review-comment p { margin: 3px 0 0; white-space: pre-wrap; }
`

interface SourceComment {
  id: string
  path: string
  revision: string
  start: number
  end: number
  body: string
  createdAt: string
}

interface CommentDraft {
  start: number
  end: number
  body: string
}

type ViewerState =
  | { tag: 'idle' | 'loading' }
  | { tag: 'ready'; document: SourceDocument }
  | { tag: 'failed'; problem: string }

interface EditBuffer {
  document: SourceDocument
  source: string
  requestedPath: string
  editing: boolean
  mounted: boolean
  initialCursor: VimCursor
  startKey?: string
  cursor: VimCursor
  mode: string
  saving: boolean
  message: string
  problem?: string | undefined
  editor?: SourceEditorHandle | undefined
}

type CommandMode = 'forward' | 'backward' | 'ex'

function initialCursor(location: SourceLocation | undefined): VimCursor {
  return {
    line: location?.line ?? 1,
    column: Math.max(0, (location?.column ?? 1) - 1),
  }
}


function commentsKey(filePath: string): string {
  return `alto.source-review-comments.v1:${filePath}`
}

function parsedComments(value: unknown): SourceComment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((comment) => {
    if (
      !comment || typeof comment !== 'object'
      || !('id' in comment) || typeof comment.id !== 'string'
      || !('path' in comment) || typeof comment.path !== 'string'
      || !('revision' in comment) || typeof comment.revision !== 'string'
      || !('start' in comment) || typeof comment.start !== 'number'
      || !('end' in comment) || typeof comment.end !== 'number'
      || !('body' in comment) || typeof comment.body !== 'string'
      || !('createdAt' in comment) || typeof comment.createdAt !== 'string'
    ) return []
    return [{
      id: comment.id,
      path: comment.path,
      revision: comment.revision,
      start: comment.start,
      end: comment.end,
      body: comment.body,
      createdAt: comment.createdAt,
    }]
  })
}

function loadComments(filePath: string): SourceComment[] {
  try {
    return parsedComments(JSON.parse(localStorage.getItem(commentsKey(filePath)) ?? '[]'))
  } catch {
    return []
  }
}

function saveComments(filePath: string, comments: readonly SourceComment[]): void {
  try {
    localStorage.setItem(commentsKey(filePath), JSON.stringify(comments))
  } catch {
    // Source review remains usable for this session when storage is unavailable.
  }
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `Line ${start}` : `Lines ${start}–${end}`
}

function sourceReviewPrompt(comments: readonly SourceComment[]): string {
  const details = comments.map((comment) => (
    `- \`${comment.path}:${comment.start}${comment.end === comment.start ? '' : `-${comment.end}`}\`\n  ${comment.body}`
  )).join('\n\n')
  return `Please address these source review comments:\n\n${details}`
}

function targetChat(
  layout: ClientWorkspaceLayoutService,
  threadId: string | undefined,
  workspaceId: string,
): WorkspacePaneTarget | undefined {
  const targets = layout.paneTargets()
  return (threadId ? targets.find((target) => target.session.snapshot().threadId === threadId) : undefined)
    ?? targets.find((target) => target.workspaceId === workspaceId && target.focused)
    ?? targets.find((target) => target.workspaceId === workspaceId)
}

function submitTarget(target: WorkspacePaneTarget) {
  const state = target.session.snapshot()
  return {
    id: `${target.workspaceId}:${target.paneId}`,
    ...(state.threadId ? { threadId: state.threadId } : {}),
    activeTurn: state.turn.tag !== 'idle',
    send: (draft: ClientDraft) => target.session.send(draft),
    steer: (draft: ClientDraft) => target.session.steer(draft),
  }
}

function SourceAnnotation({
  comment,
  remove,
}: {
  comment: SourceComment
  remove(id: string): void
}): ReactNode {
  return (
    <article className="source-review-comment">
      <div>
        <span>{rangeLabel(comment.start, comment.end)}</span>
        <button type="button" title="Remove" aria-label="Remove source comment" onClick={() => remove(comment.id)}>
          <Trash2 size={13} strokeWidth={1.7} />
        </button>
      </div>
      <p>{comment.body}</p>
    </article>
  )
}

function SourceCommentComposer({
  draft,
  change,
  cancel,
  add,
}: {
  draft: CommentDraft
  change(body: string): void
  cancel(): void
  add(): void
}): ReactNode {
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => input.current?.focus({ preventScroll: true }), [draft.start, draft.end])
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      add()
    }
  }
  return (
    <section className="source-review-draft">
      <div className="source-review-draft-heading">
        <span>{rangeLabel(draft.start, draft.end)}</span>
        <button type="button" aria-label="Cancel comment" onClick={cancel}><X size={13} /></button>
      </div>
      <textarea
        ref={input}
        rows={3}
        value={draft.body}
        placeholder="Ask Alto about these lines…"
        onChange={(event) => change(event.target.value)}
        onKeyDown={keyDown}
      />
      <div className="source-review-draft-actions">
        <button type="button" onClick={cancel}>Cancel</button>
        <button className="primary" type="button" disabled={!draft.body.trim()} onClick={add}>Add comment</button>
      </div>
    </section>
  )
}

function SourceViewerPane({
  workspaceId,
  pane,
  focused,
  visible,
  host,
  layout,
  ui,
  explorers,
}: WorkspacePaneKindProps & {
  host: ClientHostService
  layout: ClientWorkspaceLayoutService
  ui: ClientUiService
  explorers: ClientCodeExplorerService
}): ReactNode {
  const initial = parseSourceViewerResource(pane.resource)
  const [location, setLocation] = useState<SourceLocation | undefined>(initial)
  const activated = useViewerActivated(visible)
  const [reload, setReload] = useState(0)
  const buffers = useRef(new Map<string, EditBuffer>())
  const [, updateBuffers] = useState(0)
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const discardPanel = useRef<HTMLElement>(null)
  const seenReload = useRef(reload)
  const [recoveryProblem, setRecoveryProblem] = useState('')
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  const draftOwner = `${workspaceId}:${pane.id}`
  const publishBuffers = (): void => { if (alive.current) updateBuffers((version) => version + 1) }
  const persistBuffers = (): void => {
    if (draftTimer.current !== undefined) clearTimeout(draftTimer.current)
    draftTimer.current = undefined
    try {
      for (const buffer of buffers.current.values()) writeSourceEditDraft(draftOwner, buffer)
      if (alive.current) setRecoveryProblem('')
    } catch {
      if (alive.current) setRecoveryProblem('Draft recovery is unavailable. Save your changes before closing Alto.')
    }
  }
  const scheduleDraft = (): void => {
    if (draftTimer.current !== undefined) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(persistBuffers, 300)
  }
  useEffect(() => {
    alive.current = true
    const releaseOwner = registerSourceDraftOwner(draftOwner)
    const flush = (): void => persistBuffers()
    window.addEventListener('beforeunload', flush)
    return () => {
      alive.current = false
      window.removeEventListener('beforeunload', flush)
      persistBuffers()
      releaseOwner()
    }
  }, [])
  const [state, setState] = useState<ViewerState>({ tag: 'idle' })
  const [lineWrap, setLineWrap] = useLineWrapPreference('source')
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)
  const vim = useRef(new SourceVimController('', initialCursor(initial)))
  const [vimState, setVimState] = useState(vim.current.state)
  const cursor = vimState.cursor
  const [comments, setComments] = useState<SourceComment[]>([])
  const [commentVersion, setCommentVersion] = useState(0)
  const [draft, setDraft] = useState<CommentDraft>()
  const [command, setCommand] = useState<CommandMode>()
  const [commandValue, setCommandValue] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [clipboardMessage, setClipboardMessage] = useState('')
  const [sendProblem, setSendProblem] = useState<string>()
  const [sending, setSending] = useState(false)
  const [activeTreePath, setActiveTreePath] = useState(initial?.path)
  const viewer = useRef<CodeViewHandle<SourceComment>>(null)
  const paneRoot = useRef<HTMLElement>(null)
  const codeContainer = useRef<HTMLDivElement>(null)
  const helpPanel = useRef<HTMLElement>(null)
  const paintFrame = useRef<number | undefined>(undefined)
  const focusFrame = useRef<number | undefined>(undefined)
  const revealCursor = useRef(false)
  const actionVersion = useRef(0)
  const mouseSelection = useRef<{ pointerId: number; anchor: VimCursor; shift: boolean } | undefined>(undefined)
  const commandInput = useRef<HTMLInputElement>(null)
  const explorerState = useSyncExternalStore(explorers.subscribe, explorers.snapshot)
  const theme = useThemeAppearance()

  useEffect(() => {
    const next = parseSourceViewerResource(pane.resource)
    if (!next) return
    setLocation(next)
    setActiveTreePath(next.path)
  }, [pane.resource])

  useEffect(() => {
    if (!activated || !location?.path) return
    let current = true
    setState({ tag: 'loading' })
    setDiscardPrompt(false)
    const requestedPath = location.path
    const refresh = seenReload.current !== reload
    seenReload.current = reload
    const retained = buffers.current.get(requestedPath)
      ?? [...buffers.current.values()].find((buffer) => buffer.requestedPath === requestedPath)
    const recovered = !retained && readSourceEditDraft(draftOwner, requestedPath)
    const payload: JsonValue = { path: requestedPath }
    // Reopening a retained buffer never needs a successful disk read. A file may
    // have been removed externally while its unsaved draft still needs recovery.
    const read = retained && !refresh
      ? Promise.resolve(retained.document as unknown as JsonValue)
      : recovered ? Promise.resolve(recovered.document as unknown as JsonValue)
      : host.call(SOURCE_VIEWER_READ_METHOD, payload)
    void read.then((value) => {
      if (!current) return
      const loaded = parseSourceDocument(value)
      let buffer = buffers.current.get(loaded.path)
      if (!buffer) {
        const recovered = readSourceEditDraft(draftOwner, loaded.path)
        const document = recovered?.document ?? loaded
        buffer = {
          document, source: recovered?.source ?? document.source, requestedPath,
          editing: !!recovered, mounted: !!recovered, cursor: initialCursor(location),
          initialCursor: initialCursor(location), mode: 'normal', saving: false,
          message: recovered ? 'Unsaved draft restored' : '',
        }
        buffers.current.set(loaded.path, buffer)
      } else if (refresh && buffer.source === buffer.document.source && !buffer.saving) {
        // Clean buffers follow disk; dirty buffers retain the revision they started from.
        buffer.document = loaded
        buffer.source = loaded.source
        buffer.editor?.replaceSource(loaded.source, buffer.cursor)
      }
      const document = buffer.document
      publishBuffers()
      setComments(loadComments(document.path))
      setCommentVersion((version) => version + 1)
      setSelection(null)
      setDraft(undefined)
      vim.current = new SourceVimController(document.source, location.line ? initialCursor(location) : buffer.cursor)
      setVimState({ ...vim.current.state })
      setCommand(undefined)
      setShowHelp(false)
      setClipboardMessage('')
      mouseSelection.current = undefined
      actionVersion.current += 1
      setState({ tag: 'ready', document })
    }).catch((error: unknown) => {
      if (current) setState({ tag: 'failed', problem: error instanceof Error ? error.message : String(error) })
    })
    return () => { current = false }
  }, [activated, host, location?.path, reload])

  const document = state.tag === 'ready' ? state.document : undefined
  const editBuffer = document ? buffers.current.get(document.path) : undefined
  const editing = editBuffer?.editing ?? false
  const dirty = !!editBuffer && editBuffer.source !== editBuffer.document.source
  const displayedCursor = editing && editBuffer ? editBuffer.cursor : cursor

  const enterEditor = (key?: string): void => {
    if (!editBuffer) return
    const position = vim.current.state.cursor
    editBuffer.editing = true
    editBuffer.cursor = position
    if (!editBuffer.mounted) {
      editBuffer.mounted = true
      editBuffer.initialCursor = position
      if (key) editBuffer.startKey = key
    } else {
      editBuffer.editor?.command('<Esc>')
      editBuffer.editor?.setCursor(position)
      if (key) editBuffer.editor?.command(key)
      editBuffer.editor?.focus()
    }
    setDraft(undefined)
    setCommand(undefined)
    setShowHelp(false)
    publishBuffers()
  }

  const reviewBuffer = (buffer: EditBuffer): void => {
    buffer.editor?.command('<Esc>')
    buffer.cursor = buffer.editor?.cursor() ?? buffer.cursor
    buffer.editing = false
    if (buffer === editBuffer) {
      vim.current.setCursor(buffer.cursor)
      publishVimState()
      reveal({ handled: true, cursor: buffer.cursor, jump: true })
      focusSource()
    }
    publishBuffers()
  }

  const saveBuffer = async (buffer: EditBuffer): Promise<boolean> => {
    if (buffer.saving) return false
    if (buffer.source === buffer.document.source) { buffer.message = 'Saved'; publishBuffers(); return true }
    const submitted = buffer.source
    const original = buffer.document
    buffer.saving = true
    buffer.problem = undefined
    buffer.message = ''
    publishBuffers()
    try {
      const saved = parseSourceDocument(await host.call(SOURCE_VIEWER_SAVE_METHOD, {
        path: original.path, source: submitted, expectedRevision: original.revision,
      }))
      if (!alive.current) return false
      // Edits made during this request remain dirty against the newly saved revision.
      buffer.document = saved
      if (buffer.source === submitted) {
        buffer.source = saved.source
        if (saved.source !== submitted && alive.current) buffer.editor?.replaceSource(saved.source, buffer.cursor)
      }
      buffer.message = buffer.source === saved.source ? 'Saved' : 'Unsaved changes'
      persistBuffers()
      if (alive.current) {
        setState((current) => current.tag === 'ready' && current.document.path === saved.path
          ? { tag: 'ready', document: saved } : current)
        if (buffer === activeBuffer.current) {
          const position = buffer.editor?.cursor() ?? buffer.cursor
          vim.current = new SourceVimController(saved.source, position)
          setVimState({ ...vim.current.state })
          setLocation((current) => current ? { path: current.path, line: position.line, column: position.column + 1 } : current)
        }
      }
      return buffer.source === saved.source
    } catch (error) {
      buffer.problem = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      buffer.saving = false
      publishBuffers()
    }
  }
  const activeBuffer = useRef(editBuffer)
  activeBuffer.current = editBuffer

  const discardChanges = (): void => {
    if (!editBuffer || editBuffer.saving) return
    editBuffer.source = editBuffer.document.source
    editBuffer.editor?.replaceSource(editBuffer.source, editBuffer.cursor)
    editBuffer.problem = undefined
    editBuffer.message = ''
    persistBuffers()
    setDiscardPrompt(false)
    setReload((value) => value + 1)
    publishBuffers()
  }

  const currentComments = useMemo(() => comments.filter((comment) => (
    comment.revision === document?.revision
  )), [comments, document?.revision])
  const staleComments = comments.length - currentComments.length
  const item = useMemo<CodeViewFileItem<SourceComment> | undefined>(() => {
    if (!document) return undefined
    const annotations: LineAnnotation<SourceComment>[] = currentComments.map((comment) => ({
      lineNumber: comment.end,
      metadata: comment,
    }))
    return {
      id: `${document.path}:${document.revision}`,
      type: 'file',
      file: {
        name: document.name,
        contents: document.source,
        cacheKey: document.revision,
      },
      annotations,
      version: commentVersion,
    }
  }, [commentVersion, currentComments, document])

  const renderedRoot = (): ShadowRoot | undefined => viewer.current?.getInstance()
    ?.getRenderedItems().find((rendered) => rendered.id === item?.id)?.element.shadowRoot ?? undefined

  const focusSource = (): void => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined
      if (activeBuffer.current?.editing) activeBuffer.current.editor?.focus()
      else paneRoot.current?.focus({ preventScroll: true })
    })
  }

  const syncVimCursor = (): void => {
    const root = renderedRoot()
    if (!root) return
    if (!focused || !visible || editing || command || showHelp || draft) {
      clearVimDecorations(root)
      return
    }
    if (revealCursor.current) revealCursor.current = !revealVimColumn(root, vim.current.state.cursor, codeContainer.current)
    paintVimDecorations(root, vim.current.state.cursor, sourceTextSelection(root, document?.source ?? '') ? undefined : vim.current.selection())
  }
  const syncVimCursorRef = useRef(syncVimCursor)
  syncVimCursorRef.current = syncVimCursor
  const schedulePaint = (): void => {
    if (paintFrame.current !== undefined) cancelAnimationFrame(paintFrame.current)
    paintFrame.current = requestAnimationFrame(() => {
      paintFrame.current = undefined
      syncVimCursorRef.current()
    })
  }

  const publishVimState = (): void => {
    const next = vim.current.state
    if (editBuffer && !editing) editBuffer.cursor = next.cursor
    setVimState({ ...next })
    const visual = vim.current.selection()
    if (item) setSelection({ id: item.id, range: {
      start: visual?.start.line ?? next.cursor.line,
      end: visual?.end.line ?? next.cursor.line,
    } })
  }

  const finishMouseSelection = (event: PointerEvent): void => {
    const mouse = mouseSelection.current
    if (!mouse || mouse.pointerId !== event.pointerId) return
    mouseSelection.current = undefined
    const root = renderedRoot()
    if (!focused || !visible || !root || !document) return
    const selected = sourceTextSelection(root, document.source)
    const point = sourcePointerPosition(root, event.clientX, event.clientY)
    if (selected) vim.current.select(selected.anchor, selected.cursor, false)
    else if (point && mouse.shift) vim.current.select(mouse.anchor, point, false)
    else if (point) vim.current.setCursor(point)
    else return
    publishVimState()
    setClipboardMessage('')
    focusSource()
  }
  const finishMouseSelectionRef = useRef(finishMouseSelection)
  finishMouseSelectionRef.current = finishMouseSelection
  useEffect(() => {
    const finish = (event: PointerEvent): void => finishMouseSelectionRef.current(event)
    const cancel = (): void => { mouseSelection.current = undefined }
    window.document.addEventListener('pointerup', finish)
    window.document.addEventListener('pointercancel', cancel)
    return () => {
      window.document.removeEventListener('pointerup', finish)
      window.document.removeEventListener('pointercancel', cancel)
    }
  }, [])

  const reveal = (result: VimResult): void => {
    if (!item) return
    const next = vim.current.state.cursor
    revealCursor.current = !!result.cursor
    const scroll = result.scroll
    if (scroll === 'line-up' || scroll === 'line-down' || scroll === 'page-up' || scroll === 'page-down') {
      const row = renderedRoot()?.querySelector<HTMLElement>('[data-line]')
      const height = row ? parseFloat(getComputedStyle(row).lineHeight) || 20 : 20
      const container = codeContainer.current
      // Position targets in CodeView compensate for the sticky file header.
      // Relative viewport scrolling must instead update the actual scroller.
      if (container) container.scrollTop += (scroll.endsWith('up') ? -height : height) * (result.scrollLines ?? 1)
      if (scroll.startsWith('page')) viewer.current?.scrollTo({ type: 'line', id: item.id, lineNumber: next.line, align: 'nearest', behavior: 'instant' })
    } else if (result.cursor || scroll) {
      const align = scroll === 'top' ? 'start' : scroll === 'bottom' ? 'end'
        : scroll === 'center' || result.jump ? 'center' : 'nearest'
      viewer.current?.scrollTo({ type: 'line', id: item.id, lineNumber: next.line, align, behavior: 'instant' })
      const root = renderedRoot()
      if (root) revealVimColumn(root, next, codeContainer.current)
    }
  }

  const commentOnSelection = (): void => {
    if (!selection) return
    setDraft({ start: Math.min(selection.range.start, selection.range.end),
      end: Math.max(selection.range.start, selection.range.end), body: '' })
  }

  const applyVimResult = (result: VimResult): void => {
    const version = ++actionVersion.current
    setClipboardMessage('')
    publishVimState()
    reveal(result)
    if (result.command) {
      setCommand(result.command)
      setCommandValue('')
    }
    if (result.help) setShowHelp(true)
    if (result.comment) commentOnSelection()
    if (result.yank !== undefined) {
      const copy = navigator.clipboard?.writeText(result.yank)
      if (!copy) setClipboardMessage('Clipboard is unavailable')
      else void copy.then(() => {
        if (actionVersion.current === version) setClipboardMessage('Copied to clipboard')
      }, () => {
        if (actionVersion.current === version) setClipboardMessage('Could not copy to clipboard')
      })
    }
  }

  useEffect(() => {
    if (!item || !document) return
    const position = location?.line ? initialCursor(location) : editBuffer?.cursor ?? initialCursor(location)
    if (editing) editBuffer?.editor?.setCursor(position)
    revealCursor.current = true
    mouseSelection.current = undefined
    const next = clampVimCursor(document.source, position)
    vim.current.setCursor(next)
    setVimState({ ...vim.current.state })
    const end = Math.max(1, Math.min(document.lineCount, location?.endLine ?? next.line))
    if (end !== next.line) {
      vim.current.select(next, { line: end, column: 0 }, true)
      setVimState({ ...vim.current.state })
    }
    setSelection({ id: item.id, range: { start: next.line, end } })
    const frame = requestAnimationFrame(() => {
      viewer.current?.scrollTo({ type: 'line', id: item.id, lineNumber: next.line, align: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [item?.id, location?.line, location?.endLine, location?.column])

  useEffect(() => {
    if (command) commandInput.current?.focus({ preventScroll: true })
  }, [command])
  useEffect(() => {
    if (discardPrompt) discardPanel.current?.querySelector('button')?.focus()
  }, [discardPrompt])
  useEffect(() => {
    if (showHelp) helpPanel.current?.focus({ preventScroll: true })
  }, [showHelp])
  useEffect(() => {
    schedulePaint()
  }, [vimState, focused, visible, editing, command, showHelp, draft, item?.id, lineWrap])
  useEffect(() => {
    const container = codeContainer.current
    if (!container || !visible) return
    const observer = new ResizeObserver(schedulePaint)
    observer.observe(container)
    return () => observer.disconnect()
  }, [visible, item?.id])

  useEffect(() => {
    if (!focused || !visible) {
      mouseSelection.current = undefined
      vim.current.clearPending()
      setVimState({ ...vim.current.state })
      return
    }
    const active = window.document.activeElement
    if (active instanceof HTMLElement && active.closest('input, textarea, button, [contenteditable="true"]')) return
    if (activeBuffer.current?.editing) activeBuffer.current.editor?.focus()
    else paneRoot.current?.focus({ preventScroll: true })
  }, [focused, visible])

  useEffect(() => () => {
    actionVersion.current += 1
    if (paintFrame.current !== undefined) cancelAnimationFrame(paintFrame.current)
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current)
  }, [])

  const finishCommand = (): void => {
    if (command === 'ex' && /^(?:w|write)$/u.test(commandValue.trim()) && editBuffer) {
      setCommand(undefined)
      setCommandValue('')
      void saveBuffer(editBuffer)
      focusSource()
      return
    }
    const result = command === 'ex' ? vim.current.ex(commandValue)
      : vim.current.search(commandValue, command === 'backward' ? -1 : 1)
    setCommand(undefined)
    setCommandValue('')
    applyVimResult(result)
    if (!result.help) focusSource()
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (focused && visible && editBuffer && !editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      void saveBuffer(editBuffer)
      return
    }
    if (editing || discardPrompt) return
    if (!focused || !visible || !document || command || showHelp || event.metaKey || event.altKey || event.nativeEvent.isComposing) return
    if (event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
      && target.matches('input, textarea, button, select, [contenteditable="true"], [role="textbox"]'))) return
    if (!event.ctrlKey && vim.current.state.mode === 'normal' && !vim.current.state.pending && /^[iaIAoO]$/u.test(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      enterEditor(event.key)
      return
    }
    const root = renderedRoot()
    const mouseText = root ? sourceTextSelection(root, document.source)?.text : undefined
    const key = event.ctrlKey ? `Ctrl+${event.key.toLowerCase()}` : event.key
    const result = vim.current.key(key, sourceViewport(codeContainer.current, renderedRoot()))
    if (!result.handled) { publishVimState(); return }
    event.preventDefault()
    event.stopPropagation()
    if (root) clearSourceTextSelection(root)
    // Preserve an exact mouse range, including a selection ending at a newline.
    if (result.yank !== undefined && mouseText !== undefined) result.yank = mouseText
    applyVimResult(result)
  }

  const options = useMemo<CodeViewReactOptions<SourceComment>>(() => ({
    overflow: lineWrap ? 'wrap' : 'scroll',
    theme: ALTO_SHARED_CODE_THEMES,
    themeType: theme.mode,
    unsafeCSS: PIERRE_SOURCE_STYLES,
    stickyHeaders: true,
    pointerEventsOnScroll: true,
    lineHoverHighlight: 'both',
    enableLineSelection: true,
    enableGutterUtility: true,
    onGutterUtilityClick: (range) => setDraft({ start: Math.min(range.start, range.end), end: Math.max(range.start, range.end), body: '' }),
    onPostRender: schedulePaint,
  }), [lineWrap, theme.mode])

  const updateComments = (next: SourceComment[]): void => {
    if (!document) return
    setComments(next)
    setCommentVersion((version) => version + 1)
    saveComments(document.path, next)
  }

  const addComment = (): void => {
    if (!draft?.body.trim() || !document) return
    updateComments([...comments, {
      id: crypto.randomUUID(),
      path: document.path,
      revision: document.revision,
      start: draft.start,
      end: draft.end,
      body: draft.body.trim(),
      createdAt: new Date().toISOString(),
    }])
    setDraft(undefined)
    focusSource()
  }

  const removeComment = (id: string): void => updateComments(comments.filter((comment) => comment.id !== id))

  const send = async (): Promise<void> => {
    if (!document || currentComments.length === 0) return
    const target = targetChat(layout, pane.thread?.id, workspaceId)
    if (!target) {
      setSendProblem('Open a chat in this workspace to send the review.')
      return
    }
    const message: ClientDraft = {
      text: sourceReviewPrompt(currentComments),
      images: [], attachments: [], skills: [],
    }
    setSending(true)
    setSendProblem(undefined)
    try {
      await ui.submit(message, () => target.session.send(message), {
        mode: 'queue',
        target: submitTarget(target),
      })
      layout.focusPane(target.workspaceId, target.paneId)
    } catch (error) {
      setSendProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  const navigate = (filePath: string): void => {
    setLocation({ path: filePath })
    setActiveTreePath(filePath)
  }

  const Explorer = explorerState.explorer?.component
  return (
    <section
      ref={paneRoot}
      className={`${clientStyles.pane} source-viewer-pane`}
      tabIndex={0}
      aria-label={`Source ${editing ? 'editor' : 'review'} in Vim ${editing ? editBuffer?.mode : vimState.mode} mode`}
      data-vim-mode={editing ? editBuffer?.mode : vimState.mode}
      data-source-dirty={dirty}
      onKeyDown={keyDown}
      onCopy={(event) => {
        if (editing || !document || event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
          && target.matches('input, textarea, [contenteditable="true"]'))) return
        const range = vim.current.selection()
        if (!range) return
        const start = vimCursorOffset(document.source, range.start)
        const end = vimCursorOffset(document.source, range.end)
        const root = renderedRoot()
        const nativeText = root ? sourceTextSelection(root, document.source)?.text : undefined
        const text = nativeText ?? (range.linewise ? document.source.split('\n').slice(range.start.line - 1, range.end.line).join('\n') + '\n'
          : document.source.slice(start, end + ((document.source.codePointAt(end) ?? 0) > 0xffff ? 2 : 1)))
        event.preventDefault()
        event.clipboardData.setData('text/plain', text)
        setClipboardMessage('Copied to clipboard')
      }}
      onPointerDown={(event) => {
        if (editing || event.button !== 0 || event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
          && target.matches('input, textarea, button, a, [contenteditable="true"]'))) return
        const line = event.nativeEvent.composedPath().find((target) => target instanceof HTMLElement && target.hasAttribute('data-line'))
        const root = renderedRoot()
        if (!(line instanceof HTMLElement) || !root || line.getRootNode() !== root) return
        mouseSelection.current = { pointerId: event.pointerId, anchor: vim.current.state.anchor ?? vim.current.state.cursor, shift: event.shiftKey }
      }}
      onPointerUp={(event) => {
        const interactive = event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
          && target.matches('input, textarea, button, a, [contenteditable="true"]'))
        if (!interactive && !showHelp && !editing) focusSource()
      }}
    >
      <header className={`${clientStyles.paneHeader} ${paneToolbarStyles.pane} source-viewer-toolbar`}>
        <div className={`${paneToolbarStyles.title} source-viewer-file`} title={document?.path ?? location?.path}>
          <FileCode2 size={15} strokeWidth={1.6} />
          <span>{document?.name ?? location?.path?.split('/').at(-1) ?? 'Source'}</span>
          {document && <small>:{displayedCursor.line},{displayedCursor.column + 1}</small>}
          {dirty && <span className="source-editor-dirty" aria-label="Unsaved changes">●</span>}
        </div>
        <div className={`${paneToolbarStyles.actions} source-viewer-actions`}>
          <button className={clientStyles.iconButton} type="button" disabled={!editBuffer}
            title={editing ? 'Review saved file' : 'Edit file (i)'} aria-label={editing ? 'Review file' : 'Edit file'}
            aria-pressed={editing} onClick={() => { if (editBuffer) editing ? reviewBuffer(editBuffer) : enterEditor() }}>
            {editing ? <BookOpen size={14} strokeWidth={1.6} /> : <Pencil size={14} strokeWidth={1.6} />}
          </button>
          <button className={clientStyles.iconButton} type="button" title="Vim keyboard shortcuts (:help)"
            aria-label="Vim keyboard shortcuts" aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}>
            <KeyboardIcon size={14} strokeWidth={1.6} />
          </button>
          <button
            className={clientStyles.iconButton}
            type="button"
            title={lineWrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            aria-label={lineWrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            aria-pressed={lineWrap}
            onClick={() => { setLineWrap(!lineWrap); focusSource() }}
          ><TextWrap size={14} strokeWidth={1.6} /></button>
          {!editing && <button
            className={clientStyles.iconButton}
            type="button"
            title="Comment on selected lines (c)"
            aria-label="Comment on selected lines"
            disabled={editing || !selection}
            onClick={commentOnSelection}
          ><MessageSquarePlus size={14} strokeWidth={1.6} /></button>}
          {!editing && <button className={clientStyles.iconButton} type="button" title="Reload" aria-label="Reload source file" disabled={dirty || editBuffer?.saving} onClick={() => { mouseSelection.current = undefined; setReload((value) => value + 1); focusSource() }}>
            <RefreshCw size={14} strokeWidth={1.6} />
          </button>}
        </div>
      </header>
      <div className="source-viewer-body">
        {activated && Explorer && pane.workspace && (
          <Explorer
            workspace={pane.workspace}
            {...(activeTreePath ? { activePath: activeTreePath } : {})}
            label="Workspace files"
            select={navigate}
          />
        )}
        <div className="source-viewer-code-shell">
          {[...buffers.current.values()].filter((buffer) => buffer.mounted).map((buffer) => (
            <div className="source-editor-container" key={buffer.document.path} hidden={buffer !== editBuffer || !editing} inert={showHelp || discardPrompt}>
              <SourceEditor
                ref={(handle) => { buffer.editor = handle ?? undefined }}
                path={buffer.document.path} initialSource={buffer.source} initialCursor={buffer.initialCursor}
                {...(buffer.startKey ? { startKey: buffer.startKey } : {})}
                lineWrap={lineWrap} dark={theme.mode === 'dark'} active={buffer === editBuffer && editing && focused && visible && !showHelp && !discardPrompt}
                onChange={(source) => {
                  buffer.source = source
                  buffer.message = ''
                  scheduleDraft()
                  publishBuffers()
                }}
                onCursor={(position) => { buffer.cursor = position; publishBuffers() }}
                onMode={(mode) => { buffer.mode = mode; publishBuffers() }}
                onSave={() => saveBuffer(buffer)} onReview={() => reviewBuffer(buffer)}
              />
            </div>
          ))}
          {state.tag === 'loading' && <div className="source-viewer-state"><RefreshCw className="is-spinning" size={16} /> Loading source…</div>}
          {state.tag === 'failed' && <div className="source-viewer-state is-error" role="alert">{state.problem}</div>}
          {!location && <div className="source-viewer-state">Open a source file from chat or the file tree.</div>}
          {item && !editing && (
            <CodeView<SourceComment>
              ref={viewer}
              containerRef={codeContainer}
              className="source-viewer-code"
              items={[item]}
              options={options}
              selectedLines={vimState.mode === 'visual' ? null : selection}
              onScroll={schedulePaint}
              onSelectedLinesChange={(next) => {
                if (next) {
                  const anchor = { line: next.range.start, column: 0 }
                  const nextCursor = { line: next.range.end, column: 0 }
                  vim.current.select(anchor, nextCursor, true)
                } else vim.current.setCursor(vim.current.state.cursor)
                publishVimState()
              }}
              renderAnnotation={(annotation) => annotation.metadata
                ? <SourceAnnotation comment={annotation.metadata} remove={removeComment} />
                : null}
            />
          )}
        </div>
      </div>
      {document && (
        <div className="source-vim-status" aria-label="Vim status">
          <span className="source-vim-mode">{editing ? editBuffer?.mode.toUpperCase() : vimState.mode === 'visual-line' ? 'VISUAL LINE' : vimState.mode.toUpperCase()}</span>
          <span className="source-vim-message" role="status">{editBuffer?.saving ? 'Saving…' : dirty ? editing ? editBuffer?.message || 'Unsaved changes' : 'Reviewing saved file · unsaved draft retained' : editBuffer?.message || clipboardMessage || (!editing && vimState.message) || (editing ? '⌘S or :w to save' : 'i to edit · c to comment')}</span>
          {(editing || dirty) && <button className={clientStyles.iconButton} type="button"
            title="Save file (⌘S or :w)" aria-label="Save file" disabled={!dirty || editBuffer?.saving}
            onClick={() => { if (editBuffer) void saveBuffer(editBuffer); focusSource() }}><Save size={14} strokeWidth={1.6} /></button>}
          {dirty && <button className={clientStyles.iconButton} type="button" title="Discard changes" aria-label="Discard changes"
            disabled={editBuffer?.saving} onClick={() => setDiscardPrompt(true)}><X size={14} strokeWidth={1.6} /></button>}
          <kbd className="source-vim-pending">{editing ? '' : vimState.pending}</kbd>
          <span className="source-vim-position">{displayedCursor.line}:{displayedCursor.column + 1}</span>
        </div>
      )}
      {(editBuffer?.problem || recoveryProblem) && <div className="source-editor-problem" role="alert">{editBuffer?.problem || recoveryProblem}</div>}
      {discardPrompt && <section ref={discardPanel} className="source-editor-discard" role="alertdialog" aria-label="Discard unsaved changes"
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDiscardPrompt(false); focusSource() } }}>
        <p>Discard this file’s unsaved changes and reload from disk?</p>
        <div><button type="button" onClick={() => { setDiscardPrompt(false); focusSource() }}>Keep editing</button>
          <button type="button" onClick={discardChanges}>Discard</button></div>
      </section>}
      {showHelp && (
        <section ref={helpPanel} className="source-vim-help" role="dialog" aria-label="Vim keyboard shortcuts" tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setShowHelp(false); focusSource() }
          }}>
          <header><div><strong>Vim in Source</strong><p>Navigate, edit, and review source.</p></div>
            <button type="button" aria-label="Close Vim keyboard shortcuts" onClick={() => { setShowHelp(false); focusSource() }}><X size={15} /></button>
          </header>
          <dl>
            <dt>Move</dt><dd><kbd>h j k l</kbd> · arrows · counts, e.g. <kbd>12j</kbd></dd>
            <dt>Words</dt><dd><kbd>w b e</kbd> · <kbd>W B E</kbd> · <kbd>ge gE</kbd></dd>
            <dt>Lines</dt><dd><kbd>0 ^ $ g_</kbd> · <kbd>gg G</kbd> · <kbd>:42</kbd></dd>
            <dt>Structure</dt><dd><kbd>{`{ }`}</kbd> paragraphs · <kbd>%</kbd> matching bracket</dd>
            <dt>Find a character</dt><dd><kbd>f F t T</kbd> + character · <kbd>; ,</kbd> repeat</dd>
            <dt>Search</dt><dd><kbd>/ ?</kbd> · <kbd>n N</kbd> repeat · <kbd>* #</kbd> word under cursor</dd>
            <dt>Select</dt><dd><kbd>v V</kbd> character / line · <kbd>o</kbd> other end · <kbd>Esc</kbd> cancel</dd>
            <dt>Copy</dt><dd><kbd>y</kbd> selection or motion · <kbd>yy</kbd> line · <kbd>yiw</kbd> word · <kbd>yi(</kbd> inside parentheses</dd>
            <dt>Page</dt><dd><kbd>Ctrl+d/u</kbd> half page · <kbd>Ctrl+f/b</kbd> page · <kbd>H M L</kbd> screen</dd>
            <dt>Position view</dt><dd><kbd>zz zt zb</kbd> center / top / bottom</dd>
            <dt>Return</dt><dd><kbd>ma</kbd> set mark · <kbd>'a</kbd> line · <kbd>`a</kbd> exact · <kbd>Ctrl+o/i</kbd> jump history</dd>
            <dt>Edit</dt><dd><kbd>i a I A o O</kbd> enter editing · <kbd>Esc</kbd> normal mode</dd>
            <dt>Change text</dt><dd>In editing: <kbd>c d x p</kbd> · <kbd>u</kbd> undo · <kbd>Ctrl+r</kbd> redo · <kbd>.</kbd> repeat</dd>
            <dt>Save</dt><dd><kbd>⌘S</kbd> / <kbd>Ctrl+s</kbd> · <kbd>:w</kbd> · <kbd>:wq</kbd> save and return to review</dd>
            <dt>Review</dt><dd>In review: <kbd>c</kbd> comments on selected lines. The book button returns to review.</dd>
          </dl>
          <p className="source-vim-help-note">Edit drafts are retained when you switch files or tabs. Review shows the saved file; its search uses literal smart-case text. Editing uses Vim search and text commands. Saves check for changes on disk.</p>
        </section>
      )}
      {command && (
        <form className="source-viewer-command" onSubmit={(event) => { event.preventDefault(); finishCommand() }}>
          <span>{command === 'ex' ? ':' : command === 'backward' ? '?' : '/'}</span>
          <input
            ref={commandInput}
            value={commandValue}
            inputMode={command === 'ex' ? 'text' : 'search'}
            placeholder={command === 'ex' ? 'Line number, $, help…' : command === 'backward' ? 'Search backward' : 'Search forward'}
            aria-label={command === 'ex' ? 'Vim command' : command === 'backward' ? 'Search backward' : 'Search forward'}
            onChange={(event) => setCommandValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                vim.current.clearPending()
                publishVimState()
                setCommand(undefined)
                setCommandValue('')
                focusSource()
              }
            }}
          />
        </form>
      )}
      {draft && <SourceCommentComposer draft={draft} change={(body) => setDraft({ ...draft, body })} cancel={() => { setDraft(undefined); focusSource() }} add={addComment} />}
      {(currentComments.length > 0 || staleComments > 0) && (
        <footer className="source-viewer-footer">
          <div>
            <MessageSquarePlus size={14} strokeWidth={1.7} />
            <span>{currentComments.length} comment{currentComments.length === 1 ? '' : 's'}</span>
            {staleComments > 0 && <span>{staleComments} from an older revision</span>}
            {sendProblem && <span className="source-viewer-send-error">{sendProblem}</span>}
          </div>
          <button type="button" disabled={sending || currentComments.length === 0} onClick={() => void send()}>
            <Send size={13} strokeWidth={1.8} />
            <span>{sending ? 'Sending…' : 'Ask Alto'}</span>
          </button>
        </footer>
      )}
    </section>
  )
}

function openSourceBesideOrigin(
  layout: ClientWorkspaceLayoutService,
  details: MarkdownFileLinkDetails,
  origin: HTMLElement,
): void {
  const paneId = origin.closest<HTMLElement>('[data-workspace-pane-id]')?.dataset.workspacePaneId
  const target = paneId ? layout.paneTargets().find((candidate) => candidate.paneId === paneId) : undefined
  const session = target?.session.snapshot()
  layout.openPane({
    direction: 'horizontal',
    kind: SOURCE_VIEWER_PANE_KIND,
    resource: sourceViewerResource(details),
    ...(session?.threadId ? { anchorThreadId: session.threadId } : {}),
    ...(session?.session.workspace ? { workspace: session.session.workspace } : {}),
    ...(session?.activeProjectId ? { projectId: session.activeProjectId } : {}),
  })
}

const sourceViewerClient: BrowserPlugin = (ctx) => {
  ctx.clientMarkdown.registerFileLink(ctx, {
    id: SOURCE_VIEWER_PANE_KIND,
    matches: sourcePath,
    priority: 20,
    open: (details, origin) => openSourceBesideOrigin(ctx.clientWorkspaceLayout, details, origin),
  })
  ctx.clientWorkspaceLayout.registerPaneKind(ctx, {
    id: SOURCE_VIEWER_PANE_KIND,
    label: 'Source',
    description: 'Edit and review source files with Vim keys and line comments',
    shortcut: 's',
    icon: FileCode2,
    renderer: (props) => <SourceViewerPane
      {...props}
      host={ctx.clientHost}
      layout={ctx.clientWorkspaceLayout}
      ui={ctx.clientUi}
      explorers={ctx.clientCodeExplorer}
    />,
  })
  ctx.clientUi.registerStyle(ctx, SOURCE_VIEWER_PANE_KIND, String(styles))
}

sourceViewerClient.inject = [
  'clientCodeExplorer',
  'clientHost',
  'clientMarkdown',
  'clientUi',
  'clientWorkspaceLayout',
]

export default sourceViewerClient
