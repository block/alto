import type { Plugin } from 'cordis'
import { memo, useCallback } from 'react'
import { aggregateThreadWorkStatus, threadWorkStatusCounts, type ClientThreadStatusSnapshot } from './thread-status-api.js'
import { ThreadStatusIndicator } from './ui/thread-status.js'
import { useStoreSelector } from './ui/store-selector.js'
import type { WorkspaceTabAddonProps, WorkspaceTabGroupAddonProps } from './workspace-layout-api.js'

const workspaceThreadStatus: Plugin = (ctx) => {
  const threadStatus = ctx.clientThreadStatus
  const TabStatus = memo(({ threadIds }: WorkspaceTabAddonProps) => {
    const aggregate = useStoreSelector(
      threadStatus,
      useCallback((status: ClientThreadStatusSnapshot) => aggregateThreadWorkStatus(status, threadIds), [threadIds]),
    )
    if (!aggregate) return null
    return (
      <span className="workspace-tab-thread-status">
        <ThreadStatusIndicator status={aggregate} />
      </span>
    )
  }, sameThreads)

  const GroupStatus = memo(({ threadIds }: WorkspaceTabGroupAddonProps) => {
    const counts = useStoreSelector(
      threadStatus,
      useCallback((status: ClientThreadStatusSnapshot) => threadWorkStatusCounts(status, threadIds), [threadIds]),
      sameCounts,
    )
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
  }, sameThreads)

  ctx.clientWorkspaceLayout.registerTabAddon(ctx, {
    id: 'workspace-thread-status',
    order: 10,
    renderer: TabStatus,
    groupRenderer: GroupStatus,
  })
}

function sameCounts(left: { running: number; finished: number }, right: { running: number; finished: number }): boolean {
  return left.running === right.running && left.finished === right.finished
}

function sameThreads(left: { threadIds: readonly string[] }, right: { threadIds: readonly string[] }): boolean {
  return left.threadIds.length === right.threadIds.length && left.threadIds.every((id, index) => id === right.threadIds[index])
}

workspaceThreadStatus.inject = ['clientThreadStatus', 'clientWorkspaceLayout']

export default workspaceThreadStatus
