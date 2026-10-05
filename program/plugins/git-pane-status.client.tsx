import {
  CircleCheck,
  CircleDot,
  CircleX,
  GitBranch,
  GitPullRequest,
  RefreshCw,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { BrowserPlugin } from '../../src/client/plugin-api.js'
import type { ThreadSummary } from '../../src/shared/protocol.js'
import { DIFF_VIEWER_PANE_KIND } from './diff-viewer-api.js'
import type { ClientGitSupportService } from './git-support-client-api.js'
import type { GitBranchState, GitChangedFile, GitRepositoryState } from './git-support-api.js'
import {
  checkLabel,
  compactPath,
  gitFileGroups,
  projectThreadGitState,
  threadGitContext,
} from './git-support-ui.js'
import type { ClientWorkContextsService } from './work-contexts-client-api.js'
import type {
  ClientWorkspaceLayoutService,
  WorkspacePaneAddonProps,
} from './workspace-layout-api.js'
import type { ClientSessionSnapshot } from './session-api.js'
import { useStoreSelector } from './ui/store-selector.js'

interface GitPaneSessionSnapshot {
  threads: ClientSessionSnapshot['threads']
  history: ClientSessionSnapshot['history']
  threadId?: string
  activeProjectId?: string
  workspace: string
}

function gitPaneSessionSnapshot(state: ClientSessionSnapshot): GitPaneSessionSnapshot {
  return {
    threads: state.threads,
    history: state.history,
    ...(state.threadId ? { threadId: state.threadId } : {}),
    ...(state.activeProjectId ? { activeProjectId: state.activeProjectId } : {}),
    workspace: state.session.workspace,
  }
}

function gitPaneSessionSnapshotEqual(
  left: GitPaneSessionSnapshot,
  right: GitPaneSessionSnapshot,
): boolean {
  return left.threads === right.threads
    && left.history === right.history
    && left.threadId === right.threadId
    && left.activeProjectId === right.activeProjectId
    && left.workspace === right.workspace
}

export function openGitDiffPane(
  layout: Pick<ClientWorkspaceLayoutService, 'openPane'>,
  workspace: string,
  threadId: string | undefined,
  thread: ThreadSummary | undefined,
  projectId: string | undefined,
): void {
  layout.openPane({
    direction: 'horizontal',
    kind: DIFF_VIEWER_PANE_KIND,
    workspace,
    ...(threadId ? { anchorThreadId: threadId } : {}),
    ...(thread ? { thread } : {}),
    ...(projectId ? { projectId } : {}),
  })
}

function CheckIcon({ state }: { state: GitRepositoryState['pullRequests'][number]['checks'] }): ReactNode {
  if (state === 'passing') return <CircleCheck className="is-passing" size={12} />
  if (state === 'failing') return <CircleX className="is-failing" size={12} />
  return <CircleDot className="is-pending" size={12} />
}

function FileList({ label, files }: { label: string; files: GitChangedFile[] }): ReactNode {
  if (!files.length) return null
  return (
    <section className="git-pane-files">
      <h4>{label}<span>{files.length}</span></h4>
      {files.slice(0, 8).map((file) => (
        <div title={file.path} key={`${label}:${file.path}`}>
          <span>{compactPath(file.path)}</span>
          <code>{file.indexStatus === '?' ? '?' : `${file.indexStatus}${file.worktreeStatus}`.trim()}</code>
        </div>
      ))}
      {files.length > 8 && <small>{files.length - 8} more</small>}
    </section>
  )
}

function GitPanePopover({
  anchor,
  state,
  branchOnly = false,
  refresh,
  close,
}: {
  anchor: HTMLElement
  state: GitRepositoryState
  branchOnly?: boolean
  refresh(): void
  close(): void
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const bounds = anchor.getBoundingClientRect()
  const left = Math.max(10, Math.min(bounds.right - 320, window.innerWidth - 330))
  const top = Math.max(10, Math.min(bounds.bottom + 6, window.innerHeight - 440))
  const files = gitFileGroups(state)
  const pullRequest = state.pullRequests[0]

  useEffect(() => {
    const dismiss = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !anchor.contains(target)) close()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', escape)
    }
  }, [anchor, close])

  return createPortal(
    <div className="git-pane-popover" style={{ left, top }} ref={root}>
      <header>
        <strong>Git</strong>
        <button type="button" title="Refresh Git status" aria-label="Refresh Git status" onClick={refresh}>
          <RefreshCw size={12} />
        </button>
      </header>
      <section className="git-pane-summary">
        <div><GitBranch size={13} /><span>{state.branch}</span><small>{state.head}</small></div>
        {state.upstream && (
          <div className="git-pane-sync">
            <span>{state.upstream}</span>
            {(state.ahead > 0 || state.behind > 0) && <small>↑{state.ahead} ↓{state.behind}</small>}
          </div>
        )}
        {pullRequest && (
          <a href={pullRequest.url} target="_blank" rel="noreferrer">
            <GitPullRequest size={13} />
            <span>#{pullRequest.number} · {pullRequest.title}</span>
          </a>
        )}
        {pullRequest?.checks && (
          <div>
            <CheckIcon state={pullRequest.checks} />
            <span>{checkLabel(pullRequest.checks)}</span>
          </div>
        )}
      </section>
      <FileList label="Staged" files={files.staged} />
      <FileList label="Modified" files={files.modified} />
      <FileList label="Untracked" files={files.untracked} />
      {!branchOnly && !state.files.length && <div className="git-pane-clean">Working tree clean</div>}
    </div>,
    document.body,
  )
}

function VisibleGitPaneStatus({
  focused,
  session,
  git,
  contexts,
}: WorkspacePaneAddonProps & {
  git: ClientGitSupportService
  contexts: ClientWorkContextsService
}): ReactNode {
  const sessionState = useStoreSelector(
    session,
    gitPaneSessionSnapshot,
    gitPaneSessionSnapshotEqual,
  )
  const contextState = useSyncExternalStore(contexts.subscribe, contexts.snapshot)
  const gitSnapshot = useSyncExternalStore(git.subscribe, git.snapshot)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [capturedBranch, setCapturedBranch] = useState<GitBranchState>()
  const thread = sessionState.threads.find((candidate) => candidate.id === sessionState.threadId)
    ?? sessionState.history.entries.find((candidate) => candidate.id === sessionState.threadId)
  const gitContext = threadGitContext({
    ...(sessionState.threadId ? { id: sessionState.threadId } : {}),
    cwd: sessionState.workspace,
    ...(sessionState.activeProjectId ? { projectId: sessionState.activeProjectId } : {}),
    ...(thread?.gitInfo ? { gitInfo: thread.gitInfo } : {}),
  }, contexts)
  const location = gitContext.location
  const repositoryState = git.repositoryFor(location)
  const { state, branchOnly } = projectThreadGitState(gitContext, repositoryState, capturedBranch)
  void contextState
  void gitSnapshot

  useEffect(() => {
    let current = true
    setCapturedBranch(undefined)
    if (gitContext.kind === 'local') void git.inspect(location, { includeRemote: focused })
    if (gitContext.branch) {
      void git.inspectBranch(location, gitContext.branch, {
        ...(gitContext.repository ? { repository: gitContext.repository } : {}),
        force: gitContext.kind === 'remote',
      }).then((next) => {
        if (current) setCapturedBranch(next)
      })
    }
    return () => {
      current = false
    }
  }, [
    focused,
    git,
    gitContext.branch,
    gitContext.kind,
    gitContext.repository,
    gitContext.targetUpdatedAt,
    location,
  ])

  const refresh = (): void => {
    if (gitContext.kind === 'local') {
      void git.inspect(location, { includeRemote: true, force: true })
    }
    if (gitContext.branch) {
      void git.inspectBranch(location, gitContext.branch, {
        ...(gitContext.repository ? { repository: gitContext.repository } : {}),
        force: true,
      }).then(setCapturedBranch)
    }
  }

  if (!state) return null
  const pullRequest = state.pullRequests[0]
  const sync = state.ahead || state.behind
  if (!pullRequest && !sync) return null
  const label = pullRequest
    ? `#${pullRequest.number}`
    : `↑${state.ahead} ↓${state.behind}`

  return (
    <div className="git-pane-control">
      <button
        className={`git-pane-button${pullRequest?.checks ? ` is-${pullRequest.checks}` : ''}`}
        type="button"
        ref={anchor}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Git status"
        onClick={(event) => {
          event.stopPropagation()
          const next = !open
          setOpen(next)
          if (next) refresh()
        }}
      >
        {pullRequest ? <GitPullRequest size={11} /> : <GitBranch size={11} />}
        <span>{label}</span>
      </button>
      {open && anchor.current && (
        <GitPanePopover
          anchor={anchor.current}
          state={state}
          branchOnly={branchOnly}
          refresh={refresh}
          close={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function GitPaneStatus(props: WorkspacePaneAddonProps & {
  git: ClientGitSupportService
  contexts: ClientWorkContextsService
}): ReactNode {
  return props.visible ? <VisibleGitPaneStatus {...props} /> : null
}

const gitPaneStatus: BrowserPlugin = (ctx) => {
  ctx.clientWorkspaceLayout.registerPaneAddon(ctx, {
    id: 'git-pane-status',
    placement: 'pane-title',
    order: 30,
    renderer: (props) => (
      <GitPaneStatus
        {...props}
        git={ctx.clientGitSupport}
        contexts={ctx.clientWorkContexts}
      />
    ),
  })
}

gitPaneStatus.inject = ['clientGitSupport', 'clientWorkContexts', 'clientWorkspaceLayout']

export default gitPaneStatus
