import { ArrowUp, ChevronDown, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { parseDiffFromFile, type FileDiffOptions } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { SourceEditProposal } from './source-edit-api.js'
import { ALTO_SHARED_CODE_THEMES, ensureAltoSharedCodeTheme } from './shared-code-theme.js'

ensureAltoSharedCodeTheme()

export type SourceReviewMode = 'comment' | 'edit'

export interface SourceReviewDraft {
  start: number
  end: number
  body: string
  mode: SourceReviewMode
}

export interface SourceReviewChat {
  id: string
  title: string
}

export interface SourceReviewComposerProps {
  draft: SourceReviewDraft
  chats: SourceReviewChat[]
  destinationId: string
  destinationMissing: boolean
  sending: boolean
  problem?: string
  change(body: string): void
  changeMode(mode: SourceReviewMode): void
  selectDestination(id: string): void
  cancel(): void
  submit(): void
}

export function SourceReviewComposer({
  draft,
  chats,
  destinationId,
  destinationMissing,
  sending,
  problem,
  change,
  changeMode,
  selectDestination,
  cancel,
  submit,
}: SourceReviewComposerProps): ReactNode {
  const input = useRef<HTMLTextAreaElement>(null)
  const canSubmit = !sending && !!draft.body.trim() && !!destinationId && !destinationMissing
  const action = draft.mode === 'comment' ? 'Send comment' : 'Request edit'
  const range = draft.start === draft.end ? `Line ${draft.start}` : `Lines ${draft.start}–${draft.end}`
  useEffect(() => input.current?.focus({ preventScroll: true }), [draft.start, draft.end])

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!sending) cancel()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (canSubmit) submit()
    }
  }

  return (
    <section className="composer source-review-draft source-review-composer is-editing" aria-label={`Source request, ${range}`} aria-busy={sending}>
      <div className="composer-body">
        <textarea
          ref={input}
          className="composer-editor"
          rows={1}
          value={draft.body}
          placeholder="Ask"
          aria-label={draft.mode === 'comment' ? 'Comment on selected source lines' : 'Edit selected source lines'}
          readOnly={sending}
          onChange={(event) => change(event.target.value)}
          onKeyDown={keyDown}
        />
        <div className="source-review-controls">
          <div className="source-review-modes" role="group" aria-label="Request type">
            <button type="button" aria-pressed={draft.mode === 'comment'} disabled={sending} onClick={() => changeMode('comment')}>Comment</button>
            <button type="button" aria-pressed={draft.mode === 'edit'} disabled={sending} onClick={() => changeMode('edit')}>Edit</button>
          </div>
          <div className="source-review-destination">
            <select
              aria-label="Destination chat"
              value={destinationMissing ? '' : destinationId}
              disabled={sending}
              onChange={(event) => selectDestination(event.target.value)}
            >
              <option value="" disabled>{destinationMissing ? 'Chat unavailable' : 'Choose chat'}</option>
              {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title || 'Untitled chat'}</option>)}
            </select>
            <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
          </div>
        </div>
        {problem && <p className="source-review-problem" role="alert">{problem}</p>}
      </div>
      <button className="send-button source-review-draft-submit" type="button" aria-label={action} title={action} disabled={!canSubmit} onClick={submit}>
        {sending ? <LoaderCircle className="source-review-spinner" size={16} strokeWidth={1.8} aria-hidden="true" /> : <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </section>
  )
}

export interface SourceReviewEdit {
  id: string
  body: string
  start: number
  end: number
  status: 'pending' | 'ready' | 'applying' | 'failed'
  proposal?: SourceEditProposal
  problem?: string
}

export interface SourceEditAnnotationProps {
  edit: SourceReviewEdit
  stale: boolean
  theme: 'light' | 'dark'
  accept(): void
  reject(): void
}

export function SourceEditAnnotation({ edit, stale, theme, accept, reject }: SourceEditAnnotationProps): ReactNode {
  const pending = edit.status === 'pending'
  const applying = edit.status === 'applying'
  const busy = pending || applying
  const proposal = edit.proposal
  const fileDiff = useMemo(() => proposal && proposal.original !== proposal.replacement
    ? parseDiffFromFile(
      { name: proposal.path, contents: proposal.original, cacheKey: `${proposal.id}:original` },
      { name: proposal.path, contents: proposal.replacement, cacheKey: `${proposal.id}:replacement` },
    )
    : undefined, [proposal])
  const options = useMemo<FileDiffOptions<undefined>>(() => ({
    diffStyle: 'unified',
    diffIndicators: 'bars',
    theme: ALTO_SHARED_CODE_THEMES,
    themeType: theme,
    disableFileHeader: true,
    disableLineNumbers: true,
    hunkSeparators: 'simple',
    overflow: 'wrap',
    stickyHeader: false,
  }), [theme])
  const problem = edit.problem || (stale ? 'The file has changed. Request a new edit.' : undefined)

  return (
    <article className="source-edit-annotation" aria-label="Source edit request" aria-busy={busy}>
      <div className="source-edit-request">
        <p>{edit.body}</p>
        <div className="source-edit-actions">
          {busy && <span className="source-edit-status" role="status"><LoaderCircle className="source-review-spinner" size={14} strokeWidth={1.8} aria-hidden="true" />{applying ? 'Applying…' : 'Preparing edit…'}</span>}
          <button type="button" className="source-edit-reject" disabled={applying} onClick={reject}>{pending ? 'Cancel' : edit.status === 'failed' ? 'Dismiss' : 'Reject'}</button>
          {!pending && edit.status !== 'failed' && <button type="button" className="source-edit-accept" disabled={stale || applying || !fileDiff} onClick={accept}>Accept</button>}
        </div>
      </div>
      {problem && <p className="source-review-problem" role="alert">{problem}</p>}
      {fileDiff && <div className="source-edit-diff" aria-label="Proposed changes"><FileDiff fileDiff={fileDiff} options={options} /></div>}
      {proposal && !fileDiff && <p className="source-edit-unchanged">No changes proposed.</p>}
    </article>
  )
}
