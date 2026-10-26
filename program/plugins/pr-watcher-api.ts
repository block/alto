export const PR_WATCHER_STATE = 'pr-watcher'

export interface PrWatcherMember {
  number: number
  url: string
  title: string
  autoAddressFeedback: boolean
}

export interface PrWatch {
  id: string
  scope: 'pr' | 'stack'
  pullRequestUrl: string
  label: string
  threadId?: string
  status: 'starting' | 'watching' | 'working' | 'paused' | 'blocked' | 'done'
  message?: string
  members: PrWatcherMember[]
  updatedAt: number
}

export interface PrWatcherAlert {
  id: string
  threadId: string
  title: string
  body: string
}

export interface PrWatcherSnapshot {
  available: boolean
  watches: PrWatch[]
  alerts: PrWatcherAlert[]
}

export interface PrWatcherActionProps {
  pullRequestUrl: string
  scope: 'pr' | 'stack'
  sourceCwd: string
  sourceThreadId?: string
}
