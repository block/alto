import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import {
  ChatNotificationsController,
  completionNotificationTarget,
  openNotificationChat,
} from '../program/plugins/chat-notifications.client.js'
import type {
  ClientConversationService,
  ClientSessionSnapshot,
} from '../program/plugins/session-api.js'
import type {
  ClientThreadStatusService,
  ClientThreadStatusSnapshot,
} from '../program/plugins/thread-status-api.js'
import type { ClientWorkspaceLayoutService } from '../program/plugins/workspace-layout-api.js'
import type { ThreadSummary } from '../src/shared/protocol.js'
import type { AgentTask } from '../program/plugins/orchestrator-api.js'

const completedThread: ThreadSummary = {
  id: 'thread-completed',
  title: 'Completed chat',
  preview: 'Completed chat',
  cwd: '/tmp/project',
  createdAt: 1,
  updatedAt: 2,
  projectId: 'project-1',
}

const parentThread: ThreadSummary = {
  ...completedThread, id: 'parent-chat', title: 'Coordinate the work', cwd: '/tmp/parent-project',
}
const childTask: AgentTask = {
  id: 'review', title: 'Review the change',
  parentThreadId: parentThread.id, parentTitle: parentThread.title,
  threadId: completedThread.id, workspace: completedThread.cwd,
  status: 'done', activity: '', result: 'Looks good', createdAt: 1, updatedAt: 2,
}

const reviewNotification = {
  threadId: completedThread.id,
  title: 'Pull request needs attention',
  body: 'New review feedback is ready.',
  tag: 'alto-pr-watch-example-42',
}

function completionNotificationHarness(options: {
  child?: boolean
  parentInHistory?: boolean
  focusedThreadId?: string
  existingPane?: boolean
  completedInHistory?: boolean
  background?: boolean
  permission?: NotificationPermission
} = {}) {
  let statusSnapshot: ClientThreadStatusSnapshot = {
    revision: 1,
    running: [completedThread.id],
    finished: [],
  }
  let statusListener = (): void => undefined
  const status = {
    snapshot: () => statusSnapshot,
    subscribe: (listener: () => void) => {
      statusListener = listener
      return () => { statusListener = () => undefined }
    },
    acknowledge: vi.fn(),
  } as ClientThreadStatusService
  let session = {
    threadId: options.focusedThreadId ?? 'different-thread',
    threads: [...(options.completedInHistory !== false ? [completedThread] : []), ...(options.parentInHistory !== false ? [parentThread] : [])],
    ...(options.child ? { harness: { extensions: { orchestrator: { revision: 1, tasks: [childTask] } } } } : {}),
  } as unknown as ClientSessionSnapshot
  const refreshHistory = vi.fn(async () => {})
  const conversation = {
    snapshot: () => session,
    refreshHistory,
  } as unknown as ClientConversationService
  const layout = {
    focusThread: vi.fn(() => options.existingPane === true),
    openPane: vi.fn(),
  }
  const notifications: NotificationOptions[] = []
  const instances: FakeNotification[] = []
  const titles: string[] = []
  const storage = new Map<string, string>()

  class FakeNotification {
    static permission: NotificationPermission = options.permission ?? 'granted'
    static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    onclick: (() => void) | null = null

    constructor(title: string, options?: NotificationOptions) {
      notifications.push(options ?? {})
      titles.push(title)
      instances.push(this)
    }

    close = vi.fn(() => this.onclose?.())
  }

  vi.stubGlobal('window', {
    Notification: FakeNotification,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    focus: vi.fn(),
  })
  vi.stubGlobal('document', { visibilityState: options.background ? 'hidden' : 'visible', hasFocus: () => !options.background })

  const controller = new ChatNotificationsController(status, conversation, layout as unknown as ClientWorkspaceLayoutService)
  const dispose = controller.activate()
  return {
    controller,
    start: () => {
      statusSnapshot = {
        revision: statusSnapshot.revision + 1,
        running: [completedThread.id],
        finished: [],
      }
      statusListener()
    },
    complete: () => {
      statusSnapshot = {
        revision: statusSnapshot.revision + 1,
        running: [],
        finished: [completedThread.id],
      }
      statusListener()
    },
    notifications,
    instances,
    titles,
    layout,
    refreshHistory,
    setThreads: (threads: ThreadSummary[]) => { session = { ...session, threads } },
    storedPreference: () => JSON.parse(storage.get('alto.chat-notifications') ?? '{}') as Record<string, unknown>,
    dispose,
  }
}

describe('chat notifications', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('focuses an existing pane for the completed chat', () => {
    const focusThread = vi.fn(() => true)
    const openPane = vi.fn()
    const layout = {
      focusThread,
      openPane,
    } as unknown as ClientWorkspaceLayoutService

    openNotificationChat(completedThread, layout)

    expect(focusThread).toHaveBeenCalledWith(completedThread.id)
    expect(openPane).not.toHaveBeenCalled()
  })

  it('opens an independent pane instead of replacing the focused chat', () => {
    const focusThread = vi.fn(() => false)
    const openPane = vi.fn(() => ({ workspaceId: 'workspace-current', paneId: 'pane-new' }))
    const layout = {
      focusThread,
      openPane,
    } as unknown as ClientWorkspaceLayoutService

    openNotificationChat(completedThread, layout)

    expect(focusThread).toHaveBeenCalledWith(completedThread.id)
    expect(openPane).toHaveBeenCalledWith({
      direction: 'horizontal',
      kind: 'chat',
      thread: completedThread,
      workspace: '/tmp/project',
      projectId: 'project-1',
    })
  })

  it('makes completion notifications silent by default', () => {
    const harness = completionNotificationHarness()

    expect(harness.controller.snapshot().playSound).toBe(false)
    harness.complete()

    expect(harness.notifications).toEqual([
      expect.objectContaining({ silent: true }),
    ])
    harness.dispose()
  })

  it('persists an opt-in to notification sounds', () => {
    const harness = completionNotificationHarness()

    harness.controller.setPlaySound(true)
    harness.complete()

    expect(harness.controller.snapshot().playSound).toBe(true)
    expect(harness.storedPreference()).toMatchObject({ playSound: true })
    expect(harness.notifications).toEqual([
      expect.objectContaining({ silent: false }),
    ])
    harness.dispose()
  })

  it('focuses an existing main chat on a notification click', () => {
    const h = completionNotificationHarness({ existingPane: true })
    h.complete()
    expect(h.titles).toEqual(['Agent finished'])
    expect(h.notifications[0]).toMatchObject({
      body: completedThread.title, tag: 'alto-chat-finished-thread-completed',
    })
    h.instances[0]!.onclick!()
    expect(h.layout.focusThread).toHaveBeenCalledWith(completedThread.id)
    expect(h.layout.openPane).not.toHaveBeenCalled()
    h.dispose()
  })

  it('opens a completed main chat at its own workspace if its pane is closed', () => {
    const h = completionNotificationHarness()
    h.complete()
    h.instances[0]!.onclick!()
    expect(h.layout.openPane).toHaveBeenCalledWith(expect.objectContaining({
      thread: completedThread, workspace: completedThread.cwd, projectId: completedThread.projectId,
    }))
    h.dispose()
  })

  it.each([false, true])('does not notify for subagents when Alto is in the background: %s', (background) => {
    const h = completionNotificationHarness({ child: true, background })
    h.complete()
    expect(h.instances).toHaveLength(0)
    expect(h.refreshHistory).not.toHaveBeenCalled()
    h.dispose()
  })

  it('ignores unknown subagents even without Agents metadata', async () => {
    const h = completionNotificationHarness({ completedInHistory: false })
    h.complete()
    await vi.waitFor(() => expect(h.refreshHistory).toHaveBeenCalled())
    expect(h.instances).toHaveLength(0)
    expect(h.layout.openPane).not.toHaveBeenCalled()
    h.dispose()
  })

  it('notifies for a newly completed main chat after refreshing its history entry', async () => {
    const h = completionNotificationHarness({ completedInHistory: false })
    h.refreshHistory.mockImplementation(async () => { h.setThreads([completedThread]) })
    h.complete()
    await vi.waitFor(() => expect(h.instances).toHaveLength(1))
    expect(h.titles).toEqual(['Agent finished'])
    h.dispose()
  })

  it('keeps subagents silent even with visible-chat notifications and sounds enabled', () => {
    const h = completionNotificationHarness({ child: true, focusedThreadId: parentThread.id })
    h.controller.setNotifyCurrentChat(true)
    h.controller.setPlaySound(true)
    h.complete()
    expect(h.instances).toHaveLength(0)
    h.dispose()
  })

  it('preserves the visible-chat notification preference for main chats', () => {
    const h = completionNotificationHarness({ focusedThreadId: completedThread.id })
    h.complete()
    expect(h.instances).toHaveLength(0)
    h.dispose()
    const optedIn = completionNotificationHarness({ focusedThreadId: completedThread.id })
    optedIn.controller.setNotifyCurrentChat(true)
    optedIn.complete()
    expect(optedIn.instances).toHaveLength(1)
    optedIn.dispose()
  })

  it('does not navigate from a stale notification after the plugin unloads', () => {
    const h = completionNotificationHarness()
    h.complete()
    h.dispose()
    h.instances[0]!.onclick!()
    expect(h.layout.focusThread).not.toHaveBeenCalled()
    expect(h.layout.openPane).not.toHaveBeenCalled()
  })

  it('shows explicit feedback during an active turn and opens its exact chat', async () => {
    const h = completionNotificationHarness({ existingPane: true })
    h.controller.setPlaySound(true)

    await h.controller.notify(reviewNotification)

    expect(h.titles).toEqual([reviewNotification.title])
    expect(h.notifications).toEqual([{
      body: reviewNotification.body, tag: reviewNotification.tag, silent: false,
    }])
    expect(h.layout.focusThread).not.toHaveBeenCalled()
    h.instances[0]!.onclick!()
    expect(h.layout.focusThread).toHaveBeenCalledWith(completedThread.id)
    expect(h.layout.openPane).not.toHaveBeenCalled()
    h.dispose()
  })

  it('opens an explicitly notified chat at its own workspace when its pane is closed', async () => {
    const h = completionNotificationHarness()
    await h.controller.notify(reviewNotification)
    h.instances[0]!.onclick!()

    expect(h.layout.openPane).toHaveBeenCalledWith(expect.objectContaining({
      thread: completedThread, workspace: completedThread.cwd, projectId: completedThread.projectId,
    }))
    h.dispose()
  })

  it('can route an explicit notification to an existing pane before history contains it', async () => {
    const h = completionNotificationHarness({ existingPane: true, completedInHistory: false })
    await h.controller.notify(reviewNotification)
    h.instances[0]!.onclick!()

    expect(h.layout.focusThread).toHaveBeenCalledWith(completedThread.id)
    expect(h.layout.openPane).not.toHaveBeenCalled()
    expect(h.refreshHistory).not.toHaveBeenCalled()
    h.dispose()
  })

  it('uses the visible-chat preference for explicit notifications', async () => {
    const h = completionNotificationHarness({ focusedThreadId: completedThread.id })
    await h.controller.notify(reviewNotification)
    expect(h.instances).toHaveLength(0)

    h.controller.setNotifyCurrentChat(true)
    await h.controller.notify(reviewNotification)
    expect(h.notifications).toEqual([
      expect.objectContaining({ tag: reviewNotification.tag, silent: true }),
    ])
    h.dispose()
  })

  it.each(['denied', 'default'] as const)('does not bypass notification permission: %s', async (permission) => {
    const h = completionNotificationHarness({ permission })
    await h.controller.notify(reviewNotification)

    expect(h.instances).toHaveLength(0)
    h.dispose()
  })

  it('does not bypass disabled notifications', async () => {
    const h = completionNotificationHarness()
    await h.controller.setEnabled(false)
    await h.controller.notify(reviewNotification)

    expect(h.instances).toHaveLength(0)
    h.dispose()
  })

  it('suppresses automatic completions without suppressing explicit watcher feedback', async () => {
    const h = completionNotificationHarness()
    const context = new Context()
    const watcher = await context.plugin((owner) => {
      h.controller.suppressCompletion(owner, completedThread.id)
    })
    try {
      await h.controller.notify(reviewNotification)
      h.complete()

      expect(h.titles).toEqual([reviewNotification.title])
    } finally {
      await watcher.dispose()
      h.dispose()
    }
  })

  it('retains suppression until every owner releases it and restores completions on unload', async () => {
    const h = completionNotificationHarness()
    const context = new Context()
    let releaseFirst = (): void => undefined
    const first = await context.plugin((owner) => {
      releaseFirst = h.controller.suppressCompletion(owner, completedThread.id)
    })
    const second = await context.plugin((owner) => {
      h.controller.suppressCompletion(owner, completedThread.id)
    })
    try {
      releaseFirst()
      releaseFirst()
      h.complete()
      expect(h.instances).toHaveLength(0)

      await second.dispose()
      h.start()
      h.complete()
      expect(h.titles).toEqual(['Agent finished'])
    } finally {
      await first.dispose()
      await second.dispose()
      h.dispose()
    }
  })

  it('limits a completion suppression to the requested thread', async () => {
    const h = completionNotificationHarness()
    const context = new Context()
    const watcher = await context.plugin((owner) => {
      h.controller.suppressCompletion(owner, parentThread.id)
    })
    try {
      h.complete()
      expect(h.titles).toEqual(['Agent finished'])
    } finally {
      await watcher.dispose()
      h.dispose()
    }
  })

  it('rechecks suppression after an in-flight history refresh', async () => {
    const h = completionNotificationHarness({ completedInHistory: false })
    let finishRefresh = (): void => undefined
    h.refreshHistory.mockImplementation(() => new Promise<void>((resolve) => { finishRefresh = resolve }))
    h.complete()
    expect(h.refreshHistory).toHaveBeenCalled()

    const context = new Context()
    const watcher = await context.plugin((owner) => {
      h.controller.suppressCompletion(owner, completedThread.id)
    })
    try {
      h.setThreads([completedThread])
      finishRefresh()
      await Promise.resolve()
      expect(h.instances).toHaveLength(0)

      await watcher.dispose()
      h.start()
      h.complete()
      expect(h.titles).toEqual(['Agent finished'])
    } finally {
      await watcher.dispose()
      h.dispose()
    }
  })

  it('closes explicit notifications and ignores stale clicks when the service unloads', async () => {
    const h = completionNotificationHarness({ existingPane: true })
    await h.controller.notify(reviewNotification)

    h.dispose()
    await h.controller.notify(reviewNotification)
    h.instances[0]!.onclick!()

    expect(h.instances).toHaveLength(1)
    expect(h.instances[0]!.close).toHaveBeenCalled()
    expect(h.layout.focusThread).not.toHaveBeenCalled()
    expect(h.layout.openPane).not.toHaveBeenCalled()
  })

  it.each(['done', 'failed', 'stopped'] as const)('does not create notification targets for %s subagents', (status) => {
    const session = {
      threads: [parentThread],
      harness: { extensions: { orchestrator: { revision: 1, tasks: [{ ...childTask, status }] } } },
    } as unknown as ClientSessionSnapshot
    expect(completionNotificationTarget(completedThread.id, session)).toBeUndefined()
  })
})
