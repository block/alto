import type { ComponentType } from 'react'
import type { Context } from 'cordis'

export const TERMINAL_DEFAULT_DIRECTORY = 'ghostty-terminal.default-directory'

export interface GhosttyTerminalConfig {
  configuration?: string
  command?: string
  workingDirectory?: string
}

export interface TerminalIdentity {
  workspaceId: string
  paneId: string
  tabId: string
}

export interface TerminalLaunchRequest {
  identity?: TerminalIdentity
  workingDirectory?: string
  command?: string
}

export interface TerminalLauncher {
  id: string
  prepare(request: TerminalLaunchRequest): Promise<{ command?: string }>
  close(identity: TerminalIdentity): Promise<void>
}

export interface GhosttyTerminalProps extends TerminalLaunchRequest {
  configuration?: string
  active?: boolean
  focused?: boolean
}

export interface TerminalTabAccessoryProps {
  identity: TerminalIdentity
  /** The tab is the selected tab of its pane. */
  selected: boolean
  /** The tab's terminal has keyboard focus. */
  focused: boolean
  /** The tab's pane is shown in the current workspace. */
  visible: boolean
}

/** A small element drawn after a terminal tab's title, such as a status badge. */
export interface TerminalTabAccessory {
  id: string
  order?: number
  renderer: ComponentType<TerminalTabAccessoryProps>
}

export interface ClientGhosttyTerminalService {
  renderer: ComponentType<GhosttyTerminalProps>
  registerLauncher(owner: Context, launcher: TerminalLauncher): { dispose(): void }
  close(identity: TerminalIdentity): Promise<void>
  registerTabAccessory(owner: Context, accessory: TerminalTabAccessory): { dispose(): void }
  /** Registered accessories in display order. The array changes only when registrations do. */
  tabAccessories(): readonly TerminalTabAccessory[]
  subscribeTabAccessories(listener: () => void): () => void
}

declare module 'cordis' {
  interface Context {
    clientGhosttyTerminal: ClientGhosttyTerminalService
  }
}
