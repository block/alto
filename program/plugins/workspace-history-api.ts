import type { ThreadSummary } from '../../src/shared/protocol.js'

export const WORKSPACE_HISTORY_STATE = 'workspace-layout.history'

export interface NamedConversation {
  thread: ThreadSummary
  titles: string[]
}

export interface SavedTabSummary {
  id: string
  title: string
  active: boolean
  panes: Array<{ id: string; kind: string; threadId?: string }>
}

export interface WorkspaceHistoryService {
  conversations(): NamedConversation[]
  tabs(): SavedTabSummary[]
}

declare module 'cordis' {
  interface Context {
    workspaceHistory: WorkspaceHistoryService
  }
}
