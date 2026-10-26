import { ArrowUpRight, Bell, ChevronDown, Eye, LoaderCircle, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { clientStyles, type BrowserPlugin, type ClientHostService } from '../../src/client/plugin-api.js'
import type { WorkspacePaneAddonProps } from './workspace-layout-api.js'
import type { PrWatch as Watch, PrWatcherMember as WatchMember, PrWatcherSnapshot as Snapshot, PrWatcherAlert, PrWatcherActionProps } from './pr-watcher-api.js'
import type {} from './chat-notifications-api.js'
import { SettingsSwitch } from './ui/settings.js'
import styles from './pr-watcher.css'

const EMPTY: Snapshot = { available: false, watches: [], alerts: [] }
const STATUS: Record<Watch['status'], string> = {
  starting: 'Starting on Blox', watching: 'Watching', working: 'Working', paused: 'Paused', blocked: 'Needs attention', done: 'Finished',
}

function useWatches(host: ClientHostService): Snapshot {
  const state = useSyncExternalStore(host.subscribe, host.snapshot)
  return state.snapshot?.extensions['pr-watcher'] as unknown as Snapshot | undefined ?? EMPTY
}

function sameRequest(left: string, right: string): boolean {
  return left.replace(/\/$/, '').toLowerCase() === right.replace(/\/$/, '').toLowerCase()
}

/** Await the server mutation before showing a changed mode; failures keep the saved setting. */
function useOperation() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const active = useRef(true)
  const pending = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(undefined)
    try { await operation() }
    catch (problem) { if (active.current) setError(problem instanceof Error ? problem.message : String(problem)) }
    finally {
      pending.current = false
      if (active.current) setBusy(false)
    }
  }
  return { busy, error, run }
}

export function PrWatcherAction({ host, ...request }: PrWatcherActionProps & { host: ClientHostService }): ReactNode {
  const state = useWatches(host)
  const operation = useOperation()
  const existing = state.watches.find((watch) => watch.scope === request.scope && (
    sameRequest(watch.pullRequestUrl, request.pullRequestUrl)
    || request.scope === 'stack' && watch.members.some((member) => sameRequest(member.url, request.pullRequestUrl))
  ))
  if (!state.available && !existing) return null
  const label = existing?.threadId ? 'Open watcher' : existing ? 'Retry on Blox' : request.scope === 'stack' ? 'Watch stack on Blox' : 'Watch on Blox'
  return <div className="pr-watcher-action">
    <button className={`${clientStyles.button} pr-watcher-start`} type="button" disabled={operation.busy}
      title="Watches while Alto is running; fixes run on Blox. CI fixes automatic; review feedback is notify-only until enabled."
      onClick={() => void operation.run(() => existing?.threadId
        ? host.call('pr-watcher.open', { id: existing.id })
        : host.call('pr-watcher.start', {
          pullRequestUrl: request.pullRequestUrl, scope: request.scope, sourceCwd: request.sourceCwd,
          ...(request.sourceThreadId ? { sourceThreadId: request.sourceThreadId } : {}),
        }))}>
      {operation.busy ? <LoaderCircle size={14} className="pr-watcher-spinner" /> : <Eye size={14} />}
      <span>{operation.busy ? 'Opening watcher…' : label}</span>
      {existing && <small>{STATUS[existing.status]}</small>}
    </button>
    {operation.error && <p className="pr-watcher-error" role="alert">{operation.error}</p>}
  </div>
}

function FeedbackToggle({ host, watch, member }: { host: ClientHostService; watch: Watch; member: WatchMember }): ReactNode {
  const operation = useOperation()
  return <div className="pr-watcher-feedback-control">
    <button className="pr-watcher-feedback-toggle" type="button" role="switch" aria-checked={member.autoAddressFeedback}
      aria-label={`Automatically address feedback for PR #${member.number}`} disabled={operation.busy || watch.status === 'done'}
      onClick={() => void operation.run(() => host.call('pr-watcher.feedback', {
        id: watch.id, number: member.number, enabled: !member.autoAddressFeedback,
      }))}>
      <span>{watch.scope === 'stack' && <strong>#{member.number}</strong>}<span title={member.title}>{watch.scope === 'stack' ? member.title : 'Auto-address feedback'}</span></span>
      <SettingsSwitch on={member.autoAddressFeedback} />
    </button>
    {operation.error && <p className="pr-watcher-error" role="alert">{operation.error}</p>}
  </div>
}

function WatchControls({ host, watch, alert }: { host: ClientHostService; watch: Watch; alert?: PrWatcherAlert | undefined }): ReactNode {
  const operation = useOperation()
  const paused = watch.status === 'paused'
  const canResume = paused || watch.status === 'blocked'
  const count = watch.members.filter((member) => member.autoAddressFeedback).length
  return <section className="pr-watcher-controls" aria-label="Pull request watcher" title="Watches while Alto is running; fixes run on Blox. CI fixes automatic.">
    <div className={`${clientStyles.toolbar} pr-watcher-toolbar`}>
      <div className={`pr-watcher-status is-${watch.status}`} role="status" title={watch.message ?? STATUS[watch.status]}>
        {watch.status === 'working' || watch.status === 'starting'
          ? <LoaderCircle size={14} className="pr-watcher-spinner" /> : <Eye size={14} />}
        <span>{STATUS[watch.status]}</span>
      </div>
      <span className="pr-watcher-label" title={watch.label}>{watch.label}</span>
      {watch.status !== 'done' && <button className={`${clientStyles.iconButton} pr-watcher-pause`} type="button"
        disabled={operation.busy || watch.status === 'starting'} aria-label={canResume ? 'Resume PR watcher' : 'Pause PR watcher'}
        title={canResume ? 'Resume watcher' : 'Pause watcher'}
        onClick={() => void operation.run(() => host.call(canResume ? 'pr-watcher.resume' : 'pr-watcher.pause', { id: watch.id }))}>
        {operation.busy ? <LoaderCircle size={14} className="pr-watcher-spinner" /> : canResume ? <Play size={14} /> : <Pause size={14} />}
      </button>}
    </div>
    {watch.scope === 'stack' ? <details className="pr-watcher-feedback">
      <summary><Bell size={13} /><span>Review feedback</span><small>{count ? `${count} of ${watch.members.length} automatic` : 'Notify only'}</small><ChevronDown size={13} /></summary>
      <div className="pr-watcher-members">{watch.members.map((member) => <FeedbackToggle key={member.number} host={host} watch={watch} member={member} />)}</div>
    </details> : watch.members[0] && <FeedbackToggle host={host} watch={watch} member={watch.members[0]} />}
    {alert && <a className="pr-watcher-latest" href={watch.pullRequestUrl} target="_blank" rel="noreferrer"
      title={alert.body} aria-live="polite"><Bell size={13} /><span>{alert.title}</span><ArrowUpRight size={13} /></a>}
    {watch.message && (watch.status === 'blocked' || watch.status === 'paused') && <p className="pr-watcher-message">{watch.message}</p>}
    {operation.error && <p className="pr-watcher-error" role="alert">{operation.error}</p>}
  </section>
}

export function PrWatcherPane({ host, session }: WorkspacePaneAddonProps & { host: ClientHostService }): ReactNode {
  const state = useWatches(host)
  const sessionState = useSyncExternalStore(session.subscribe, session.snapshot)
  const watch = state.watches.find((candidate) => candidate.threadId && candidate.threadId === sessionState.threadId)
  const alert = state.alerts.findLast((candidate) => candidate.threadId === sessionState.threadId)
  return watch ? <WatchControls key={watch.id} host={host} watch={watch} alert={alert} /> : null
}

const prWatcher: BrowserPlugin = (ctx) => {
  ctx.clientUi.registerStyle(ctx, 'pr-watcher', String(styles))
  ctx.clientUi.registerComponent<PrWatcherActionProps>(ctx, 'pr-watcher.action', (props) => <PrWatcherAction {...props} host={ctx.clientHost} />)
  ctx.clientWorkspaceLayout.registerPaneAddon(ctx, {
    id: 'pr-watcher.controls', placement: 'after-header', order: 10,
    renderer: (props) => <PrWatcherPane {...props} host={ctx.clientHost} />,
  })
  ctx.effect(() => {
    const storageKey = 'alto.pr-watcher.seen-alerts'
    let stored: unknown
    try { stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') } catch { stored = [] }
    const seen = new Set<string>(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string').slice(-500) : [])
    const pending = new Set<string>()
    const suppressions = new Map<string, () => void>()
    let active = true
    const sync = (): void => {
      if (!active) return
      const state = ctx.clientHost.snapshot().snapshot?.extensions['pr-watcher'] as unknown as Snapshot | undefined
      const threads = new Set(state?.watches.flatMap((watch) => watch.threadId && ['starting', 'working', 'blocked'].includes(watch.status) ? [watch.threadId] : []) ?? [])
      for (const [id, release] of suppressions) if (!threads.has(id)) { release(); suppressions.delete(id) }
      for (const id of threads) if (!suppressions.has(id)) suppressions.set(id, ctx.clientNotifications.suppressCompletion(ctx, id))
      for (const alert of state?.alerts ?? []) {
        if (seen.has(alert.id) || pending.has(alert.id)) continue
        pending.add(alert.id)
        void ctx.clientNotifications.notify({ ...alert, tag: `alto-pr-watcher-${alert.threadId}` }).catch(() => {}).finally(() => {
          pending.delete(alert.id)
          seen.add(alert.id)
          while (seen.size > 500) seen.delete(seen.values().next().value!)
          try { localStorage.setItem(storageKey, JSON.stringify([...seen])) } catch {}
        })
      }
    }
    const unsubscribe = ctx.clientHost.subscribe(sync)
    sync()
    return () => { active = false; unsubscribe(); for (const release of suppressions.values()) release(); suppressions.clear() }
  }, 'pr-watcher.notifications')
}
prWatcher.inject = ['clientHost', 'clientUi', 'clientWorkspaceLayout', 'clientNotifications']
prWatcher.resources = {
  provides: { components: ['pr-watcher.action'] },
  requires: { extensions: ['pr-watcher', 'pr-watcher.start', 'pr-watcher.open', 'pr-watcher.pause', 'pr-watcher.resume', 'pr-watcher.feedback'] },
}
export default prWatcher
