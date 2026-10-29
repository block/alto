import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { clientStyles, type BrowserPlugin } from '../../src/client/plugin-api.js'
import type { ClientVerticalTabsService, VerticalTabPreferences } from './vertical-tabs-api.js'
import {
  WORKSPACE_TOOLS_RAIL_ATTRIBUTE,
  type WorkspaceTabAddonRegistration,
  type WorkspaceTabOrientation,
  type WorkspaceTabRailProps,
} from './workspace-layout-api.js'
import styles from './vertical-tabs.css'

const STORAGE_KEY = 'codex-cordis.vertical-tabs'
const DEFAULT_WIDTH = 232
const MIN_WIDTH = 168
const MAX_WIDTH = 400
/** Below this workspace width the rail shows only tab icons. */
const COMPACT_WORKSPACE_WIDTH = 720

export function clampRailWidth(width: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)))
}

export function parseVerticalTabPreferences(value: unknown): VerticalTabPreferences {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    // Enabling the plugin opts into the side rail, so vertical is the default.
    orientation: record.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    width: typeof record.width === 'number' && Number.isFinite(record.width) ? clampRailWidth(record.width) : DEFAULT_WIDTH,
    collapsed: record.collapsed === true,
  }
}

function readPreferences(): VerticalTabPreferences {
  try {
    return parseVerticalTabPreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return parseVerticalTabPreferences(undefined)
  }
}

function writePreferences(preferences: VerticalTabPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage can be unavailable; the rail still works for this session.
  }
}

/** Keeps the rail's width and collapsed state outside React so shortcuts can change them. */
export class VerticalTabsController implements ClientVerticalTabsService {
  private state = readPreferences()
  private readonly listeners = new Set<() => void>()
  private persistence = true

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): VerticalTabPreferences => this.state

  setOrientation(orientation: WorkspaceTabOrientation): void {
    this.update({ orientation })
  }

  toggleOrientation(): void {
    this.update({ orientation: this.state.orientation === 'vertical' ? 'horizontal' : 'vertical' })
  }

  setWidth(width: number): void {
    this.update({ width: clampRailWidth(width) })
  }

  setCollapsed(collapsed: boolean): void {
    this.update({ collapsed })
  }

  toggleCollapsed(): void {
    this.update({ collapsed: !this.state.collapsed })
  }

  /** Save once a drag finishes rather than on every pointer move. */
  holdPersistence(hold: boolean): void {
    this.persistence = !hold
    if (!hold) writePreferences(this.state)
  }

  private update(patch: Partial<VerticalTabPreferences>): void {
    const next = { ...this.state, ...patch }
    if (next.orientation === this.state.orientation && next.width === this.state.width && next.collapsed === this.state.collapsed) return
    this.state = next
    if (this.persistence) writePreferences(next)
    for (const listener of this.listeners) listener()
  }
}

function VerticalTabRail({ strip, navigation, tools, controller }: WorkspaceTabRailProps & { controller: VerticalTabsController }): ReactNode {
  const rail = useRef<HTMLElement>(null)
  const preferences = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const [compact, setCompact] = useState(false)
  const [resizing, setResizing] = useState(false)

  // Follow the workspace's own width so a pinned sidebar or split window also compacts the rail.
  useLayoutEffect(() => {
    const container = rail.current?.parentElement
    if (!container) return
    const measure = (): void => setCompact(container.getBoundingClientRect().width < COMPACT_WORKSPACE_WIDTH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // The width changes continuously while dragging, so it is a custom property rather than a class.
  useLayoutEffect(() => {
    rail.current?.style.setProperty('--vertical-tab-rail-width', preferences.width + 'px')
  }, [preferences.width])

  // Tool flyouts open beside the rail while it hosts the top bar's tools.
  useEffect(() => {
    const element = rail.current
    if (!element) return
    const root = document.documentElement
    root.setAttribute(WORKSPACE_TOOLS_RAIL_ATTRIBUTE, 'rail')
    const measure = (): void => root.style.setProperty('--workspace-tools-rail-end', Math.round(element.getBoundingClientRect().right) + 'px')
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      root.removeAttribute(WORKSPACE_TOOLS_RAIL_ATTRIBUTE)
      root.style.removeProperty('--workspace-tools-rail-end')
    }
  }, [])

  const collapsed = compact || preferences.collapsed
  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const left = rail.current?.getBoundingClientRect().left ?? 0
    handle.setPointerCapture(event.pointerId)
    setResizing(true)
    controller.holdPersistence(true)
    const move = (moveEvent: globalThis.PointerEvent): void => controller.setWidth(moveEvent.clientX - left)
    const end = (): void => {
      setResizing(false)
      controller.holdPersistence(false)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const resizeWithKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 48 : 16
    const width = event.key === 'ArrowLeft' ? preferences.width - step
      : event.key === 'ArrowRight' ? preferences.width + step
      : event.key === 'Home' ? MIN_WIDTH
      : event.key === 'End' ? MAX_WIDTH
      : undefined
    if (width === undefined) return
    event.preventDefault()
    controller.setWidth(width)
  }

  return (
    <aside
      ref={rail}
      className={'vertical-tab-rail' + (collapsed ? ' is-collapsed' : '') + (resizing ? ' is-resizing' : '')}
      aria-label="Tabs"
    >
      <div className="vertical-tab-rail-header">{navigation}</div>
      {strip}
      <div className="vertical-tab-rail-footer">
        {tools}
        {!compact && (
          <button
            type="button"
            className={clientStyles.iconButton + ' vertical-tab-rail-toggle'}
            data-hotkey-action="panel.vertical-tabs.toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand tabs' : 'Collapse tabs'}
            title={collapsed ? 'Expand tabs' : 'Collapse tabs'}
            onClick={() => controller.toggleCollapsed()}
          >
            {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.7} /> : <PanelLeftClose size={15} strokeWidth={1.7} />}
          </button>
        )}
      </div>
      {!collapsed && (
        <div
          className="vertical-tab-rail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tabs"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={preferences.width}
          tabIndex={0}
          onPointerDown={beginResize}
          onDoubleClick={() => controller.setWidth(DEFAULT_WIDTH)}
          onKeyDown={resizeWithKeys}
        />
      )}
    </aside>
  )
}

const verticalTabs: BrowserPlugin = (ctx) => {
  const controller = new VerticalTabsController()
  ctx.provide('clientVerticalTabs', controller)
  const Rail = (props: WorkspaceTabRailProps): ReactNode => <VerticalTabRail {...props} controller={controller} />
  // The rail is registered only while vertical; the compositor restores the top
  // bar when it is removed, and panes stay mounted either way.
  ctx.effect(() => {
    let registration: WorkspaceTabAddonRegistration | undefined
    const sync = (): void => {
      const vertical = controller.snapshot().orientation === 'vertical'
      if (vertical && !registration) {
        registration = ctx.clientWorkspaceLayout.registerTabRail(ctx, { id: 'vertical-tabs', renderer: Rail })
      } else if (!vertical && registration) {
        void registration.dispose()
        registration = undefined
      }
    }
    sync()
    const unsubscribe = controller.subscribe(sync)
    return () => {
      unsubscribe()
      void registration?.dispose()
    }
  }, 'vertical-tabs.orientation')
  ctx.clientUi.registerStyle(ctx, 'vertical-tabs', String(styles))
}

verticalTabs.inject = ['clientWorkspaceLayout', 'clientUi']
verticalTabs.provide = 'clientVerticalTabs'
export default verticalTabs
