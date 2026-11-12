import { SquareTerminal } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react'
import { clientStyles, type BrowserPlugin } from '../../src/client/plugin-api.js'
import type { ClientGhosttyTerminalService, GhosttyTerminalProps } from './ghostty-terminal-api.js'
import { movePaneTabs, type PaneTabsProps } from './pane-tabs-api.js'
import type { WorkspacePaneKindProps } from './workspace-layout-api.js'
import styles from './ghostty-workspace.css'

export interface TerminalTab {
  id: string
  title: string
  workingDirectory?: string
}

export interface TerminalTabsState {
  version: 1
  activeId: string
  nextOrdinal: number
  tabs: TerminalTab[]
}

function workspaceLeaf(path: string): string {
  return path.trim().replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'Terminal'
}

export function initialTerminalTabs(workingDirectory?: string): TerminalTabsState {
  return {
    version: 1,
    activeId: 'terminal-1',
    nextOrdinal: 2,
    tabs: [{
      id: 'terminal-1',
      title: workingDirectory ? workspaceLeaf(workingDirectory) : 'Terminal',
      ...(workingDirectory ? { workingDirectory } : {}),
    }],
  }
}

export function parseTerminalTabs(
  value: unknown,
  workingDirectory?: string,
): TerminalTabsState {
  if (!value || typeof value !== 'object') return initialTerminalTabs(workingDirectory)
  const candidate = value as Partial<TerminalTabsState>
  if (candidate.version !== 1 || !Array.isArray(candidate.tabs)) {
    return initialTerminalTabs(workingDirectory)
  }
  const tabs = candidate.tabs.flatMap((tab) => (
    tab
      && typeof tab.id === 'string'
      && typeof tab.title === 'string'
      && (tab.workingDirectory === undefined || typeof tab.workingDirectory === 'string')
      ? [{ id: tab.id, title: tab.title, ...(tab.workingDirectory ? { workingDirectory: tab.workingDirectory } : {}) }]
      : []
  ))
  if (!tabs.length) return initialTerminalTabs(workingDirectory)
  const activeId = typeof candidate.activeId === 'string'
    && tabs.some((tab) => tab.id === candidate.activeId)
    ? candidate.activeId
    : tabs[0]!.id
  const maxOrdinal = tabs.reduce((maximum, tab) => {
    const match = /^terminal-(\d+)$/u.exec(tab.id)
    return Math.max(maximum, match ? Number(match[1]) : 0)
  }, 0)
  return {
    version: 1,
    activeId,
    nextOrdinal: typeof candidate.nextOrdinal === 'number'
      ? Math.max(candidate.nextOrdinal, maxOrdinal + 1)
      : maxOrdinal + 1,
    tabs,
  }
}

function storageKey(workspaceId: string, paneId: string): string {
  return `codex-cordis.terminal-tabs:${workspaceId}:${paneId}`
}

function readState(key: string, workingDirectory?: string): TerminalTabsState {
  try {
    const stored = window.localStorage.getItem(key)
    return parseTerminalTabs(stored ? JSON.parse(stored) : undefined, workingDirectory)
  } catch {
    return initialTerminalTabs(workingDirectory)
  }
}

function writeState(key: string, state: TerminalTabsState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // The live terminals remain usable when local storage is unavailable.
  }
}

function TerminalPane({
  workspaceId,
  pane,
  focused,
  visible,
  closePane,
  Terminal,
  Tabs,
  terminals,
}: WorkspacePaneKindProps & {
  Terminal: ComponentType<GhosttyTerminalProps>
  Tabs: ComponentType<PaneTabsProps>
  terminals: ClientGhosttyTerminalService
}): ReactNode {
  const key = storageKey(workspaceId, pane.id)
  const accessories = useSyncExternalStore(terminals.subscribeTabAccessories, terminals.tabAccessories)
  const [state, setState] = useState(() => readState(key))
  const [problem, setProblem] = useState<string>()
  const closing = useRef(false)

  useEffect(() => writeState(key, state), [key, state])

  const create = (): void => {
    setState((current) => {
      const ordinal = current.nextOrdinal
      const tab: TerminalTab = {
        id: `terminal-${ordinal}`,
        title: `Terminal ${ordinal}`,
      }
      return {
        ...current,
        activeId: tab.id,
        nextOrdinal: ordinal + 1,
        tabs: [...current.tabs, tab],
      }
    })
  }

  const close = async (id: string): Promise<void> => {
    if (closing.current || state.tabs.length <= 1 || !state.tabs.some((tab) => tab.id === id)) return
    closing.current = true
    try {
      await terminals.close({ workspaceId, paneId: pane.id, tabId: id })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return
    } finally {
      closing.current = false
    }
    setProblem(undefined)
    setState((current) => {
      if (current.tabs.length <= 1) return current
      const index = current.tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return current
      const tabs = current.tabs.filter((tab) => tab.id !== id)
      return {
        ...current,
        tabs,
        activeId: current.activeId === id
          ? tabs[Math.min(index, tabs.length - 1)]!.id
          : current.activeId,
      }
    })
  }

  return (
    <div className={`${clientStyles.pane} ghostty-workspace-pane`}>
      <div className={`${clientStyles.paneHeader} ghostty-workspace-tabs workspace-local-tabbar`}>
        <Tabs
          tabs={state.tabs.map((tab) => {
            const identity = { workspaceId, paneId: pane.id, tabId: tab.id }
            const selected = tab.id === state.activeId
            return {
              ...tab,
              icon: SquareTerminal,
              ...(accessories.length ? {
                accessory: accessories.map(({ id, renderer: Accessory }) => (
                  <Accessory key={id} identity={identity} selected={selected}
                    focused={focused && selected} visible={visible} />
                )),
              } : {}),
            }
          })}
          activeId={state.activeId}
          label="Terminal tabs"
          createLabel="New terminal tab"
          activate={(id) => setState((current) => ({ ...current, activeId: id }))}
          create={create}
          close={(id) => { void close(id) }}
          {...(closePane ? {
            closeLast: closePane,
            closeLastLabel: 'Close Terminal pane',
          } : {})}
          move={(id, targetId, position) => {
            setState((current) => ({
              ...current,
              tabs: [...movePaneTabs(current.tabs, id, targetId, position)],
            }))
          }}
        />
      </div>
      {problem ? <p className="ghostty-workspace-problem" role="alert">{problem}</p> : null}
      <div className="ghostty-workspace-surfaces">
        {state.tabs.map((tab) => {
          const active = tab.id === state.activeId
          return (
            <div className={`ghostty-workspace-surface${active ? ' is-active' : ''}`} key={tab.id}>
              <Terminal
                identity={{ workspaceId, paneId: pane.id, tabId: tab.id }}
                {...(tab.workingDirectory ? { workingDirectory: tab.workingDirectory } : {})}
                active={visible && active}
                focused={focused && active}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ghosttyWorkspace: BrowserPlugin = (ctx) => {
  const terminals = ctx.clientGhosttyTerminal
  const Terminal = terminals.renderer
  const Tabs = ctx.clientPaneTabs.renderer
  ctx.clientWorkspaceLayout.registerPaneKind(ctx, {
    id: 'ghostty-terminal',
    label: 'Terminal',
    description: 'A native terminal with persistent tabs',
    shortcut: 't',
    icon: SquareTerminal,
    renderer: (props) => <TerminalPane {...props} Terminal={Terminal} Tabs={Tabs} terminals={terminals} />,
  })
  ctx.clientUi.registerStyle(ctx, 'ghostty-workspace', String(styles))
}

ghosttyWorkspace.inject = [
  'clientGhosttyTerminal',
  'clientPaneTabs',
  'clientWorkspaceLayout',
  'clientUi',
]

export default ghosttyWorkspace
