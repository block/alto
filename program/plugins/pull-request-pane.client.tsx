import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, CircleDot, Clock3, GitMerge, GitPullRequest, Layers, Link2, MessageSquare, RefreshCw } from 'lucide-react'
import { clientStyles, type BrowserPlugin, type ClientHostService, type ClientUiService } from '../../src/client/plugin-api.js'
import type { JsonValue } from '../../src/shared/protocol.js'
import { DIFF_CONTENT_COMPONENT, parseDiffReviewDocument, type DiffContentProps, type DiffReviewDocument } from './diff-viewer-api.js'
import type { MarkdownContentProps } from './markdown-content.js'
import { paneToolbarStyles } from './pane-toolbar.js'
import { PR_PANE, pullRequestAge, pullRequestChecks, pullRequestReview } from './pull-requests-api.js'
import { pullRequestViewStore } from './pull-requests-store.js'
import { PULL_REQUEST_DIFF_METHOD, PULL_REQUEST_PANE_KIND, PULL_REQUEST_READ_METHOD, parsePullRequestDetails, parsePullRequestReference, type PullRequestCheck, type PullRequestDetails, type PullRequestComment } from './pull-request-pane-api.js'
import type { ClientWorkspaceLayoutService, WorkspacePaneKindProps } from './workspace-layout-api.js'
import { uiStyles } from './ui/appearance.js'
import styles from './pull-request-pane.css'

const REFRESH_INTERVAL = 60_000
const rememberedKey = (paneId: string) => `alto.pull-request-pane.${paneId}`

/** Restored panes can mount before the browser acknowledges a new program. */
export async function callPullRequestRead(host: Pick<ClientHostService, 'call'>, method: string, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
  const delays = [100, 200, 400, 800, 1600, 3200]
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { return await host.call(method, payload) }
    catch (error) {
      signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      const delay = delays[attempt]
      if (delay === undefined || !/^browser program revision (?:unknown|\d+) is incompatible with server revision \d+$/u.test(message)) throw error
      await new Promise<void>((resolve, reject) => {
        const cancel = (): void => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, delay)
        signal.addEventListener('abort', cancel, { once: true })
      })
    }
  }
}

function rememberedResource(paneId: string): string {
  try { return parsePullRequestReference(localStorage.getItem(rememberedKey(paneId)) ?? '')?.url ?? '' } catch { return '' }
}

/** PR links share one in-app destination, independent of their GitHub view. */
export function pullRequestLinkResource(href: string): string | undefined {
  try {
    return new URL(href).protocol === 'https:' ? parsePullRequestReference(href).url : undefined
  } catch { return undefined }
}

/** Remote Markdown must not interpret GitHub paths as files on this computer. */
export function pullRequestMarkdownUrl(value: string, pr: Pick<PullRequestDetails, 'url' | 'repository' | 'headRepository' | 'branch'>, key = 'href'): string {
  try {
    if (value.startsWith('#')) return new URL(value, pr.url).href
    if (value.startsWith('/')) return new URL(value, 'https://github.com').href
    if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
      return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value).protocol) ? value : ''
    }
    const repository = pr.headRepository ?? pr.repository
    const ref = encodeURIComponent(pr.branch || 'HEAD')
    const base = key === 'src' ? `https://raw.githubusercontent.com/${repository}/${ref}/` : `https://github.com/${repository}/blob/${ref}/`
    return new URL(value, base).href
  } catch { return '' }
}

export function openPullRequestPane(layout: ClientWorkspaceLayoutService, resource: string, origin?: HTMLElement): void {
  const paneId = origin?.closest<HTMLElement>('[data-workspace-pane-id]')?.dataset.workspacePaneId
  const target = paneId ? layout.paneTargets().find(candidate => candidate.paneId === paneId) : undefined
  const session = target?.session.snapshot()
  layout.openPane({
    direction: 'horizontal', kind: PULL_REQUEST_PANE_KIND, resource,
    ...(target ? { anchor: { workspaceId: target.workspaceId, paneId: target.paneId } } : {}),
    ...(session?.session.workspace ? { workspace: session.session.workspace } : {}),
    ...(session?.activeProjectId ? { projectId: session.activeProjectId } : {}),
  })
}

function ExternalLink({ href, children, className, label }: { href: string; children: ReactNode; className?: string; label?: string }): ReactNode {
  return <a href={href} className={className} aria-label={label} title={label} target="_blank" rel="noopener noreferrer" data-pull-request-external>{children}</a>
}

export function pullRequestCheckTone(check: PullRequestCheck): 'success' | 'failure' | 'pending' | 'neutral' {
  if (check.conclusion === 'SUCCESS' || check.status === 'SUCCESS') return 'success'
  if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(check.conclusion ?? check.status)) return 'failure'
  if (['SKIPPED', 'NEUTRAL'].includes(check.conclusion ?? '')) return 'neutral'
  return 'pending'
}

function StatusIcon({ tone }: { tone: string }): ReactNode {
  return tone === 'success' ? <Check size={14} /> : tone === 'failure' ? <CircleAlert size={14} /> : tone === 'pending' ? <Clock3 size={14} /> : <CircleDot size={14} />
}

function mergeDescription(pr: PullRequestDetails): string {
  if (pr.state === 'MERGED') return 'Merged'
  if (pr.state === 'CLOSED') return 'Closed without merging'
  if (pr.draft) return 'Draft pull request'
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return 'Has merge conflicts'
  if (pr.mergeState === 'CLEAN' && pr.mergeable === 'MERGEABLE') return 'No merge conflicts'
  if (pr.mergeState === 'BEHIND') return `Behind ${pr.baseBranch}`
  if (pr.mergeState === 'BLOCKED') return `Blocked by ${pr.baseBranch} requirements`
  if (pr.mergeState === 'UNSTABLE') return 'Checks or reviews need attention'
  return 'Merge status pending'
}

function PullRequestCommentView({ comment, ui, pr }: { comment: PullRequestComment; ui: ClientUiService; pr: PullRequestDetails }): ReactNode {
  const Markdown = ui.component<MarkdownContentProps>('markdown.content')
  return <article className="pull-request-comment">
    <div className="pull-request-comment-meta"><strong>{comment.author?.login ?? 'Deleted user'}</strong><ExternalLink href={comment.url}><time dateTime={comment.createdAt}>{pullRequestAge(comment.createdAt)}</time><ArrowUpRight size={11} /></ExternalLink></div>
    {Markdown ? <Markdown source={comment.body} className="activity-markdown pull-request-markdown" urlTransform={(url, key) => pullRequestMarkdownUrl(url, pr, key)} /> : <p>{comment.body}</p>}
  </article>
}

function PullRequestStackView({ pr, onSelect }: { pr: PullRequestDetails; onSelect: (url: string) => void }): ReactNode {
  const stack = pr.stack
  if (!stack) return pr.stackUnavailable ? <p className="pull-request-muted">Stack information is unavailable. <ExternalLink href={pr.url}>View on GitHub</ExternalLink></p> : null
  return <details className="pull-request-stack" open>
    <summary><span><Layers size={14} /><strong>Stack #{stack.number}</strong><small>{stack.size} {stack.size === 1 ? 'pull request' : 'pull requests'} · into <code>{stack.baseBranch}</code></small></span><ChevronDown size={12} /></summary>
    <ol aria-label="Stack pull requests, starting at the base branch">
      {stack.entries.toSorted((left, right) => left.position - right.position).map(({ position, pullRequest: member }) => {
        const current = member.url === pr.url
        const state = member.state === 'MERGED' ? 'Merged' : member.state === 'CLOSED' ? 'Closed' : member.draft ? 'Draft' : 'Open'
        const checkTone = member.checks === 'passing' ? 'success' : member.checks === 'failing' ? 'failure' : 'pending'
        const checkLabel = member.checks === 'passing' ? 'Checks passed' : member.checks === 'failing' ? 'Checks failing' : 'Checks running'
        return <li value={position} key={member.url}>
          <a href={member.url} className={`${uiStyles.row} pull-request-stack-entry`} aria-current={current ? 'page' : undefined} data-pull-request-select
            onClick={event => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              if (!current) onSelect(member.url)
            }}>
            <span className="pull-request-stack-position" aria-label={`Position ${position}`}>{position}</span>
            <span className={`pull-request-stack-icon is-${member.state.toLowerCase()}${member.draft ? ' is-draft' : ''}`} aria-hidden="true">{member.state === 'MERGED' ? <GitMerge size={14} /> : <GitPullRequest size={14} />}</span>
            <span className="pull-request-stack-copy"><span>{member.title}</span><small>#{member.number} · {state}{current ? ' · Current' : ''}</small></span>
            {member.checks && <span className={`pull-request-status-icon is-${checkTone}`} role="img" aria-label={checkLabel} title={checkLabel}><StatusIcon tone={checkTone} /></span>}
          </a>
        </li>
      })}
    </ol>
    {(pr.moreStackEntries || stack.entries.length < stack.size) && <p className="pull-request-muted">{stack.entries.length < stack.size ? `Showing ${stack.entries.length} of ${stack.size} pull requests.` : 'Some stack information is unavailable.'} <ExternalLink href={pr.url}>View on GitHub</ExternalLink></p>}
  </details>
}

function PullRequestSummary({ pr, ui, onSelect, children }: { pr: PullRequestDetails; ui: ClientUiService; onSelect: (url: string) => void; children: ReactNode }): ReactNode {
  const Markdown = ui.component<MarkdownContentProps>('markdown.content')
  const failed = pr.checksList.filter(check => pullRequestCheckTone(check) === 'failure')
  const pending = pr.checksList.filter(check => pullRequestCheckTone(check) === 'pending')
  const passed = pr.checksList.filter(check => pullRequestCheckTone(check) === 'success')
  const checksText = pr.moreChecks ? `${pullRequestChecks(pr)} · more on GitHub` : !pr.checksList.length ? pullRequestChecks(pr) : [passed.length ? `${passed.length} passed` : '', failed.length ? `${failed.length} failed` : '', pending.length ? `${pending.length} running` : '', pr.checksList.length - passed.length - failed.length - pending.length ? `${pr.checksList.length - passed.length - failed.length - pending.length} skipped` : ''].filter(Boolean).join(' · ')
  const checkTone = failed.length || ['FAILURE', 'ERROR'].includes(pr.checks ?? '') ? 'failure' : pending.length || ['PENDING', 'EXPECTED'].includes(pr.checks ?? '') ? 'pending' : pr.checks === 'SUCCESS' ? 'success' : 'neutral'
  const threads = pr.threads.filter(thread => !thread.isResolved)
  return <div className="pull-request-summary">
    <div className="pull-request-heading"><h1><a href={pr.url}>{pr.title} <span>#{pr.number}</span></a></h1>
      <div className="pull-request-byline"><span className={`pull-request-state is-${pr.state.toLowerCase()}${pr.draft ? ' is-draft' : ''}`}><GitPullRequest size={13} />{pr.state === 'MERGED' ? 'Merged' : pr.state === 'CLOSED' ? 'Closed' : pr.draft ? 'Draft' : 'Open'}</span><span>by {pr.author ? <ExternalLink href={pr.author.url}>{pr.author.login}</ExternalLink> : 'deleted user'}</span></div>
    </div>
    <dl className="pull-request-facts">
      <div><dt>Branch</dt><dd className="pull-request-branches"><code title={pr.branch}>{pr.branch}</code><ArrowRight size={12} /><code title={pr.baseBranch}>{pr.baseBranch}</code></dd></div>
      <div><dt>Files changed</dt><dd>{pr.changedFiles ?? '—'}</dd></div>
      <div><dt>Changes</dt><dd className="pull-request-delta"><span>+{pr.additions ?? 0}</span><span>−{pr.deletions ?? 0}</span></dd></div>
      <div><dt>Last updated</dt><dd><time dateTime={pr.updatedAt} title={new Date(pr.updatedAt).toLocaleString()}>{pullRequestAge(pr.updatedAt)}</time></dd></div>
    </dl>
    <PullRequestStackView pr={pr} onSelect={onSelect} />
    <div className="pull-request-status-list">
      <details className="pull-request-status-detail"><summary><span className={`pull-request-status-icon is-${checkTone}`}><StatusIcon tone={checkTone} /></span><span>Checks</span><strong>{checksText}</strong><ChevronDown size={12} /></summary>
        <div className="pull-request-checks">{pr.checksList.map(check => <div className="pull-request-check" key={check.id}><span className={`pull-request-status-icon is-${pullRequestCheckTone(check)}`}><StatusIcon tone={pullRequestCheckTone(check)} /></span>{check.url ? <ExternalLink href={check.url}>{check.name}<ArrowUpRight size={11} /></ExternalLink> : <span>{check.name}</span>}<small>{(check.conclusion ?? check.status).toLowerCase().replaceAll('_', ' ')}</small></div>)}{(!pr.checksList.length || pr.moreChecks) && <ExternalLink href={`${pr.url}/checks`}>View checks on GitHub <ArrowUpRight size={11} /></ExternalLink>}</div>
      </details>
      <div className="pull-request-status-row"><span className={`pull-request-status-icon is-${pr.review === 'APPROVED' ? 'success' : pr.review === 'CHANGES_REQUESTED' ? 'failure' : 'neutral'}`}><StatusIcon tone={pr.review === 'APPROVED' ? 'success' : pr.review === 'CHANGES_REQUESTED' ? 'failure' : 'neutral'} /></span><span>Review</span><strong>{pullRequestReview(pr)}</strong></div>
      <div className="pull-request-status-row"><MessageSquare size={14} /><span>Threads</span><strong><ExternalLink href={`${pr.url}/files`}>{pr.moreThreads && pr.unresolvedThreads === 0 ? 'More threads on GitHub' : `${pr.unresolvedThreads}${pr.moreThreads ? '+' : ''} unresolved`}</ExternalLink></strong></div>
      <div className="pull-request-status-row"><GitMerge size={14} /><span>Merge</span><strong>{mergeDescription(pr)}</strong></div>
    </div>
    <section className="pull-request-description" aria-label="Pull request description">{pr.body.trim() ? Markdown ? <Markdown source={pr.body} className="activity-markdown pull-request-markdown" urlTransform={(url, key) => pullRequestMarkdownUrl(url, pr, key)} /> : <p>{pr.body}</p> : <p className="pull-request-muted">No description provided.</p>}</section>
    {children}
    {threads.length > 0 && <section className="pull-request-discussion" aria-label="Unresolved review threads"><h2>Review threads <span>{pr.unresolvedThreads}{pr.moreThreads ? '+' : ''}</span></h2>{threads.map(thread => <details className="pull-request-thread" key={thread.id}><summary><span><code>{thread.path}{thread.line ? `:${thread.line}` : ''}</code>{thread.isOutdated && <small>Outdated</small>}</span><ChevronDown size={12} /></summary>{thread.comments.map(comment => <PullRequestCommentView comment={comment} ui={ui} pr={pr} key={comment.id} />)}{thread.moreComments && <ExternalLink href={thread.url}>Continue thread on GitHub <ArrowUpRight size={11} /></ExternalLink>}</details>)}{pr.moreThreads && <ExternalLink href={`${pr.url}/files`}>More review threads on GitHub <ArrowUpRight size={11} /></ExternalLink>}</section>}
    {(pr.comments.length > 0 || pr.moreComments) && <section className="pull-request-discussion" aria-label="Pull request discussion"><h2>Discussion</h2>{pr.comments.map(comment => <PullRequestCommentView comment={comment} ui={ui} pr={pr} key={comment.id} />)}{pr.moreComments && <ExternalLink href={pr.url}>Earlier discussion on GitHub <ArrowUpRight size={11} /></ExternalLink>}</section>}
  </div>
}

export function PullRequestPane({ pane, workspaceId, visible, host, ui }: WorkspacePaneKindProps & { host: ClientHostService; ui: ClientUiService }): ReactNode {
  const initial = rememberedResource(pane.id) || pane.resource || ''
  const [resource, setResource] = useState(initial)
  const [input, setInput] = useState(initial)
  const [editing, setEditing] = useState(!initial)
  const [inputProblem, setInputProblem] = useState('')
  const [details, setDetails] = useState<PullRequestDetails>()
  const [problem, setProblem] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [diff, setDiff] = useState<DiffReviewDocument>()
  const [diffProblem, setDiffProblem] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffRefresh, setDiffRefresh] = useState(0)
  const loadedDiff = useRef('')
  const fieldId = useId()
  const prStore = useMemo(() => pullRequestViewStore(host), [host])
  const authored = useSyncExternalStore(prStore.subscribe, prStore.snapshot).snapshot.items
  useSyncExternalStore(ui.subscribe, ui.snapshot, ui.snapshot)
  const inputRef = useRef<HTMLInputElement>(null)
  const Diff = ui.component<DiffContentProps>(DIFF_CONTENT_COMPONENT)
  let githubUrl = details?.url
  try { githubUrl ??= parsePullRequestReference(resource).url } catch { /* Invalid resources remain editable. */ }

  useEffect(() => {
    const next = rememberedResource(pane.id) || pane.resource || ''
    setResource(next); setInput(next); setEditing(!next)
  }, [pane.id, pane.resource])

  useEffect(() => { if (editing && visible) inputRef.current?.focus({ preventScroll: true }) }, [editing, visible])

  useEffect(() => { setDetails(undefined); setDiff(undefined); loadedDiff.current = ''; setProblem(''); setDiffProblem('') }, [resource])

  useEffect(() => {
    if (!visible || !resource) return
    let current = true
    const controller = new AbortController()
    setLoading(true)
    void callPullRequestRead(host, PULL_REQUEST_READ_METHOD, { resource }, controller.signal).then(value => {
      if (!current) return
      setDetails(parsePullRequestDetails(value)); setProblem('')
    }).catch((error: unknown) => { if (current) setProblem(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false; controller.abort() }
  }, [host, resource, visible, refresh])

  useEffect(() => {
    if (!visible || !resource || !details || details.state !== 'OPEN') return
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setRefresh(value => value + 1) }, REFRESH_INTERVAL)
    return () => clearInterval(timer)
  }, [visible, resource, details?.state])

  useEffect(() => {
    if (!visible || !details) return
    try { if (parsePullRequestReference(resource).url !== details.url) return }
    catch { return }
    const key = `${resource}:${details.headSha}:${details.baseBranch}:${details.baseSha}:${diffRefresh}`
    if (loadedDiff.current === key) return
    let current = true
    const controller = new AbortController()
    setDiffLoading(true)
    void callPullRequestRead(host, PULL_REQUEST_DIFF_METHOD, { resource: details.url, workspace: pane.workspace }, controller.signal).then(value => {
      if (!current) return
      loadedDiff.current = key
      setDiff(parseDiffReviewDocument(value)); setDiffProblem('')
    }).catch((error: unknown) => { if (current) setDiffProblem(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setDiffLoading(false) })
    return () => { current = false; controller.abort() }
  }, [host, resource, details?.url, details?.headSha, details?.baseBranch, details?.baseSha, visible, pane.workspace, diffRefresh])

  const choose = (value: string): void => {
    let reference
    try { reference = parsePullRequestReference(value.trim()) }
    catch { setInputProblem('Enter a GitHub PR URL or owner/repo#123.'); return }
    setInputProblem(''); setInput(reference.url); setResource(reference.url); setEditing(false)
    if (reference.url === resource) setRefresh(current => current + 1)
    try { localStorage.setItem(rememberedKey(pane.id), reference.url) } catch { /* Pane remains usable without local persistence. */ }
  }

  return <section className={`${clientStyles.pane} pull-request-pane`} aria-label="GitHub pull request" data-pull-request-resource={details?.url}>
    <header className={`${clientStyles.paneHeader} ${paneToolbarStyles.pane} pull-request-toolbar`}>
      <div className={paneToolbarStyles.title}><GitPullRequest size={16} /><span>{details ? `${details.repository} #${details.number}` : 'GitHub pull request'}</span></div>
      <div className={paneToolbarStyles.actions}>
        <button type="button" className={uiStyles.iconButton} aria-label="Open another pull request" title="Open another pull request" aria-expanded={editing} onClick={() => { setEditing(value => !value); setInputProblem('') }}><Link2 size={14} /></button>
        <button type="button" className={uiStyles.iconButton} aria-label="Refresh pull request" title="Refresh pull request" disabled={!resource || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} className={loading ? 'pull-request-spinning' : ''} /></button>
        {githubUrl && <ExternalLink className={uiStyles.iconButton} href={githubUrl} label="Open on GitHub"><ArrowUpRight size={15} /></ExternalLink>}
      </div>
    </header>
    {editing && <form className="pull-request-address" onSubmit={event => { event.preventDefault(); choose(input) }}>
      <label htmlFor={`${fieldId}-url`}>{resource ? 'Pull request' : 'Open a pull request'}</label>
      <div><input ref={inputRef} id={`${fieldId}-url`} className={uiStyles.field} value={input} onChange={event => setInput(event.target.value)} placeholder="GitHub URL or owner/repo#123" autoComplete="off" spellCheck={false} aria-invalid={!!inputProblem} aria-describedby={inputProblem ? `${fieldId}-input-error` : undefined} /><button type="submit" className={uiStyles.button}>Open</button></div>
      {inputProblem && <p id={`${fieldId}-input-error`} role="alert">{inputProblem}</p>}
    </form>}
    {!resource && <div className="pull-request-empty"><GitPullRequest size={28} strokeWidth={1.3} /><h2>A closer look at a pull request</h2><p>Paste a PR link above, or open one from your conversations or the pull request menu.</p>{authored.length > 0 && <div className="pull-request-recents"><h3>Your open pull requests</h3>{authored.slice(0, 6).map(pr => <button type="button" className={uiStyles.row} key={pr.id} onClick={() => choose(pr.url)}><span>{pr.title}</span><small>{pr.repository} #{pr.number}</small></button>)}</div>}</div>}
    {resource && <>

      {problem && <div className="pull-request-error" role="alert"><CircleAlert size={15} /><span>{problem}{details && ' Showing the last loaded version.'}</span><button type="button" className={uiStyles.button} onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
      {!details && loading && <div className="pull-request-loading" role="status"><RefreshCw className="pull-request-spinning" size={17} />Loading pull request…</div>}
      {details && <div className="pull-request-summary-scroll" tabIndex={0} aria-label="Pull request overview and changes">
        <PullRequestSummary pr={details} ui={ui} onSelect={choose}>
          <section className="pull-request-changes" aria-label="Pull request changes">
            <h2>Changes <span className="pull-request-delta"><span>+{details.additions}</span><span>−{details.deletions}</span></span></h2>
            <div className="pull-request-diff">
              {diffProblem && <div className="pull-request-error" role="alert"><CircleAlert size={15} /><span>{diffProblem}</span><button type="button" className={uiStyles.button} onClick={() => setDiffRefresh(value => value + 1)}>Retry</button><ExternalLink href={`${details.url}/files`}>View on GitHub</ExternalLink></div>}
              {!diff && diffLoading && <div className="pull-request-loading" role="status"><RefreshCw className="pull-request-spinning" size={17} />Loading changes…</div>}
              {diff && Diff && <Diff document={diff} workspaceId={workspaceId} visible={visible} refreshing={diffLoading} onRefresh={() => setDiffRefresh(value => value + 1)} />}
              {diff && !Diff && <div className="pull-request-loading">Enable Diff Viewer to view changes here. <ExternalLink href={`${details.url}/files`}>View on GitHub</ExternalLink></div>}
            </div>
          </section>
        </PullRequestSummary>
      </div>}
    </>}
  </section>
}

const pullRequestPane: BrowserPlugin = ctx => {
  const host = ctx.clientHost
  const ui = ctx.clientUi
  const layout = ctx.clientWorkspaceLayout
  layout.registerPaneKind(ctx, {
    id: PULL_REQUEST_PANE_KIND, label: 'Pull request', shortcut: 'g',
    description: 'Read a GitHub pull request, checks, discussion, and code changes', icon: GitPullRequest,
    renderer: props => <PullRequestPane {...props} host={host} ui={ui} />,
  })
  ui.registerStyle(ctx, 'pull-request-pane', String(styles))
  ctx.effect(() => {
    const open = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : undefined
      if (!anchor || anchor.hasAttribute('download') || anchor.hasAttribute('data-pull-request-external') || anchor.hasAttribute('data-pull-request-select')) return
      const resource = pullRequestLinkResource(anchor.href)
      if (!resource || !layout.available()) return
      event.preventDefault()
      if (anchor.closest<HTMLElement>('[data-pull-request-resource]')?.dataset.pullRequestResource === resource) return
      if (anchor.closest('#pull-requests-panel')) ui.overlays.close(PR_PANE)
      openPullRequestPane(layout, resource, anchor)
    }
    document.addEventListener('click', open, true)
    return () => document.removeEventListener('click', open, true)
  })
}
pullRequestPane.inject = ['clientHost', 'clientUi', 'clientWorkspaceLayout']
pullRequestPane.resources = { requires: { components: ['markdown.content', DIFF_CONTENT_COMPONENT] } }
export default pullRequestPane
