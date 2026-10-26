import { paneToolbarStyles } from './pane-toolbar.js'
import {
  ArrowUp,
  Check,
  FileCode2,
  Keyboard as KeyboardIcon,
  MessageSquarePlus,
  RefreshCw,
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
  type ClientHostService,
  type ClientUiService,
} from '../../src/client/plugin-api.js'
import type { JsonValue } from '../../src/shared/protocol.js'
import type { ClientCodeExplorerService } from './code-explorer-api.js'
import type { MarkdownFileLinkDetails } from './markdown-api.js'
import {
  parseSourceDocument,
  parseSourceViewerResource,
  parseSourceChatDestination,
  type SourceChatDestination,
  SOURCE_VIEWER_PANE_KIND,
  SOURCE_VIEWER_READ_METHOD,
  sourceViewerResource,
  type SourceDocument,
  type SourceLocation,
} from './source-viewer-api.js'
import {
  clampVimCursor,
  vimCursorOffset,
  type VimCursor,
} from './source-vim.js'
import { SourceVimController, type VimResult, type VimSelection } from './source-vim-controller.js'
import { clearSourceTextSelection, clearVimDecorations, paintVimDecorations, revealVimColumn, sourcePointerPosition, sourceTextSelection, sourceViewport } from './source-vim-dom.js'
import type {
  ClientWorkspaceLayoutService,
  WorkspacePaneKindProps,
} from './workspace-layout-api.js'
import { useThemeAppearance } from './theme-runtime.js'
import { useLineWrapPreference } from './viewer-preferences.js'
import {
  ALTO_SHARED_CODE_THEMES,
  ensureAltoSharedCodeTheme,
} from './shared-code-theme.js'
import { useViewerActivated } from './viewer-activation.js'
import { sourcePath } from './source-paths.js'
import { prepareSourceEditChat, resolveSourceChatTarget, sourceChatDestination, sourceChatTitle, sendSourceComment } from './source-review-chat.js'
import { SourceReviewComposer, SourceEditAnnotation } from './source-review-ui.js'
import { useSourceEdits, type SourceEditItem } from './source-edit.client.js'
import reviewStyles from './source-review.css'
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

`

interface SourceComment {
  id: string
  path: string
  revision: string
  start: number
  end: number
  body: string
  createdAt: string
  sent?: boolean
}

type SourceAnnotationItem = SourceComment | SourceEditItem

interface CommentDraft {
  selection: VimSelection
  commentId?: string
  document: SourceDocument
  mode: 'comment' | 'edit'
  start: number
  end: number
  body: string
}

function createCommentDraft(document: SourceDocument, start: number, end: number, selection?: VimSelection): CommentDraft {
  return {
    document, mode: 'comment', start, end, body: '',
    selection: selection ?? { start: { line: start, column: 0 }, end: { line: end, column: 0 }, linewise: true },
  }
}

type ViewerState =
  | { tag: 'idle' | 'loading' }
  | { tag: 'ready'; document: SourceDocument }
  | { tag: 'failed'; problem: string }

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
      ...('sent' in comment && comment.sent === true ? { sent: true } : {}),
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

function storedDestination(key: string): SourceChatDestination | undefined {
  try { return parseSourceChatDestination(JSON.parse(localStorage.getItem(key) ?? 'null')) }
  catch { return undefined }
}

function SourceAnnotation({
  comment,
  remove,
  send,
}: {
  comment: SourceComment
  send(comment: SourceComment): void
  remove(id: string): void
}): ReactNode {
  return (
    <article className="source-review-comment" aria-label={comment.sent ? 'Sent source comment' : 'Unsent source comment'}>
      <span className="source-review-comment-state" role="img" aria-label={comment.sent ? 'Sent to chat' : 'Unsent comment'}
        title={comment.sent ? 'Sent to chat' : 'Unsent comment'}>
        {comment.sent ? <Check size={13} strokeWidth={1.8} aria-hidden="true" /> : <MessageSquarePlus size={13} strokeWidth={1.6} aria-hidden="true" />}
      </span>
      <p>{comment.body}</p>
      <div className="source-review-comment-actions">
        {!comment.sent && <button className="source-review-comment-send" type="button" title="Send to chat" aria-label="Send saved comment" onClick={() => send(comment)}>
          <ArrowUp size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>}
        <button className="source-review-comment-remove" type="button" title="Dismiss comment" aria-label="Remove source comment" onClick={() => remove(comment.id)}>
          <Trash2 size={13} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </article>
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
  const activeRef = useRef(focused && visible)
  activeRef.current = focused && visible
  const [location, setLocation] = useState<SourceLocation | undefined>(initial)
  const activated = useViewerActivated(visible)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<ViewerState>({ tag: 'idle' })
  const [lineWrap, setLineWrap] = useLineWrapPreference('source')
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)
  const vim = useRef(new SourceVimController('', initialCursor(initial)))
  const [vimState, setVimState] = useState(vim.current.state)
  const cursor = vimState.cursor
  const destinationKey = `alto.source-chat.v1:${workspaceId}:${pane.id}`
  const [destination, setDestination] = useState<SourceChatDestination | undefined>(() => storedDestination(destinationKey) ?? initial?.destination)
  useSyncExternalStore(layout.subscribe, layout.snapshot)
  const chats = layout.paneTargets().filter((target) => target.workspaceId === workspaceId)
  const target = resolveSourceChatTarget(layout, workspaceId, destination)
  const [, refreshTarget] = useState(0)
  useEffect(() => target?.session.subscribe(() => refreshTarget((version) => version + 1)), [target?.session])
  const chooseDestination = (next: SourceChatDestination): void => {
    setDestination(next)
    try { localStorage.setItem(destinationKey, JSON.stringify(next)) } catch { /* Keep this pane usable without storage. */ }
  }
  useEffect(() => {
    if (!destination && target) chooseDestination(sourceChatDestination(target))
  }, [destination, target?.paneId, target?.session])
  const [comments, setComments] = useState<SourceComment[]>([])
  const [commentVersion, setCommentVersion] = useState(0)
  const [draft, setDraft] = useState<CommentDraft>()
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [command, setCommand] = useState<CommandMode>()
  const [commandValue, setCommandValue] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [clipboardMessage, setClipboardMessage] = useState('')
  const [sendProblem, setSendProblem] = useState<string>()
  const [sending, setSending] = useState(false)
  const submitting = useRef(false)
  const [activeTreePath, setActiveTreePath] = useState(initial?.path)
  const viewer = useRef<CodeViewHandle<SourceAnnotationItem>>(null)
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
  const loadedFile = useRef<{ requestedPath: string; document: SourceDocument } | undefined>(undefined)
  const locationRef = useRef(location)
  locationRef.current = location
  const showingPath = (path: string): boolean => loadedFile.current?.document.path === path
    && loadedFile.current?.requestedPath === locationRef.current?.path
  const sourceEdits = useSourceEdits(host, (path) => {
    if (!showingPath(path)) return
    setLocation((current) => current ? { ...current, line: vim.current.state.cursor.line, column: vim.current.state.cursor.column + 1, endLine: vim.current.state.cursor.line } : current)
    setReload((version) => version + 1)
  })

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
    const payload: JsonValue = { path: location.path }
    void host.call(SOURCE_VIEWER_READ_METHOD, payload).then((value) => {
      if (!current) return
      const document = parseSourceDocument(value)
      loadedFile.current = { requestedPath: location.path, document }
      setComments(loadComments(document.path))
      setCommentVersion((version) => version + 1)
      setSelection(null)
      setDraft((current) => current?.document.path === document.path ? current : undefined)
      vim.current = new SourceVimController(document.source, initialCursor(location))
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
  const currentComments = useMemo(() => comments.filter((comment) => (
    comment.revision === document?.revision
  )), [comments, document?.revision])
  const item = useMemo<CodeViewFileItem<SourceAnnotationItem> | undefined>(() => {
    if (!document) return undefined
    const annotations: LineAnnotation<SourceAnnotationItem>[] = [
      ...currentComments.map((comment) => ({ lineNumber: comment.end, metadata: comment })),
      ...sourceEdits.edits.filter((edit) => edit.path === document.path)
        .map((edit) => ({ lineNumber: Math.min(edit.end, document.lineCount), metadata: edit })),
    ]
    return {
      id: `${document.path}:${document.revision}`,
      type: 'file',
      file: {
        name: document.name,
        contents: document.source,
        cacheKey: document.revision,
      },
      annotations,
      version: commentVersion + sourceEdits.version,
    }
  }, [commentVersion, currentComments, document, sourceEdits.edits])

  const renderedRoot = (): ShadowRoot | undefined => viewer.current?.getInstance()
    ?.getRenderedItems().find((rendered) => rendered.id === item?.id)?.element.shadowRoot ?? undefined

  const focusSource = (): void => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined
      paneRoot.current?.focus({ preventScroll: true })
    })
  }

  const highlightedDraft = draft?.document.path === document?.path && draft?.document.revision === document?.revision ? draft : undefined

  const syncVimCursor = (): void => {
    const root = renderedRoot()
    if (!root) return
    if (visible && highlightedDraft) {
      // Browser selection stops painting when the textarea takes focus. Keep
      // the captured source range visible without showing an active Vim cursor.
      paintVimDecorations(root, undefined, highlightedDraft.selection)
      return
    }
    if (!focused || !visible || command || showHelp || draft) {
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

  const openReviewComposer = (mode: CommentDraft['mode']): void => {
    if (!selection || !document) return
    setSendProblem(undefined)
    setDraft({ ...createCommentDraft(document, Math.min(selection.range.start, selection.range.end),
      Math.max(selection.range.start, selection.range.end), vim.current.selection()), mode })
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
    if (result.comment) openReviewComposer('comment')
    if (result.edit) openReviewComposer('edit')
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
    revealCursor.current = true
    mouseSelection.current = undefined
    const next = clampVimCursor(document.source, initialCursor(location))
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
    if (showHelp) helpPanel.current?.focus({ preventScroll: true })
  }, [showHelp])
  useEffect(() => {
    schedulePaint()
  }, [vimState, focused, visible, command, showHelp, draft, item?.id, lineWrap])
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
    if (active instanceof HTMLElement && active.closest('input, textarea, button, select, .source-edit-annotation, [contenteditable="true"]')) return
    paneRoot.current?.focus({ preventScroll: true })
  }, [focused, visible])

  useEffect(() => () => {
    actionVersion.current += 1
    if (paintFrame.current !== undefined) cancelAnimationFrame(paintFrame.current)
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current)
  }, [])

  const finishCommand = (): void => {
    const result = command === 'ex' ? vim.current.ex(commandValue)
      : vim.current.search(commandValue, command === 'backward' ? -1 : 1)
    setCommand(undefined)
    setCommandValue('')
    applyVimResult(result)
    if (!result.help) focusSource()
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!focused || !visible || !document || command || showHelp || event.metaKey || event.altKey || event.nativeEvent.isComposing) return
    if (event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
      && target.matches('input, textarea, button, select, .source-edit-annotation, [contenteditable="true"], [role="textbox"]'))) return
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

  const options = useMemo<CodeViewReactOptions<SourceAnnotationItem>>(() => ({
    overflow: lineWrap ? 'wrap' : 'scroll',
    theme: ALTO_SHARED_CODE_THEMES,
    themeType: theme.mode,
    unsafeCSS: PIERRE_SOURCE_STYLES + String(reviewStyles),
    stickyHeaders: true,
    pointerEventsOnScroll: true,
    lineHoverHighlight: 'both',
    enableLineSelection: true,
    enableGutterUtility: true,
    onGutterUtilityClick: (range) => { if (!document) return; setSendProblem(undefined); setDraft(createCommentDraft(document, Math.min(range.start, range.end), Math.max(range.start, range.end))) },
    onPostRender: schedulePaint,
  }), [lineWrap, theme.mode, document])

  const updateComments = (next: SourceComment[]): void => {
    if (!document) return
    setComments(next)
    setCommentVersion((version) => version + 1)
    saveComments(document.path, next)
  }

  const removeComment = (id: string): void => updateComments(comments.filter((comment) => comment.id !== id))

  const submit = async (): Promise<void> => {
    if (submitting.current || !draft?.body.trim() || !document) return
    const selected = resolveSourceChatTarget(layout, workspaceId, destination)
    if (!selected) { setSendProblem('Choose the chat for this request.'); return }
    const binding = destination ?? sourceChatDestination(selected)
    const capturedDocument = draft.document
    const capturedDraft = draft
    submitting.current = true
    setSending(true)
    setSendProblem(undefined)
    try {
      if (capturedDraft.mode === 'comment') {
        const bound = await sendSourceComment(ui, layout, workspaceId, binding, {
          ...capturedDocument, start: capturedDraft.start, end: capturedDraft.end, body: capturedDraft.body,
        }, chooseDestination)
        chooseDestination(bound)
        const comment: SourceComment = { id: capturedDraft.commentId ?? crypto.randomUUID(), path: capturedDocument.path,
          revision: capturedDocument.revision, start: capturedDraft.start, end: capturedDraft.end,
          body: capturedDraft.body, createdAt: new Date().toISOString(), sent: true }
        const saved = [...loadComments(capturedDocument.path).filter((item) => item.id !== comment.id), comment]
        saveComments(capturedDocument.path, saved)
        if (showingPath(capturedDocument.path)) {
          setComments(saved)
          setCommentVersion((version) => version + 1)
        }
      } else {
        const session = selected.session.snapshot()
        if (session.remoteLocation || (session.providerId && session.providerId !== 'codex')) {
          throw new Error('Choose a local Codex chat for inline edits.')
        }
        const chat = await prepareSourceEditChat(ui, layout, workspaceId, binding, chooseDestination)
        await sourceEdits.start({ path: capturedDocument.path, revision: capturedDocument.revision,
          start: capturedDraft.start, end: capturedDraft.end, instruction: capturedDraft.body,
          workspace: chat.workspace, threadId: chat.threadId }, chat.deliver)
      }
      setDraft((current) => current === capturedDraft ? undefined : current)
      if (activeRef.current && draftRef.current === capturedDraft) focusSource()
    } catch (error) {
      if (draftRef.current === capturedDraft) setSendProblem(error instanceof Error ? error.message : String(error))
    } finally {
      submitting.current = false
      setSending(false)
    }
  }

  const sendSavedComment = (comment: SourceComment): void => {
    if (!document) return
    setSendProblem(undefined)
    setDraft({ ...createCommentDraft(document, comment.start, comment.end), commentId: comment.id, body: comment.body })
  }

  const navigate = (filePath: string): void => {
    setLocation({ path: filePath, ...(destination ? { destination } : {}) })
    setActiveTreePath(filePath)
  }

  const Explorer = explorerState.explorer?.component
  return (
    <section
      ref={paneRoot}
      className={`${clientStyles.pane} source-viewer-pane`}
      tabIndex={0}
      aria-label={`Read-only source viewer in Vim ${vimState.mode} mode`}
      data-vim-mode={vimState.mode}
      onKeyDown={keyDown}
      onCopy={(event) => {
        if (!document || event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
          && target.matches('input, textarea, select, .source-edit-annotation, [contenteditable="true"]'))) return
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
        if (event.button !== 0 || event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
          && target.matches('input, textarea, button, select, a, .source-edit-annotation, [contenteditable="true"]'))) return
        const line = event.nativeEvent.composedPath().find((target) => target instanceof HTMLElement && target.hasAttribute('data-line'))
        const root = renderedRoot()
        if (!(line instanceof HTMLElement) || !root || line.getRootNode() !== root) return
        mouseSelection.current = { pointerId: event.pointerId, anchor: vim.current.state.anchor ?? vim.current.state.cursor, shift: event.shiftKey }
      }}
      onPointerUp={(event) => {
        const interactive = event.nativeEvent.composedPath().some((target) => target instanceof HTMLElement
          && target.matches('input, textarea, button, select, a, .source-edit-annotation, [contenteditable="true"]'))
        if (!interactive && !showHelp) focusSource()
      }}
    >
      <header className={`${clientStyles.paneHeader} ${paneToolbarStyles.pane} source-viewer-toolbar`}>
        <div className={`${paneToolbarStyles.title} source-viewer-file`} title={document?.path ?? location?.path}>
          <FileCode2 size={15} strokeWidth={1.6} />
          <span>{document?.name ?? location?.path?.split('/').at(-1) ?? 'Source'}</span>
          {document && <small>:{cursor.line},{cursor.column + 1}</small>}
        </div>
        <div className={`${paneToolbarStyles.actions} source-viewer-actions`}>
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
          <button
            className={clientStyles.iconButton}
            type="button"
            title="Comment on selected lines (c)"
            aria-label="Comment on selected lines"
            disabled={!selection}
            onClick={() => openReviewComposer('comment')}
          ><MessageSquarePlus size={14} strokeWidth={1.6} /></button>
          <button className={clientStyles.iconButton} type="button" title="Reload" aria-label="Reload source file" onClick={() => { mouseSelection.current = undefined; setReload((value) => value + 1); focusSource() }}>
            <RefreshCw size={14} strokeWidth={1.6} />
          </button>
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
          {state.tag === 'loading' && <div className="source-viewer-state"><RefreshCw className="is-spinning" size={16} /> Loading source…</div>}
          {state.tag === 'failed' && <div className="source-viewer-state is-error" role="alert">{state.problem}</div>}
          {!location && <div className="source-viewer-state">Open a source file from chat or the file tree.</div>}
          {item && (
            <CodeView<SourceAnnotationItem>
              ref={viewer}
              containerRef={codeContainer}
              className="source-viewer-code"
              items={[item]}
              options={options}
              selectedLines={highlightedDraft
                ? highlightedDraft.selection.linewise ? { id: item.id, range: { start: highlightedDraft.start, end: highlightedDraft.end } } : null
                : vimState.mode === 'visual' ? null : selection}
              onScroll={schedulePaint}
              onSelectedLinesChange={(next) => {
                if (next) {
                  const anchor = { line: next.range.start, column: 0 }
                  const nextCursor = { line: next.range.end, column: 0 }
                  vim.current.select(anchor, nextCursor, true)
                } else vim.current.setCursor(vim.current.state.cursor)
                publishVimState()
              }}
              renderAnnotation={(annotation) => {
                const metadata = annotation.metadata
                if (!metadata) return null
                return 'status' in metadata
                  ? <SourceEditAnnotation edit={metadata} stale={metadata.revision !== document?.revision} theme={theme.mode}
                      accept={() => void sourceEdits.accept(metadata.id)} reject={() => void sourceEdits.reject(metadata.id)} />
                  : <SourceAnnotation comment={metadata} remove={removeComment} send={sendSavedComment} />
              }}
            />
          )}
        </div>
      </div>
      {document && (
        <div className="source-vim-status" aria-label="Vim status">
          <span className="source-vim-mode">{vimState.mode === 'visual-line' ? 'VISUAL LINE' : vimState.mode.toUpperCase()}</span>
          <span className="source-vim-message" role="status">{clipboardMessage || vimState.message || 'Read only · c to comment · e to edit'}</span>
          <kbd className="source-vim-pending">{vimState.pending}</kbd>
          <span className="source-vim-position">{cursor.line}:{cursor.column + 1}</span>
        </div>
      )}
      {showHelp && (
        <section ref={helpPanel} className="source-vim-help" role="dialog" aria-label="Vim keyboard shortcuts" tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setShowHelp(false); focusSource() }
          }}>
          <header><div><strong>Vim navigation</strong><p>Select, copy, and comment on source.</p></div>
            <button type="button" aria-label="Close Vim keyboard shortcuts" onClick={() => { setShowHelp(false); focusSource() }}><X size={15} /></button>
          </header>
          <dl>
            <dt>Move</dt><dd><kbd>h j k l</kbd> · arrows · counts, e.g. <kbd>12j</kbd></dd>
            <dt>Words</dt><dd><kbd>w b 1e</kbd> · <kbd>W B E</kbd> · <kbd>ge gE</kbd></dd>
            <dt>Lines</dt><dd><kbd>0 ^ $ g_</kbd> · <kbd>gg G</kbd> · <kbd>:42</kbd></dd>
            <dt>Structure</dt><dd><kbd>{`{ }`}</kbd> paragraphs · <kbd>%</kbd> matching bracket</dd>
            <dt>Find a character</dt><dd><kbd>f F t T</kbd> + character · <kbd>; ,</kbd> repeat</dd>
            <dt>Search</dt><dd><kbd>/ ?</kbd> · <kbd>n N</kbd> repeat · <kbd>* #</kbd> word under cursor</dd>
            <dt>Select</dt><dd><kbd>v V</kbd> character / line · <kbd>o</kbd> other end · <kbd>Esc</kbd> cancel</dd>
            <dt>Copy</dt><dd><kbd>y</kbd> selection or motion · <kbd>yy</kbd> line · <kbd>yiw</kbd> word · <kbd>yi(</kbd> inside parentheses</dd>
            <dt>Page</dt><dd><kbd>Ctrl+d/u</kbd> half page · <kbd>Ctrl+f/b</kbd> page · <kbd>H M L</kbd> screen</dd>
            <dt>Position view</dt><dd><kbd>zz zt zb</kbd> center / top / bottom</dd>
            <dt>Return</dt><dd><kbd>ma</kbd> set mark · <kbd>'a</kbd> line · <kbd>`a</kbd> exact · <kbd>Ctrl+o/i</kbd> jump history</dd>
            <dt>Review</dt><dd><kbd>c</kbd> comment · <kbd>e</kbd> request an edit to current or selected lines</dd>
          </dl>
          <p className="source-vim-help-note">Source stays read only. Use the Editor pane to change files. Search uses literal text, ignoring case unless you type a capital letter.</p>
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
      {draft && <SourceReviewComposer
        draft={draft}
        chats={chats.map((chat) => ({ id: chat.paneId, title: sourceChatTitle(chat) }))}
        destinationId={target?.paneId ?? ''}
        destinationMissing={!!destination && !target}
        sending={sending}
        {...(sendProblem ? { problem: sendProblem } : {})}
        change={(body) => setDraft({ ...draft, body })}
        changeMode={(mode) => { setSendProblem(undefined); setDraft({ ...draft, mode }) }}
        selectDestination={(id) => {
          const selected = chats.find((chat) => chat.paneId === id)
          if (selected) { chooseDestination(sourceChatDestination(selected)); setSendProblem(undefined) }
        }}
        cancel={() => { if (!submitting.current) { setDraft(undefined); focusSource() } }}
        submit={() => void submit()}
      />}
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
    resource: sourceViewerResource({ ...details, ...(target ? { destination: sourceChatDestination(target) } : {}) }),
    ...(target ? { anchor: { workspaceId: target.workspaceId, paneId: target.paneId } } : {}),
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
    description: 'Review source with Vim navigation, linked chat comments, and inline edit proposals',
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
  ctx.clientUi.registerStyle(ctx, SOURCE_VIEWER_PANE_KIND, String(styles) + String(reviewStyles))
}

sourceViewerClient.inject = [
  'clientCodeExplorer',
  'clientHost',
  'clientMarkdown',
  'clientUi',
  'clientWorkspaceLayout',
]

export default sourceViewerClient
