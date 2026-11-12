import { renderToStaticMarkup } from 'react-dom/server'
import { Context, type Plugin } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import type {
  ClientHostService,
  ClientHostSnapshot,
} from '../src/client/plugin-api.js'
import type { HarnessEvent, ThreadSummary } from '../src/shared/protocol.js'
import type {
  ClientSessionService,
  ClientSessionSnapshot,
} from '../program/plugins/session-api.js'
import { ThreadStatusService } from '../program/plugins/thread-status.client.js'
import {
  aggregateBlockedKind,
  aggregateThreadWorkStatus,
  OptionalThreadStatusService,
  threadWorkStatus,
  threadWorkStatusCounts,
  type ClientThreadStatusService,
} from '../program/plugins/thread-status-api.js'
import type { HarnessSnapshot, PendingServerRequest } from '../src/shared/protocol.js'
import { HistoryPanel } from '../program/plugins/ui/history.js'
import { ThreadStatusIndicator } from '../program/plugins/ui/thread-status.js'

function installBrowserGlobals(): () => void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const values = new Map<string, string>()
  const browserWindow = new EventTarget() as EventTarget & {
    localStorage: Pick<Storage, 'getItem' | 'setItem'>
    setTimeout: typeof window.setTimeout
    clearTimeout: typeof window.clearTimeout
  }
  browserWindow.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  browserWindow.setTimeout = globalThis.setTimeout as unknown as typeof window.setTimeout
  browserWindow.clearTimeout = globalThis.clearTimeout as unknown as typeof window.clearTimeout
  const browserDocument = new EventTarget()
  Object.defineProperty(browserDocument, 'visibilityState', { value: 'visible' })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument })
  return () => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as { window?: Window }).window
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete (globalThis as { document?: Document }).document
  }
}

function sessionSnapshot(threadId = 'thread-a'): ClientSessionSnapshot {
  return {
    revision: 0,
    connected: true,
    session: { workspace: '/tmp/project', permissionMode: 'ask' },
    turn: { tag: 'idle' },
    threadId,
    agentStatus: { state: 'idle', label: 'Ready' },
    activities: [],
    hasEarlierActivities: false,
    loadingEarlierActivities: false,
    history: { tag: 'ready', entries: [] },
    threads: [],
    projects: [],
    skills: [],
  }
}

describe('chat status', () => {
  it('restores unacknowledged completions newest first rather than sorting by chat ID', () => {
    const restore = installBrowserGlobals()
    const now = Date.now()
    window.localStorage.setItem('codex-cordis.thread-status', JSON.stringify({
      version: 1, finished: [['a-old', now - 2000], ['z-new', now - 1000]],
    }))
    const host = {
      snapshot: () => ({ snapshot: { codex: { activeThreadIds: [] } } }),
      journal: () => [], onEvent: () => () => {},
    } as unknown as ClientHostService
    const session = { snapshot: () => sessionSnapshot(), subscribe: () => () => {} } as unknown as ClientSessionService
    const service = new ThreadStatusService(host, session)
    try {
      expect(service.snapshot().finished).toEqual(['z-new', 'a-old'])
      service.acknowledge('z-new')
      expect(service.snapshot().finished).toEqual(['a-old'])
    } finally { service.dispose(); restore() }
  })

  it('tracks per-thread work and acknowledges a completed chat when it is opened', () => {
    const restore = installBrowserGlobals()
    let hostListener = (_event: HarnessEvent): void => undefined
    let sessionListener = (): void => undefined
    let currentSession = sessionSnapshot()
    const host = {
      snapshot: () => ({
        revision: 0,
        connection: 'online',
        connected: true,
        snapshot: {
          codex: { activeThreadIds: [] },
        },
      } as unknown as ClientHostSnapshot),
      journal: () => [],
      onEvent: (listener: (event: HarnessEvent) => void) => {
        hostListener = listener
        return () => undefined
      },
    } as unknown as ClientHostService
    const session = {
      snapshot: () => currentSession,
      subscribe: (listener: () => void) => {
        sessionListener = listener
        return () => undefined
      },
    } as unknown as ClientSessionService
    const service = new ThreadStatusService(host, session)

    try {
      hostListener({
        type: 'codex.notification',
        payload: { method: 'turn/started', params: { threadId: 'thread-b' } },
      })
      expect(threadWorkStatus(service.snapshot(), 'thread-b')).toBe('running')

      hostListener({
        type: 'codex.status',
        payload: { status: 'ready', models: [], activeThreadIds: [] },
      })
      expect(threadWorkStatus(service.snapshot(), 'thread-b')).toBe('finished')

      currentSession = sessionSnapshot('thread-b')
      sessionListener()
      expect(threadWorkStatus(service.snapshot(), 'thread-b')).toBeUndefined()
    } finally {
      service.dispose()
      restore()
    }
  })

  it('uses the same compact indicator for running and completed work', () => {
    const running = renderToStaticMarkup(<ThreadStatusIndicator status="running" />)
    const finished = renderToStaticMarkup(<ThreadStatusIndicator status="finished" />)
    expect(running).toContain('data-thread-status="running"')
    expect(running).toContain('aria-label="Working"')
    expect(running).toContain('lucide-loader-circle')
    expect(finished).toContain('data-thread-status="finished"')
    expect(finished).toContain('aria-label="Recently finished"')
  })

  it('prioritizes running work when a workspace tab contains several chats', () => {
    const status = {
      revision: 1,
      running: ['thread-running'],
      finished: ['thread-finished'],
    }

    expect(aggregateThreadWorkStatus(status, ['thread-finished'])).toBe('finished')
    expect(aggregateThreadWorkStatus(status, ['thread-finished', 'thread-running']))
      .toBe('running')
    expect(aggregateThreadWorkStatus(status, ['thread-idle'])).toBeUndefined()
  })

  it('counts distinct chats in a group and keeps working chats out of the unread count', () => {
    const status = {
      revision: 1,
      running: ['thread-working', 'thread-working', 'unrelated-working'],
      finished: ['thread-unread-a', 'thread-unread-b', 'thread-working', 'unrelated-unread'],
    }

    expect(threadWorkStatusCounts(status, [
      'thread-unread-a', 'thread-unread-a', 'thread-working', 'thread-unread-b', 'thread-idle',
    ])).toEqual({ running: 1, blocked: 0, finished: 2, failed: 0 })
    expect(threadWorkStatusCounts(status, ['thread-working'])).toEqual({ running: 1, blocked: 0, finished: 0, failed: 0 })
    expect(threadWorkStatusCounts(status, ['thread-unread-b'])).toEqual({ running: 0, blocked: 0, finished: 1, failed: 0 })
  })

  it('does not count statuses belonging to chats outside a group', () => {
    const status = { revision: 1, running: ['elsewhere-working'], finished: ['elsewhere-unread'] }
    expect(threadWorkStatusCounts(status, ['thread-idle'])).toEqual({ running: 0, blocked: 0, finished: 0, failed: 0 })
    expect(threadWorkStatusCounts(status, [])).toEqual({ running: 0, blocked: 0, finished: 0, failed: 0 })
  })

  it('keeps status lookups consistent across completion and acknowledgment snapshots', () => {
    const running = { revision: 1, running: ['thread-a'], finished: [] }
    const finished = { revision: 2, running: [], finished: ['thread-a'] }
    const acknowledged = { revision: 3, running: [], finished: [] }
    for (const [snapshot, expected] of [[running, 'running'], [finished, 'finished'], [acknowledged, undefined]] as const) {
      expect(threadWorkStatus(snapshot, 'thread-a')).toBe(expected)
      expect(aggregateThreadWorkStatus(snapshot, ['thread-a'])).toBe(expected)
      expect(threadWorkStatusCounts(snapshot, ['thread-a', 'thread-a'])).toEqual({
        running: expected === 'running' ? 1 : 0,
        blocked: 0,
        finished: expected === 'finished' ? 1 : 0,
        failed: 0,
      })
    }
    expect(threadWorkStatus(running, 'thread-a')).toBe('running')
    expect(threadWorkStatus(finished, 'thread-a')).toBe('finished')
  })

  it('hides work status for the selected chat in the sidebar', () => {
    const entries: ThreadSummary[] = [
      {
        id: 'thread-a',
        title: 'Selected chat',
        preview: '',
        cwd: '/tmp/project',
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 'thread-b',
        title: 'Other chat',
        preview: '',
        cwd: '/tmp/project',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const statusQueries: string[] = []
    const html = renderToStaticMarkup(
      <HistoryPanel
        label=""
        state={{ tag: 'ready', entries }}
        activeThreadId="thread-a"
        projects={[]}
        disabled={false}
        statusFor={(threadId) => {
          statusQueries.push(threadId)
          return 'running'
        }}
        onNewThread={() => undefined}
        onOpen={() => undefined}
        onRename={async () => undefined}
        onRetry={() => undefined}
      />,
    )

    expect(statusQueries).toEqual(['thread-b'])
    expect(html.match(/data-thread-status="running"/g)).toHaveLength(1)
  })

  it('keeps consumers alive while the optional status provider unloads and reloads', async () => {
    const ctx = new Context()
    let reader: OptionalThreadStatusService | undefined
    const consumer: Plugin = (owner) => {
      reader = new OptionalThreadStatusService(owner)
      return () => reader?.dispose()
    }
    const consumerFiber = await ctx.plugin(consumer)
    expect(reader?.snapshot()).toMatchObject({ running: [], finished: [] })

    const status = (threadId: string): ClientThreadStatusService => ({
      subscribe: () => () => undefined,
      snapshot: () => ({ revision: 1, running: [threadId], finished: [] }),
      acknowledge: () => undefined,
    })
    const provide = (service: ClientThreadStatusService): Plugin => {
      const plugin: Plugin = (owner) => owner.provide('clientThreadStatus', service)
      plugin.provide = 'clientThreadStatus'
      return plugin
    }

    const firstProvider = await ctx.plugin(provide(status('thread-a')))
    expect(reader?.snapshot().running).toEqual(['thread-a'])

    await firstProvider.dispose()
    expect(reader?.snapshot()).toMatchObject({ running: [], finished: [] })

    const secondProvider = await ctx.plugin(provide(status('thread-b')))
    expect(reader?.snapshot().running).toEqual(['thread-b'])

    await secondProvider.dispose()
    await consumerFiber.dispose()
  })

  it('marks chats that wait for an approval or answer and returns them to work when resolved', () => {
    const restore = installBrowserGlobals()
    const harness = {
      codex: { activeThreadIds: ['thread-a', 'thread-b', 'thread-c'], threadStates: {} },
      pendingRequests: [] as PendingServerRequest[],
      extensions: {},
    }
    let hostListener = (_event: HarnessEvent): void => undefined
    const host = {
      snapshot: () => ({ snapshot: harness }),
      journal: () => [],
      onEvent: (listener: (event: HarnessEvent) => void) => { hostListener = listener; return () => undefined },
    } as unknown as ClientHostService
    const session = { snapshot: () => sessionSnapshot('other'), subscribe: () => () => {} } as unknown as ClientSessionService
    const service = new ThreadStatusService(host, session)
    const request = (id: number, method: string, params: Record<string, unknown>): PendingServerRequest => ({ id, method, params, receivedAt: '' })
    try {
      harness.pendingRequests = [
        request(1, 'item/commandExecution/requestApproval', { threadId: 'thread-a' }),
        request(2, 'item/tool/requestUserInput', { threadId: 'thread-b' }),
        request(3, 'item/tool/requestUserInput', { threadId: 'thread-c', isBlocking: false }),
      ]
      hostListener({ type: 'codex.serverRequest', payload: harness.pendingRequests[0]! })
      expect(service.snapshot().blocked).toEqual({ 'thread-a': 'permission', 'thread-b': 'question' })
      expect(threadWorkStatus(service.snapshot(), 'thread-a')).toBe('blocked')
      expect(threadWorkStatus(service.snapshot(), 'thread-c')).toBe('running')
      expect(service.snapshot().running).toContain('thread-a')

      harness.pendingRequests = []
      harness.codex.threadStates = { 'thread-c': { status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } }
      hostListener({ type: 'codex.serverRequest.resolved', payload: { id: 1 } } as HarnessEvent)
      expect(service.snapshot().blocked).toEqual({ 'thread-c': 'question' })
      expect(threadWorkStatus(service.snapshot(), 'thread-a')).toBe('running')
    } finally { service.dispose(); restore() }
  })

  it('waits briefly for a Codex outcome and remembers failed turns', async () => {
    const restore = installBrowserGlobals()
    let hostListener = (_event: HarnessEvent): void => undefined
    const host = {
      snapshot: () => ({ snapshot: { codex: { activeThreadIds: [] }, pendingRequests: [], extensions: {} } }),
      journal: () => [],
      onEvent: (listener: (event: HarnessEvent) => void) => { hostListener = listener; return () => undefined },
    } as unknown as ClientHostService
    const session = { snapshot: () => sessionSnapshot('other'), subscribe: () => () => {} } as unknown as ClientSessionService
    const service = new ThreadStatusService(host, session, { outcomeSettleMs: 20 })
    const status = (activeThreadIds: string[]): HarnessEvent => ({ type: 'codex.status', payload: { status: 'ready', models: [], activeThreadIds } } as HarnessEvent)
    try {
      hostListener({ type: 'codex.notification', payload: { method: 'turn/started', params: { threadId: 'thread-f' } } })
      hostListener({ type: 'codex.notification', payload: { method: 'turn/started', params: { threadId: 'thread-ok' } } })
      // Codex reports the thread as idle before it forwards turn/completed.
      hostListener(status([]))
      expect(service.snapshot().settling).toEqual(['thread-f', 'thread-ok'])
      hostListener({ type: 'codex.notification', payload: { method: 'turn/completed', params: { threadId: 'thread-f', turn: { id: 't', status: 'failed' } } } })
      expect(service.snapshot().settling).toEqual(['thread-ok'])
      expect(threadWorkStatus(service.snapshot(), 'thread-f')).toBe('failed')
      await vi.waitFor(() => expect(service.snapshot().settling).toBeUndefined())
      expect(threadWorkStatus(service.snapshot(), 'thread-ok')).toBe('finished')

      const reloaded = new ThreadStatusService(host, session)
      expect(threadWorkStatus(reloaded.snapshot(), 'thread-f')).toBe('failed')
      reloaded.acknowledge('thread-f')
      expect(reloaded.snapshot().failed).toBeUndefined()
      reloaded.dispose()
    } finally { service.dispose(); restore() }
  })

  it('takes an Agent chat outcome from its problem when the turn ends', () => {
    const restore = installBrowserGlobals()
    const failedId = 'acp-00000000-0000-0000-0000-000000000001'
    const okId = 'acp-00000000-0000-0000-0000-000000000002'
    const chat = (id: string, turn: string, problem?: string) => ({ summary: { id }, turn, requests: [], activities: [], ...(problem ? { problem } : {}) })
    let extensions: Record<string, unknown> = { a: chat(failedId, 'running'), b: chat(okId, 'running') }
    let hostListener = (_event: HarnessEvent): void => undefined
    const host = {
      snapshot: () => ({ snapshot: { codex: { activeThreadIds: [] }, pendingRequests: [], extensions } as unknown as HarnessSnapshot }),
      journal: () => [],
      onEvent: (listener: (event: HarnessEvent) => void) => { hostListener = listener; return () => undefined },
    } as unknown as ClientHostService
    const session = { snapshot: () => sessionSnapshot('other'), subscribe: () => () => {} } as unknown as ClientSessionService
    const service = new ThreadStatusService(host, session)
    const updated = { type: 'extensions.updated', payload: {} } as HarnessEvent
    try {
      hostListener(updated)
      expect(service.snapshot().running).toEqual([failedId, okId])
      extensions = { a: { ...chat(failedId, 'running'), requests: [{ id: 1, method: 'agent/requestApproval', params: {}, receivedAt: '' }] }, b: chat(okId, 'running') }
      hostListener(updated)
      expect(threadWorkStatus(service.snapshot(), failedId)).toBe('blocked')
      extensions = { a: chat(failedId, 'idle', 'The provider exited'), b: chat(okId, 'idle') }
      hostListener(updated)
      expect(threadWorkStatus(service.snapshot(), failedId)).toBe('failed')
      expect(threadWorkStatus(service.snapshot(), okId)).toBe('finished')
      expect(service.snapshot().settling).toBeUndefined()
    } finally { service.dispose(); restore() }
  })

  it('ranks waiting, failed, working, and finished chats for tabs and groups', () => {
    const status = {
      revision: 1,
      running: ['running', 'blocked'],
      finished: ['failed', 'finished'],
      failed: ['failed'],
      blocked: { blocked: 'question' as const },
    }
    expect(aggregateThreadWorkStatus(status, ['finished', 'running', 'failed', 'blocked'])).toBe('blocked')
    expect(aggregateThreadWorkStatus(status, ['finished', 'running', 'failed'])).toBe('failed')
    expect(aggregateThreadWorkStatus(status, ['finished', 'running'])).toBe('running')
    expect(aggregateBlockedKind(status, ['running', 'blocked'])).toBe('question')
    expect(threadWorkStatusCounts(status, ['running', 'blocked', 'failed', 'finished', 'finished']))
      .toEqual({ running: 1, blocked: 1, failed: 1, finished: 1 })
  })

  it('labels waiting and failed chats', () => {
    const question = renderToStaticMarkup(<ThreadStatusIndicator status="blocked" kind="question" />)
    expect(question).toContain('aria-label="Waiting for your answer"')
    expect(question).toContain('lucide-circle-alert')
    expect(renderToStaticMarkup(<ThreadStatusIndicator status="blocked" />)).toContain('aria-label="Waiting for you"')
    expect(renderToStaticMarkup(<ThreadStatusIndicator status="failed" />)).toContain('aria-label="Failed"')
    expect(renderToStaticMarkup(<ThreadStatusIndicator status="failed" label="Failed (cargo): 2 tests" />))
      .toContain('title="Failed (cargo): 2 tests"')
  })
})
