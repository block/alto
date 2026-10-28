import type { WorkspaceTabOrientation } from './workspace-layout-api.js'

export interface VerticalTabPreferences {
  /** Horizontal shows the compositor's top tabs; vertical moves them into the side rail. */
  orientation: WorkspaceTabOrientation
  width: number
  collapsed: boolean
}

export interface ClientVerticalTabsService {
  subscribe(listener: () => void): () => void
  snapshot(): VerticalTabPreferences
  setOrientation(orientation: WorkspaceTabOrientation): void
  toggleOrientation(): void
  setWidth(width: number): void
  setCollapsed(collapsed: boolean): void
  toggleCollapsed(): void
}

declare module 'cordis' {
  interface Context {
    clientVerticalTabs: ClientVerticalTabsService
  }
}
