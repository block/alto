import type { Context } from 'cordis'

export interface ClientNotification {
  threadId: string
  title: string
  body: string
  /** Stable native notification tag; reusing it replaces the previous alert. */
  tag: string
}

export interface ClientNotificationsService {
  /** Uses the user's desktop notification preferences and opens this exact chat on click. */
  notify(notification: ClientNotification): Promise<void>

  /** Suppresses ordinary completion alerts until released or the owning fiber unloads. */
  suppressCompletion(owner: Context, threadId: string): () => void
}

declare module 'cordis' {
  interface Context {
    clientNotifications: ClientNotificationsService
  }
}
