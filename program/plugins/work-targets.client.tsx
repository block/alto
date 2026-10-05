import {
  Check,
  Cloud,
  GitBranch,
  GitBranchPlus,
  Laptop,
  LoaderCircle,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { BrowserPlugin } from '../../src/client/plugin-api.js'
import type {
  WorkCheckout,
  WorkProviderDescriptor,
  Workstream,
  WorkTarget,
} from './work-contexts-api.js'
import type { ClientWorkContextsService } from './work-contexts-client-api.js'
import type { ClientSessionService, ClientSessionSnapshot } from './session-api.js'
import type { WorkspacePaneAddonProps } from './workspace-layout-api.js'
import { useStoreSelector } from './ui/store-selector.js'
import { startWorktreeStatusRefresh } from './work-contexts-refresh.js'
import styles from './work-targets.css'

type BranchDestination = 'checkout' | 'worktree' | `provider:${string}`

interface WorkTargetSessionSnapshot {
  threads: ClientSessionSnapshot['threads']
  history: ClientSessionSnapshot['history']
  threadId?: string
  activeProjectId?: string
  workspace: string
  remoteLocation?: string
}

function workTargetSessionSnapshot(state: ClientSessionSnapshot): WorkTargetSessionSnapshot {
  return {
    threads: state.threads,
    history: state.history,
    ...(state.threadId ? { threadId: state.threadId } : {}),
    ...(state.activeProjectId ? { activeProjectId: state.activeProjectId } : {}),
    workspace: state.session.workspace,
    ...(state.remoteLocation ? { remoteLocation: state.remoteLocation } : {}),
  }
}

function workTargetSessionSnapshotEqual(
  left: WorkTargetSessionSnapshot,
  right: WorkTargetSessionSnapshot,
): boolean {
  return left.threads === right.threads
    && left.history === right.history
    && left.threadId === right.threadId
    && left.activeProjectId === right.activeProjectId
    && left.workspace === right.workspace
    && left.remoteLocation === right.remoteLocation
}

function compactLocation(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value
}

function providerFor(
  providers: readonly WorkProviderDescriptor[],
  kind: string,
): WorkProviderDescriptor | undefined {
  return providers.find((provider) => provider.id === kind)
}

function checkoutDetail(
  checkout: WorkCheckout,
  providers: readonly WorkProviderDescriptor[],
): string {
  if (checkout.kind === 'local') {
    const kind = checkout.primary ? 'Local checkout' : 'Local worktree'
    return `${kind} · ${compactLocation(checkout.location)}${checkout.dirty ? ' · uncommitted changes' : ''}`
  }
  const provider = providerFor(providers, checkout.kind)
  return `${provider?.label ?? checkout.kind} · ${checkout.label}${checkout.status ? ` · ${checkout.status}` : ''}`
}

function WorkTargetPicker({
  anchor,
  streams,
  providers,
  currentCheckout,
  selected,
  threadId,
  session,
  contexts,
  close,
}: {
  anchor: HTMLElement
  streams: Workstream[]
  providers: WorkProviderDescriptor[]
  currentCheckout: WorkCheckout
  selected: WorkTarget | undefined
  threadId: string | undefined
  session: ClientSessionService
  contexts: ClientWorkContextsService
  close(): void
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [addingBranch, setAddingBranch] = useState(false)
  const [branchDestination, setBranchDestination] = useState<BranchDestination>('worktree')
  const [branch, setBranch] = useState('')
  const selectedId = selected?.checkoutId ?? currentCheckout.id
  const registeredCheckouts = streams.flatMap((stream) => stream.checkouts)
  const selectedIsMissing = selected && !registeredCheckouts.some((checkout) => checkout.id === selected.checkoutId)
  const checkouts = selectedIsMissing ? [...registeredCheckouts, selected] : registeredCheckouts
  const worktreeSource = selected?.kind === 'local'
    ? selected
    : checkouts.find((checkout) => checkout.kind === 'local' && checkout.branch === selected?.branch)
      ?? currentCheckout
  const worktreeSourceId = selected?.kind === 'local' ? selected.checkoutId : worktreeSource.id
  const mainCheckout = registeredCheckouts.find((checkout) => checkout.kind === 'local' && checkout.primary)
    ?? currentCheckout
  const bounds = anchor.getBoundingClientRect()
  const left = Math.max(10, Math.min(bounds.left, window.innerWidth - 326))
  const top = Math.max(10, Math.min(bounds.bottom + 6, window.innerHeight - 440))

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

  const run = async (key: string, action: () => Promise<void>): Promise<boolean> => {
    if (busy) return false
    setBusy(key)
    setError(undefined)
    try {
      await action()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const ensureTargetThread = async (workspace: string): Promise<string | undefined> => {
    if (threadId) return threadId
    try {
      return await session.ensureThread(workspace)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    }
  }

  const select = async (checkout: WorkCheckout): Promise<void> => {
    const targetThreadId = await ensureTargetThread(
      checkout.kind === 'local' ? checkout.location : currentCheckout.location,
    )
    if (!targetThreadId) return
    if (await run(checkout.id, () => contexts.setTarget(targetThreadId, checkout.id))) close()
  }

  const createProviderTarget = async (provider: WorkProviderDescriptor): Promise<void> => {
    const targetThreadId = await ensureTargetThread(worktreeSource.location)
    if (!targetThreadId) return
    if (await run(
      `provider:${provider.id}`,
      () => contexts.createProviderTarget(provider.id, targetThreadId, worktreeSource.id),
    )) close()
  }

  const createBranch = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const name = branch.trim()
    if (!name) return
    const source = branchDestination === 'checkout' ? mainCheckout : worktreeSource
    const targetThreadId = await ensureTargetThread(source.location)
    if (!targetThreadId) return
    const created = await run('new-branch', async () => {
      if (branchDestination.startsWith('provider:')) {
        await contexts.createProviderBranchTarget(
          branchDestination.slice('provider:'.length),
          targetThreadId,
          source.id,
          name,
        )
      } else {
        const localPlacement = branchDestination === 'checkout' ? 'checkout' : 'worktree'
        await contexts.createLocalBranch(
          targetThreadId,
          branchDestination === 'checkout' ? mainCheckout.id : worktreeSourceId,
          name,
          localPlacement,
        )
      }
    })
    if (created) close()
  }

  return createPortal(
    <div className="work-target-popover" style={{ left, top }} ref={root}>
      <header><strong>{addingBranch ? 'New branch' : 'Branch'}</strong></header>
      {error && <p className="work-target-feedback is-error">{error}</p>}
      {addingBranch
        ? (
            <section className="work-target-create-branch">
              <form onSubmit={(event) => void createBranch(event)}>
                <span>From {branchDestination === 'checkout' ? mainCheckout.branch : worktreeSource.branch}</span>
                <input
                  aria-label="Branch name"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={branch}
                  placeholder="feature/my-branch"
                  disabled={Boolean(busy)}
                  onChange={(event) => setBranch(event.target.value)}
                />
                <div className="work-target-branch-destinations" role="radiogroup" aria-label="Branch destination">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={branchDestination === 'checkout'}
                    className={branchDestination === 'checkout' ? 'is-selected' : ''}
                    onClick={() => setBranchDestination('checkout')}
                  >
                    <Laptop size={13} />
                    <span><strong>Main checkout</strong><small>{compactLocation(mainCheckout.location)}</small></span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={branchDestination === 'worktree'}
                    className={branchDestination === 'worktree' ? 'is-selected' : ''}
                    onClick={() => setBranchDestination('worktree')}
                  >
                    <GitBranchPlus size={13} />
                    <span><strong>New worktree</strong><small>Separate folder beside the repository</small></span>
                  </button>
                  {providers.filter((provider) => provider.supportsBranchTarget).map((provider) => {
                    const destination = `provider:${provider.id}` as const
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={branchDestination === destination}
                        className={branchDestination === destination ? 'is-selected' : ''}
                        key={provider.id}
                        onClick={() => setBranchDestination(destination)}
                      >
                        <Cloud size={13} />
                        <span><strong>{provider.label}</strong><small>{provider.description ?? 'Remote checkout'}</small></span>
                      </button>
                    )
                  })}
                </div>
                <div className="work-target-branch-actions">
                  <button type="button" onClick={() => setAddingBranch(false)}>Cancel</button>
                  <button type="submit" disabled={Boolean(busy) || !branch.trim()}>
                    {busy === 'new-branch' && <LoaderCircle className="is-spinning" size={11} />}
                    Create
                  </button>
                </div>
              </form>
            </section>
          )
        : (
            <>
              <section className="work-target-checkouts" aria-label="Available checkouts">
                {checkouts.map((checkout) => (
                  <button
                    className={`work-target-option${selectedId === checkout.id ? ' is-selected' : ''}`}
                    type="button"
                    title={checkout.location}
                    disabled={Boolean(busy)}
                    key={checkout.id}
                    onClick={() => void select(checkout)}
                  >
                    <span className={`work-target-icon is-${checkout.statusTone ?? 'neutral'}`}>
                      {busy === checkout.id
                        ? <LoaderCircle className="is-spinning" size={14} />
                        : checkout.kind === 'local' ? <Laptop size={14} /> : <Cloud size={14} />}
                    </span>
                    <span><strong>{checkout.branch}</strong><small>{checkoutDetail(checkout, providers)}</small></span>
                    {selectedId === checkout.id && <Check size={14} />}
                  </button>
                ))}
              </section>
              <section className="work-target-actions">
                <div className="work-target-actions-title">Actions for <strong>{worktreeSource.branch}</strong></div>
                {providers.filter((provider) => provider.supportsExistingTarget).map((provider) => (
                  <button
                    className="work-target-option is-create"
                    type="button"
                    disabled={Boolean(busy)}
                    key={provider.id}
                    onClick={() => void createProviderTarget(provider)}
                  >
                    <span className="work-target-icon">
                      {busy === `provider:${provider.id}`
                        ? <LoaderCircle className="is-spinning" size={14} />
                        : <Cloud size={14} />}
                    </span>
                    <span><strong>Run with {provider.label}</strong><small>{provider.description ?? 'Create a remote checkout'}</small></span>
                  </button>
                ))}
                <button
                  className="work-target-option is-create"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setAddingBranch(true)}
                >
                  <span className="work-target-icon"><GitBranchPlus size={14} /></span>
                  <span><strong>New branch…</strong><small>Create a new branch locally or remotely</small></span>
                </button>
              </section>
            </>
          )}
    </div>,
    document.body,
  )
}

function WorktreeStatusRefresh({ location, contexts }: {
  location: string
  contexts: ClientWorkContextsService
}): null {
  useEffect(() => startWorktreeStatusRefresh(() => contexts.refresh(location)), [contexts, location])
  return null
}

function VisibleWorkTargetControl({
  focused,
  session,
  contexts,
}: WorkspacePaneAddonProps & { contexts: ClientWorkContextsService }): ReactNode {
  const sessionState = useStoreSelector(
    session,
    workTargetSessionSnapshot,
    workTargetSessionSnapshotEqual,
  )
  const contextState = useSyncExternalStore(contexts.subscribe, contexts.snapshot)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const thread = sessionState.threads.find((candidate) => candidate.id === sessionState.threadId)
    ?? sessionState.history.entries.find((candidate) => candidate.id === sessionState.threadId)
  const currentCheckout = contexts.localCheckoutForPath(
    sessionState.workspace,
    sessionState.activeProjectId,
  )
  if (!currentCheckout) return null

  const selected = contexts.targetForThread(sessionState.threadId)
  const streams = contextState.workstreams.filter((stream) => stream.projectId === currentCheckout.projectId)
  const capturedCheckout = thread?.gitInfo?.branch
    ? streams.flatMap((stream) => stream.checkouts).find((checkout) => (
        checkout.kind === 'local'
        && checkout.branch === thread.gitInfo?.branch
        && (!thread.gitInfo.sha || !checkout.head || checkout.head === thread.gitInfo.sha)
      ))
    : undefined
  const target = selected
    ?? capturedCheckout
    ?? (thread?.gitInfo?.branch && thread.gitInfo.branch !== currentCheckout.branch
      ? { ...currentCheckout, branch: thread.gitInfo.branch, head: thread.gitInfo.sha }
      : currentCheckout)

  return (
    <div className="work-target-control">
      {focused && !sessionState.remoteLocation && target.kind === 'local' && (
        <WorktreeStatusRefresh location={target.location} contexts={contexts} />
      )}
      <button
        className={`work-target-button${target.statusTone ? ` is-${target.statusTone}` : ''}`}
        type="button"
        ref={anchor}
        aria-expanded={open}
        aria-haspopup="menu"
        title={sessionState.remoteLocation ? `Agent runs on ${sessionState.remoteLocation}` : `Work on ${target.branch} · ${target.location}`}
        disabled={Boolean(sessionState.remoteLocation)}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
          if (!open) void contexts.refresh().catch(() => undefined)
        }}
      >
        <span className="work-target-branch"><GitBranch size={11} />{target.branch}</span>

      </button>
      {open && anchor.current && (
        <WorkTargetPicker
          anchor={anchor.current}
          streams={streams}
          providers={contextState.providers}
          currentCheckout={currentCheckout}
          selected={selected}
          threadId={sessionState.threadId}
          session={session}
          contexts={contexts}
          close={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function WorkTargetControl(
  props: WorkspacePaneAddonProps & { contexts: ClientWorkContextsService },
): ReactNode {
  return props.visible ? <VisibleWorkTargetControl {...props} /> : null
}

const workTargets: BrowserPlugin = (ctx) => {
  ctx.clientWorkspaceLayout.registerPaneAddon(ctx, {
    id: 'work-target',
    placement: 'pane-title',
    order: 20,
    renderer: (props) => <WorkTargetControl {...props} contexts={ctx.clientWorkContexts} />,
  })
  ctx.clientUi.registerStyle(ctx, 'work-targets', String(styles))
}

workTargets.inject = ['clientUi', 'clientWorkContexts', 'clientWorkspaceLayout']

export default workTargets
