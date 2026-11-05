import type { Plugin } from 'cordis'
import { useSyncExternalStore } from 'react'
import { aggregateThreadWorkStatus, threadWorkStatusCounts } from './thread-status-api.js'
import { ThreadStatusIndicator } from './ui/thread-status.js'
import type { WorkspaceTabAddonProps, WorkspaceTabGroupAddonProps } from './workspace-layout-api.js'

const workspaceThreadStatus: Plugin = (ctx) => {
  const TabStatus = ({ threadIds }: WorkspaceTabAddonProps) => {
    const status = useSyncExternalStore(
      ctx.clientThreadStatus.subscribe,
      ctx.clientThreadStatus.snapshot,
    )
    const aggregate = aggregateThreadWorkStatus(status, threadIds)
    if (!aggregate) return null
    return (
      <span className="workspace-tab-thread-status">
        <ThreadStatusIndicator status={aggregate} />
      </span>
    )
  }

  const GroupStatus = ({ threadIds }: WorkspaceTabGroupAddonProps) => {
    const status = useSyncExternalStore(
      ctx.clientThreadStatus.subscribe,
      ctx.clientThreadStatus.snapshot,
    )
    const counts = threadWorkStatusCounts(status, threadIds)
    if (!counts.running && !counts.finished) return null
    const summaries = [
      { status: 'running', count: counts.running, label: 'working' },
      { status: 'finished', count: counts.finished, label: 'unread' },
    ] as const
    return <span className="workspace-tab-group-statuses">
      {summaries.filter(({ count }) => count > 0).map(({ status, count, label }) => {
        const description = `${count} ${label} ${count === 1 ? 'chat' : 'chats'}`
        return <span className="workspace-tab-group-status-item" data-status={status} key={status}
          role="img" aria-label={description} title={description}>
          <span aria-hidden="true"><ThreadStatusIndicator status={status} /></span>
          <span className="workspace-tab-group-status-count" aria-hidden="true">{count}</span>
        </span>
      })}
    </span>
  }

  ctx.clientWorkspaceLayout.registerTabAddon(ctx, {
    id: 'workspace-thread-status',
    order: 10,
    renderer: TabStatus,
    groupRenderer: GroupStatus,
  })
}

workspaceThreadStatus.inject = ['clientThreadStatus', 'clientWorkspaceLayout']

export default workspaceThreadStatus
