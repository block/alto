import {
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import type {
  BrowserPlugin,
} from '../../src/client/plugin-api.js'
import type { ThreadSummary } from '../../src/shared/protocol.js'
import type {
  ClientConversationService,
  ClientSessionSnapshot,
} from './session-api.js'
import type { ClientWorkspaceLayoutService } from './workspace-layout-api.js'
import type {
  ClientThreadStatusService,
  ClientThreadStatusSnapshot,
} from './thread-status-api.js'
import { ORCHESTRATOR_STATE, type OrchestratorSnapshot } from './orchestrator-api.js'
import styles from './chat-notifications.css'
import { SettingsRow, SettingsSwitch } from './ui/settings.js'

interface ChatNotificationsConfig {
  enabledByDefault?: boolean
  notifyCurrentChat?: boolean
  playSoundByDefault?: boolean
}

interface NotificationPreference {
  version: 1
  enabled: boolean
  notifyCurrentChat: boolean
  playSound: boolean
}

type DesktopPermission = NotificationPermission | 'unsupported'

interface ChatNotificationsSnapshot {
  revision: number
  supported: boolean
  permission: DesktopPermission
  enabled: boolean
  notifyCurrentChat: boolean
  playSound: boolean
  requestingPermission: boolean
  pending: readonly CompletionNotificationTarget[]
  problem?: string
}

interface CompletionNotificationTarget {
  threadId: string
  thread: ThreadSummary
  title: string
  body: string
}

const STORAGE_KEY = 'alto.chat-notifications'

function notificationPermission(): DesktopPermission {
  return typeof window.Notification === 'undefined'
    ? 'unsupported'
    : window.Notification.permission
}

function notificationPreference(config: ChatNotificationsConfig): NotificationPreference {
  const fallback: NotificationPreference = {
    version: 1,
    enabled: config.enabledByDefault !== false,
    notifyCurrentChat: config.notifyCurrentChat === true,
    playSound: config.playSoundByDefault === true,
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<NotificationPreference> | null
    if (stored?.version !== 1) return fallback
    return {
      version: 1,
      enabled: typeof stored.enabled === 'boolean' ? stored.enabled : fallback.enabled,
      notifyCurrentChat: typeof stored.notifyCurrentChat === 'boolean'
        ? stored.notifyCurrentChat
        : fallback.notifyCurrentChat,
      playSound: typeof stored.playSound === 'boolean'
        ? stored.playSound
        : fallback.playSound,
    }
  } catch {
    return fallback
  }
}

function visibleAndFocused(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

export function openNotificationChat(
  thread: ThreadSummary,
  layout: ClientWorkspaceLayoutService,
): void {
  if (layout.focusThread(thread.id)) return

  layout.openPane({
    direction: 'horizontal',
    kind: 'chat',
    thread,
    workspace: thread.cwd,
    ...(thread.projectId ? { projectId: thread.projectId } : {}),
  })
}

function isSubagentThread(threadId: string, session: ClientSessionSnapshot): boolean {
  const agents = session.harness?.extensions[ORCHESTRATOR_STATE] as unknown as OrchestratorSnapshot | undefined
  return agents?.tasks.some((task) => task.threadId === threadId) === true
}

export function completionNotificationTarget(threadId: string, session: ClientSessionSnapshot): CompletionNotificationTarget | undefined {
  if (isSubagentThread(threadId, session)) return undefined
  // Recent chat history excludes native subagents, even if the Agents plugin
  // is disabled or has not received the child's metadata yet.
  const thread = session.threads.find((candidate) => candidate.id === threadId)
  if (!thread) return undefined
  return {
    threadId,
    thread,
    title: 'Agent finished',
    body: thread.title.trim() || 'A chat is ready to review.',
  }
}

export class ChatNotificationsController {
  private readonly listeners = new Set<() => void>()
  private readonly notifications = new Set<Notification>()
  private preference: NotificationPreference
  private previousStatus: ClientThreadStatusSnapshot
  private state: ChatNotificationsSnapshot
  private disposeStatus: (() => void) | undefined
  private revision = 0
  private active = false
  private requestEpoch = 0
  private pending: CompletionNotificationTarget[] = []
  private dismissTimer: number | undefined
  private bannerPaused = false

  private readonly refreshPermission = (): void => {
    this.emit()
  }

  constructor(
    private readonly status: ClientThreadStatusService,
    private readonly conversation: ClientConversationService,
    private readonly layout: ClientWorkspaceLayoutService,
    config: ChatNotificationsConfig = {},
  ) {
    this.preference = notificationPreference(config)
    this.previousStatus = status.snapshot()
    this.state = this.buildSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): ChatNotificationsSnapshot => this.state

  activate(): () => void {
    this.active = true
    this.previousStatus = this.status.snapshot()
    this.disposeStatus = this.status.subscribe(() => this.statusChanged())
    window.addEventListener('focus', this.refreshPermission)
    this.emit()
    return () => {
      this.active = false
      this.requestEpoch += 1
      this.disposeStatus?.()
      this.disposeStatus = undefined
      window.removeEventListener('focus', this.refreshPermission)
      for (const notification of this.notifications) notification.close()
      this.notifications.clear()
      this.clearPending()
      this.listeners.clear()
      this.state = this.buildSnapshot()
    }
  }

  dismiss(threadId: string): void {
    const current = this.pending[0]?.threadId
    this.pending = this.pending.filter((target) => target.threadId !== threadId)
    if (!this.pending.length) this.bannerPaused = false
    if (current === threadId) this.scheduleDismiss()
    this.emit()
  }

  open(threadId: string): void {
    if (!this.active) return
    const target = this.pending.find((candidate) => candidate.threadId === threadId)
    if (!target) return
    this.dismiss(threadId)
    void this.openThread(target.threadId, target.thread)
  }

  setBannerPaused(paused: boolean): void {
    if (this.bannerPaused === paused) return
    this.bannerPaused = paused
    this.scheduleDismiss()
  }

  private scheduleDismiss(): void {
    if (this.dismissTimer !== undefined) window.clearTimeout(this.dismissTimer)
    this.dismissTimer = undefined
    const target = this.pending[0]
    if (!this.active || this.bannerPaused || !target) return
    this.dismissTimer = window.setTimeout(() => this.dismiss(target.threadId), 12_000)
  }

  private clearPending(): void {
    this.pending = []
    this.bannerPaused = false
    if (this.dismissTimer !== undefined) window.clearTimeout(this.dismissTimer)
    this.dismissTimer = undefined
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.preference = { ...this.preference, enabled }
    if (!enabled) this.clearPending()
    this.writePreference()
    this.emit()
    if (!enabled || notificationPermission() !== 'default') return

    const epoch = ++this.requestEpoch
    this.state = this.buildSnapshot(true)
    this.notifyListeners()
    try {
      await window.Notification.requestPermission()
      if (!this.active || epoch !== this.requestEpoch) return
      this.emit()
    } catch (error) {
      if (!this.active || epoch !== this.requestEpoch) return
      this.emit(error instanceof Error ? error.message : String(error))
    }
  }

  setNotifyCurrentChat(enabled: boolean): void {
    if (this.preference.notifyCurrentChat === enabled) return
    this.preference = { ...this.preference, notifyCurrentChat: enabled }
    this.writePreference()
    this.emit()
  }

  setPlaySound(enabled: boolean): void {
    if (this.preference.playSound === enabled) return
    this.preference = { ...this.preference, playSound: enabled }
    this.writePreference()
    this.emit()
  }

  private statusChanged(): void {
    const next = this.status.snapshot()
    const previousRunning = new Set(this.previousStatus.running)
    const previousFinished = new Set(this.previousStatus.finished)
    const completed = next.finished.filter((threadId) => (
      previousRunning.has(threadId) && !previousFinished.has(threadId)
    ))
    this.previousStatus = next
    for (const threadId of completed) void this.showCompletion(threadId)
  }

  private async showCompletion(threadId: string): Promise<void> {
    if (!this.active || !this.state.enabled || notificationPermission() !== 'granted') return

    let session = this.conversation.snapshot()
    if (isSubagentThread(threadId, session)) return
    if (!session.threads.some((thread) => thread.id === threadId)) {
      // A new main chat may finish before its history entry arrives. Resolve
      // that entry instead of treating an unknown thread as a main chat.
      try {
        await this.conversation.refreshHistory()
      } catch {
        return
      }
      if (!this.active || !this.state.enabled || notificationPermission() !== 'granted') return
      session = this.conversation.snapshot()
    }
    const target = completionNotificationTarget(threadId, session)
    if (!target) return
    if (
      !this.preference.notifyCurrentChat
      && threadId === session.threadId
      && visibleAndFocused()
    ) return

    // Electron's macOS foreground banners can dismiss without delivering a
    // click (electron/electron#51885). Keep foreground navigation inside Alto.
    if (visibleAndFocused()) {
      const current = this.pending[0]?.threadId
      const existing = this.pending.some((entry) => entry.threadId === threadId)
      this.pending = existing
        ? this.pending.map((entry) => entry.threadId === threadId ? target : entry)
        : [...this.pending, target].slice(-10)
      if (current !== this.pending[0]?.threadId || current === threadId) this.scheduleDismiss()
      this.emit()
      return
    }

    let notification: Notification
    try {
      notification = new window.Notification(target.title, {
        body: target.body,
        tag: `alto-chat-finished-${target.threadId}`,
        silent: !this.preference.playSound,
      })
    } catch (error) {
      this.emit(error instanceof Error ? error.message : String(error))
      return
    }

    this.notifications.add(notification)
    notification.onclose = () => this.notifications.delete(notification)
    notification.onerror = () => {
      this.notifications.delete(notification)
      this.emit('Alto could not show the desktop notification.')
    }
    notification.onclick = () => {
      notification.close()
      window.focus()
      void this.openThread(target.threadId, target.thread)
    }
  }

  private async openThread(threadId: string, known?: ThreadSummary): Promise<void> {
    if (!this.active) return
    // Focus an existing pane before looking up its history entry.
    try {
      if (this.layout.focusThread(threadId)) return
    } catch {
      return
    }
    let thread = known
      ?? this.conversation.snapshot().threads.find((candidate) => candidate.id === threadId)
    if (!thread) {
      try {
        await this.conversation.refreshHistory()
      } catch {
        return
      }
      if (!this.active) return
      thread = this.conversation.snapshot().threads.find((candidate) => candidate.id === threadId)
    }
    if (!thread || !this.active) return
    try {
      openNotificationChat(thread, this.layout)
    } catch {
      // The notification remains useful if the chat or its workspace disappeared before the click.
    }
  }

  private writePreference(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preference))
    } catch {
      // The preference remains active for this window when storage is unavailable.
    }
  }

  private emit(problem?: string): void {
    this.revision += 1
    this.state = this.buildSnapshot(false, problem)
    this.notifyListeners()
  }

  private buildSnapshot(
    requestingPermission = false,
    problem?: string,
  ): ChatNotificationsSnapshot {
    const permission = notificationPermission()
    return {
      revision: this.revision,
      supported: permission !== 'unsupported',
      permission,
      enabled: this.preference.enabled && permission === 'granted',
      notifyCurrentChat: this.preference.notifyCurrentChat,
      playSound: this.preference.playSound,
      requestingPermission,
      pending: this.pending,
      ...(problem ? { problem } : {}),
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener()
  }
}

export function ChatNotificationBanner({ controller }: { controller: ChatNotificationsController }): ReactNode {
  const { pending } = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const target = pending[0]
  if (!target) return null
  return createPortal(
    <section className="chat-notification-banner" aria-label="Chat notifications" aria-live="polite" aria-atomic="true"
      onPointerEnter={() => controller.setBannerPaused(true)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) controller.setBannerPaused(false)
      }}
      onFocusCapture={() => controller.setBannerPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) controller.setBannerPaused(false)
      }}>
      <button type="button" className="chat-notification-open" aria-label={`Open ${target.body}`} title={target.body}
        onClick={() => controller.open(target.threadId)}>
        <span className="chat-notification-check"><Check size={14} aria-hidden="true" /></span>
        <span className="chat-notification-title">{target.body}</span>
        <span className="chat-notification-status">Finished</span>
        {pending.length > 1 && <span className="chat-notification-count" title={`${pending.length - 1} more finished chats`}>+{pending.length - 1}</span>}
      </button>
      <button type="button" className="chat-notification-dismiss" aria-label="Dismiss notification" title="Dismiss"
        onClick={() => controller.dismiss(target.threadId)}><X size={14} aria-hidden="true" /></button>
    </section>,
    document.querySelector('.shell-kernel') ?? document.body,
  )
}

function permissionCopy(state: ChatNotificationsSnapshot): string {
  if (!state.supported) return 'Desktop notifications are unavailable in this build.'
  if (state.problem) return state.problem
  if (state.permission === 'denied') {
    return 'macOS is blocking Alto notifications. Allow them in System Settings to turn this on.'
  }
  if (state.permission === 'default') {
    return 'Turn this on to let Alto request notification permission.'
  }
  return state.enabled
    ? 'Alto will notify you when a background chat finishes.'
    : 'Completion notifications are off.'
}

function NotificationsSettings({
  controller,
}: {
  controller: ChatNotificationsController
}): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const enabling = !state.enabled

  return (
    <section className="settings-section chat-notifications-settings">
      <h2>Notifications</h2>
      <div className="settings-card chat-notifications-card">
        <SettingsRow
          className="chat-notifications-row"
          label="Desktop notifications"
          description={permissionCopy(state)}
          disabled={!state.supported || state.requestingPermission}
          checked={state.enabled}
          onClick={() => void controller.setEnabled(enabling)}
        >
          <SettingsSwitch on={state.enabled} />
        </SettingsRow>
        <SettingsRow
          className="chat-notifications-row"
          label="Notification sounds"
          description="Play a sound when Alto shows a completion notification."
          disabled={!state.supported}
          checked={state.playSound}
          onClick={() => controller.setPlaySound(!state.playSound)}
        >
          <SettingsSwitch on={state.playSound} />
        </SettingsRow>
        <SettingsRow
          className="chat-notifications-row"
          label="Notify for the visible chat"
          description="Also alert when the completed chat is already open and Alto is focused."
          disabled={!state.supported}
          checked={state.notifyCurrentChat}
          onClick={() => controller.setNotifyCurrentChat(!state.notifyCurrentChat)}
        >
          <SettingsSwitch on={state.notifyCurrentChat} />
        </SettingsRow>
      </div>
    </section>
  )
}

const chatNotificationsClient: BrowserPlugin<ChatNotificationsConfig> = (ctx, config) => {
  const controller = new ChatNotificationsController(
    ctx.clientThreadStatus,
    ctx.clientConversation,
    ctx.clientWorkspaceLayout,
    config,
  )
  const Settings = () => <NotificationsSettings controller={controller} />

  ctx.effect(() => controller.activate(), 'chat-notifications.activate')
  ctx.clientUi.registerRoot(ctx, 'chat-notifications', () => <ChatNotificationBanner controller={controller} />)
  ctx.clientUi.registerStyle(ctx, 'chat-notifications', String(styles))
  ctx.clientUi.registerSettingsPage(ctx, {
    id: 'chat-notifications',
    label: 'Notifications',
    placement: 'general',
    keywords: ['notifications', 'desktop', 'agent', 'finished', 'complete', 'background', 'sound', 'silent'],
    order: 20,
    renderer: Settings,
  })
}

chatNotificationsClient.inject = [
  'clientConversation',
  'clientThreadStatus',
  'clientUi',
  'clientWorkspaceLayout',
]

export default chatNotificationsClient
