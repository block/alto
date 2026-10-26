import { describe, expect, it, vi } from 'vitest'
import type { ClientDraft, ClientUiService } from '../src/client/plugin-api.js'
import type { ClientSessionSnapshot } from '../program/plugins/session-api.js'
import {
  parseSourceChatDestination,
  parseSourceViewerResource,
  sourceViewerResource,
  type SourceChatDestination,
} from '../program/plugins/source-viewer-api.js'
import {
  prepareSourceEditChat,
  resolveSourceChatTarget,
  sendSourceComment,
  sourceChatDestination,
  sourceChatTitle,
  sourceCommentDraft,
  type SourceCommentRequest,
} from '../program/plugins/source-review-chat.js'
import { createSteerSubmitMiddleware, SteerQueue } from '../program/plugins/steer.client.js'
import type { ClientWorkspaceLayoutService, WorkspacePaneTarget } from '../program/plugins/workspace-layout-api.js'

const comment: SourceCommentRequest = {
  path: '/project/src/main.ts', revision: 'viewed-revision',
  source: 'before\nconst answer = 42\nafter', start: 2, end: 2,
  body: '  Explain this value.\n',
}

function chat(paneId: string, threadId: string | undefined, workspaceId = 'tab') {
  const state = {
    connected: true,
    canAcceptDirectInput: true,
    threadId,
    threads: threadId ? [{ id: threadId, title: `Chat ${paneId}` }] : [],
    session: { workspace: '/project' },
    turn: { tag: 'idle' as 'idle' | 'running' },
  }
  const send = vi.fn(async (_draft: ClientDraft) => undefined)
  const steer = vi.fn(async (_draft: ClientDraft) => undefined)
  const ensureThread = vi.fn(async (_workspace?: string) => {
    state.threadId = `created-${paneId}`
    return state.threadId
  })
  const target: WorkspacePaneTarget = {
    workspaceId, paneId, focused: false,
    session: { snapshot: () => state as unknown as ClientSessionSnapshot, send, steer, ensureThread } as unknown as WorkspacePaneTarget['session'],
  }
  return { target, state, send, steer, ensureThread }
}

function browser() {
  const first = chat('first', 'thread-first')
  const second = chat('second', 'thread-second')
  const elsewhere = chat('elsewhere', 'thread-first', 'other-tab')
  const targets = [first.target, second.target, elsewhere.target]
  const layout = { paneTargets: () => targets } as unknown as ClientWorkspaceLayoutService
  const submit = vi.fn<ClientUiService['submit']>(async (draft, next) => next(draft))
  const ui = { submit } as unknown as ClientUiService
  return { first, second, elsewhere, targets, layout, submit, ui }
}

describe('Source chat destinations', () => {
  it('persists the exact opening chat with the source location, including empty chats', () => {
    for (const threadId of ['thread&one', undefined]) {
      const target = chat('pane?one', threadId, 'tab#one').target
      const location = {
        path: '/project/a file?#.rs', line: 4, endLine: 6, column: 2,
        destination: sourceChatDestination(target),
      }
      expect(parseSourceViewerResource(sourceViewerResource(location))).toEqual(location)
    }
    const legacy = { path: '/project/main.rs', line: 5 }
    expect(parseSourceViewerResource(sourceViewerResource(legacy))).toEqual(legacy)
  })

  it('rejects malformed bindings instead of dropping them and choosing another chat', () => {
    const valid = sourceChatDestination(chat('pane', 'thread').target)
    expect(parseSourceChatDestination(valid)).toEqual(valid)
    for (const invalid of [null, {}, { ...valid, paneId: '' }, { ...valid, threadId: 42 }, { ...valid, workspace: '' }]) {
      expect(parseSourceChatDestination(invalid)).toBeUndefined()
      const resource = sourceViewerResource({ path: '/project/main.rs' })
        + '?destination=' + encodeURIComponent(JSON.stringify(invalid))
      expect(parseSourceViewerResource(resource)).toBeUndefined()
    }
    expect(parseSourceViewerResource('source:%2Fproject%2Fmain.rs?destination=%7B')).toBeUndefined()
  })

  it('keeps the opening chat when focus moves to another chat', () => {
    const f = browser()
    const destination = sourceChatDestination(f.second.target)
    f.first.target.focused = true
    expect(resolveSourceChatTarget(f.layout, 'tab', destination)).toBe(f.second.target)
    f.first.target.focused = false
    f.elsewhere.target.focused = true
    expect(resolveSourceChatTarget(f.layout, 'tab', destination)).toBe(f.second.target)
  })

  it('automatically chooses only a sole same-tab chat when no destination exists', () => {
    const f = browser()
    f.second.target.focused = true
    expect(resolveSourceChatTarget(f.layout, 'tab')).toBeUndefined()
    f.targets.splice(1, 1)
    expect(resolveSourceChatTarget(f.layout, 'tab')).toBe(f.first.target)
    const missing: SourceChatDestination = { ...sourceChatDestination(f.first.target), paneId: 'closed' }
    expect(resolveSourceChatTarget(f.layout, 'tab', missing)).toBeUndefined()
    expect(resolveSourceChatTarget(f.layout, 'other-tab', sourceChatDestination(f.first.target))).toBeUndefined()
  })

  it('labels existing and new chats for the destination picker', () => {
    expect(sourceChatTitle(chat('A', 'thread').target)).toBe('Chat A')
    expect(sourceChatTitle(chat('new', undefined).target)).toBe('New chat')
  })
})

describe('Source edit chat delivery', () => {
  it('uses the linked conversation without creating a new chat or copying its transcript', async () => {
    const f = browser()
    const destination = sourceChatDestination(f.second.target)
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', destination)
    expect(linked).toMatchObject({ destination, threadId: 'thread-second', workspace: '/project' })
    expect(f.second.ensureThread).not.toHaveBeenCalled()
    expect(f.submit).not.toHaveBeenCalled()
    f.first.target.focused = true
    await linked.deliver('Host-prepared edit prompt')
    expect(f.second.send).toHaveBeenCalledExactlyOnceWith({
      text: 'Host-prepared edit prompt', images: [], attachments: [], skills: [],
    })
    expect(f.first.send).not.toHaveBeenCalled()
    expect(f.elsewhere.send).not.toHaveBeenCalled()
  })

  it('binds an empty conversation before host preparation and preserves that binding if delivery fails', async () => {
    const f = browser()
    const empty = chat('empty', undefined)
    f.targets.push(empty.target)
    const promoted = vi.fn()
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(empty.target), promoted)
    expect(linked.threadId).toBe('created-empty')
    expect(promoted).toHaveBeenCalledExactlyOnceWith(linked.destination)
    expect(f.submit).not.toHaveBeenCalled()
    f.submit.mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(linked.deliver('Propose a change')).rejects.toThrow('Network unavailable')
    expect(empty.ensureThread).toHaveBeenCalledOnce()
    expect(linked.destination.threadId).toBe('created-empty')
  })

  it('queues a busy chat through the normal middleware without steering it', async () => {
    const f = browser()
    f.second.state.turn.tag = 'running'
    const queue = new SteerQueue()
    const middleware = createSteerSubmitMiddleware(queue, f.first.target.session)
    f.submit.mockImplementation((draft, next, request) => middleware(draft, next, request!))
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(f.second.target))
    await linked.deliver('Propose a change')
    expect(queue.snapshot()).toMatchObject([{ threadId: 'thread-second', draft: { text: 'Propose a change' } }])
    expect(f.first.send).not.toHaveBeenCalled()
    expect(f.second.send).not.toHaveBeenCalled()
    expect(f.second.steer).not.toHaveBeenCalled()
  })

  it('refuses a middleware attempt to steer an edit into a pending question', async () => {
    const f = browser()
    f.first.state.turn.tag = 'running'
    f.submit.mockImplementation(async (draft, _next, request) => request!.target!.steer(draft))
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(f.first.target))
    await expect(linked.deliver('Propose a change')).rejects.toThrow('pending question')
    expect(f.first.steer).not.toHaveBeenCalled()
    expect(f.first.send).not.toHaveBeenCalled()
  })

  it.each(['closed', 'thread', 'workspace', 'session'] as const)('rejects a %s change during host preparation', async (change) => {
    const f = browser()
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(f.first.target))
    if (change === 'closed') f.targets.splice(0, 1)
    else if (change === 'thread') f.first.state.threadId = 'replacement'
    else if (change === 'workspace') f.first.state.session.workspace = '/elsewhere'
    else f.targets[0] = chat('first', 'thread-first').target
    await expect(linked.deliver('Propose a change')).rejects.toThrow('changed or closed')
    expect(f.submit).not.toHaveBeenCalled()
    expect(f.first.send).not.toHaveBeenCalled()
    expect(f.second.send).not.toHaveBeenCalled()
  })

  it.each(['fallback', 'send'] as const)('rechecks the job and destination before a delayed %s', async (operation) => {
    const f = browser()
    let cancelled = false
    const guard = vi.fn(async () => { if (cancelled) throw new Error('Edit cancelled') })
    f.submit.mockImplementation(async (draft, next, request) => {
      cancelled = true
      await (operation === 'fallback' ? next(draft) : request!.target!.send(draft))
    })
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(f.first.target))
    await expect(linked.deliver('Propose a change', guard)).rejects.toThrow('Edit cancelled')
    expect(guard).toHaveBeenCalledTimes(2)
    expect(f.first.send).not.toHaveBeenCalled()
  })

  it('rechecks the selected conversation after an asynchronous send guard', async () => {
    const f = browser()
    const guard = vi.fn(async () => undefined)
    guard.mockImplementationOnce(async () => undefined).mockImplementationOnce(async () => {
      f.first.state.threadId = 'replacement'
    })
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(f.first.target))
    await expect(linked.deliver('Propose a change', guard)).rejects.toThrow('changed or closed')
    expect(f.first.send).not.toHaveBeenCalled()
  })

  it.each(['connected', 'canAcceptDirectInput'] as const)('rejects an idle chat with %s false before preparing or sending an edit', async (field) => {
    const f = browser()
    const destination = sourceChatDestination(f.first.target)
    f.first.state[field] = false
    await expect(prepareSourceEditChat(f.ui, f.layout, 'tab', destination)).rejects.toThrow()
    f.first.state[field] = true
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', destination)
    f.first.state[field] = false
    await expect(linked.deliver('Propose a change')).rejects.toThrow()
    expect(f.submit).not.toHaveBeenCalled()
    expect(f.first.send).not.toHaveBeenCalled()
  })

  it('reports a turn that starts during middleware instead of silently dropping the request', async () => {
    const f = browser()
    f.submit.mockImplementation(async (draft, next) => {
      f.first.state.turn.tag = 'running'
      await next(draft)
    })
    const linked = await prepareSourceEditChat(f.ui, f.layout, 'tab', sourceChatDestination(f.first.target))
    await expect(linked.deliver('Propose a change')).rejects.toThrow('already working')
    expect(f.first.send).not.toHaveBeenCalled()
  })
})

describe('Source comment delivery', () => {
  it('preserves the user body and includes only the selected source with revision metadata', () => {
    const draft = sourceCommentDraft(comment)
    expect(draft.text.startsWith(comment.body + '\n\n')).toBe(true)
    expect(draft.text).toContain(JSON.stringify({ path: comment.path, revision: comment.revision, startLine: 2, endLine: 2 }))
    expect(draft.text).toContain('\nconst answer = 42\n')
    expect(draft.text).not.toContain('\nbefore\n')
    expect(draft.text).not.toContain('\nafter\n')
    expect(draft).toMatchObject({ images: [], attachments: [], skills: [] })
  })

  it('fences arbitrary selected source without permitting its backticks to close the context', () => {
    const source = 'keep outside\n`````\n# injected heading\n`````\nkeep outside'
    const text = sourceCommentDraft({ ...comment, source, start: 2, end: 4 }).text
    expect(text).toContain('\n``````text\n')
    expect(text).toContain('\n`````\n# injected heading\n`````\n``````')
    expect(text.endsWith('\n``````')).toBe(true)
    expect(text).not.toContain('keep outside')
    expect(() => sourceCommentDraft({ ...comment, start: 0 })).toThrow('selected source lines')
    expect(() => sourceCommentDraft({ ...comment, end: 99 })).toThrow('selected source lines')
    expect(() => sourceCommentDraft({ ...comment, body: ' ' })).toThrow('Write a comment')
  })

  it('sends to the captured chat and honors changes made by submit middleware', async () => {
    const f = browser()
    const destination = sourceChatDestination(f.second.target)
    f.first.target.focused = true
    const forwarded = { text: 'Forwarded draft', images: [], attachments: [], skills: [] }
    f.submit.mockImplementation(async (_draft, next) => next(forwarded))
    await expect(sendSourceComment(f.ui, f.layout, 'tab', destination, comment)).resolves.toEqual(destination)
    expect(f.second.send).toHaveBeenCalledExactlyOnceWith(forwarded)
    expect(f.first.send).not.toHaveBeenCalled()
    expect(f.elsewhere.send).not.toHaveBeenCalled()
    expect(f.submit).toHaveBeenCalledWith(sourceCommentDraft(comment), expect.any(Function), expect.objectContaining({
      mode: 'queue', target: expect.objectContaining({ id: 'tab:second', threadId: 'thread-second', activeTurn: false }),
    }))
  })

  it('lets the normal queue consume comments during an active turn', async () => {
    const f = browser()
    f.second.state.turn.tag = 'running'
    f.submit.mockImplementation(async () => undefined)
    await sendSourceComment(f.ui, f.layout, 'tab', sourceChatDestination(f.second.target), comment)
    expect(f.second.send).not.toHaveBeenCalled()
    expect(f.submit.mock.calls[0]?.[2]).toMatchObject({ mode: 'queue', target: { threadId: 'thread-second', activeTurn: true } })
  })

  it.each(['closed', 'thread', 'workspace', 'tab'] as const)('refuses a %s destination without choosing another chat', async (change) => {
    const f = browser()
    const destination = sourceChatDestination(f.first.target)
    if (change === 'closed') f.targets.splice(0, 1)
    else if (change === 'thread') f.first.state.threadId = 'replacement'
    else if (change === 'workspace') f.first.state.session.workspace = '/elsewhere'
    else f.first.target.workspaceId = 'different-tab'
    await expect(sendSourceComment(f.ui, f.layout, 'tab', destination, comment)).rejects.toThrow('changed or closed')
    expect(f.submit).not.toHaveBeenCalled()
    expect(f.second.send).not.toHaveBeenCalled()
    expect(f.elsewhere.send).not.toHaveBeenCalled()
  })

  it.each(['fallback', 'send', 'steer'] as const)('revalidates the destination before a delayed %s', async (operation) => {
    const f = browser()
    const destination = sourceChatDestination(f.first.target)
    f.submit.mockImplementation(async (draft, next, request) => {
      f.first.state.threadId = 'replacement'
      await (operation === 'fallback' ? next(draft) : request!.target![operation](draft))
    })
    await expect(sendSourceComment(f.ui, f.layout, 'tab', destination, comment)).rejects.toThrow('changed or closed')
    expect(f.first.send).not.toHaveBeenCalled()
    expect(f.first.steer).not.toHaveBeenCalled()
  })

  it('checks that the pane still exists when delayed middleware sends', async () => {
    const f = browser()
    const destination = sourceChatDestination(f.first.target)
    f.submit.mockImplementation(async (draft, next) => {
      f.targets.splice(0, 1)
      await next(draft)
    })
    await expect(sendSourceComment(f.ui, f.layout, 'tab', destination, comment)).rejects.toThrow('changed or closed')
    expect(f.first.send).not.toHaveBeenCalled()
  })

  it('promotes the selected empty chat before submission and preserves its binding if sending fails', async () => {
    const f = browser()
    const empty = chat('empty', undefined)
    f.targets.push(empty.target)
    const destination = sourceChatDestination(empty.target)
    const promoted = vi.fn()
    f.submit.mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(sendSourceComment(f.ui, f.layout, 'tab', destination, comment, promoted)).rejects.toThrow('Network unavailable')
    const updated = { ...destination, threadId: 'created-empty' }
    expect(empty.ensureThread).toHaveBeenCalledExactlyOnceWith('/project')
    expect(promoted).toHaveBeenCalledExactlyOnceWith(updated)
    await expect(sendSourceComment(f.ui, f.layout, 'tab', updated, comment)).resolves.toEqual(updated)
    expect(empty.ensureThread).toHaveBeenCalledTimes(1)
    expect(empty.send).toHaveBeenCalledOnce()
  })

  it('refuses a different conversation opened while an empty chat is being prepared', async () => {
    const f = browser()
    const empty = chat('empty', undefined)
    f.targets.push(empty.target)
    empty.ensureThread.mockImplementation(async () => {
      empty.state.threadId = 'different-conversation'
      return 'created-empty'
    })
    const promoted = vi.fn()
    await expect(sendSourceComment(f.ui, f.layout, 'tab', sourceChatDestination(empty.target), comment, promoted)).rejects.toThrow('changed or closed')
    expect(promoted).not.toHaveBeenCalled()
    expect(f.submit).not.toHaveBeenCalled()
  })
})
