import type { Plugin } from 'cordis'
import { memo, useCallback } from 'react'
import {
  aggregateBlockedKind,
  aggregateThreadWorkStatus,
  threadWorkStatusCounts,
  type ClientThreadStatusSnapshot,
  type ThreadBlockedKind,
  type ThreadWorkStatus,
  type ThreadWorkStatusCounts,
} from './thread-status-api.js'
import { ThreadStatusIndicator } from './ui/thread-status.js'
import { useStoreSelector } from './ui/store-selector.js'
import type { WorkspaceTabAddonProps, WorkspaceTabGroupAddonProps } from './workspace-layout-api.js'

const workspaceThreadStatus: Plugin = (ctx) => {
  const threadStatus = ctx.clientThreadStatus
  const TabStatus = memo(({ threadIds }: WorkspaceTabAddonProps) => {
    const aggregate = useStoreSelector(
      threadStatus,
      useCallback((status: ClientThreadStatusSnapshot) => tabStatus(status, threadIds), [threadIds]),
      sameTabStatus,
    )
    if (!aggregate.status) return null
    return (
      <span className="workspace-tab-thread-status">
        <ThreadStatusIndicator status={aggregate.status} kind={aggregate.kind} />
      </span>
    )
  }, sameThreads)

  const GroupStatus = memo(({ threadIds }: WorkspaceTabGroupAddonProps) => {
    const counts = useStoreSelector(
      threadStatus,
      useCallback((status: ClientThreadStatusSnapshot) => threadWorkStatusCounts(status, threadIds), [threadIds]),
      sameCounts,
    )
    if (!counts.running && !counts.blocked && !counts.finished && !counts.failed) return null
    const summaries = [
      { status: 'blocked', count: counts.blocked, label: 'waiting' },
      { status: 'failed', count: counts.failed, label: 'failed' },
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

function tabStatus(
  status: ClientThreadStatusSnapshot,
  threadIds: readonly string[],
): { status: ThreadWorkStatus | undefined; kind: ThreadBlockedKind | undefined } {
  const aggregate = aggregateThreadWorkStatus(status, threadIds)
  return { status: aggregate, kind: aggregate === 'blocked' ? aggregateBlockedKind(status, threadIds) : undefined }
}

function sameTabStatus(
  left: ReturnType<typeof tabStatus>,
  right: ReturnType<typeof tabStatus>,
): boolean {
  return left.status === right.status && left.kind === right.kind
}

function sameCounts(left: ThreadWorkStatusCounts, right: ThreadWorkStatusCounts): boolean {
  return left.running === right.running && left.blocked === right.blocked
    && left.finished === right.finished && left.failed === right.failed
}

function sameThreads(left: { threadIds: readonly string[] }, right: { threadIds: readonly string[] }): boolean {
  return left.threadIds.length === right.threadIds.length && left.threadIds.every((id, index) => id === right.threadIds[index])
}

workspaceThreadStatus.inject = ['clientThreadStatus', 'clientWorkspaceLayout']

export default workspaceThreadStatus
