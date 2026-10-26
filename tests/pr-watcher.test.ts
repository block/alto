import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrWatchers, parseWatcherResult, type PrWatcherDependencies, type SavedWatch } from '../program/plugins/pr-watcher-model.js'
import type { PrWatcherAlert } from '../program/plugins/pr-watcher-api.js'
import type { WatchPullRequest, WatchTarget } from '../program/plugins/pr-watcher-github.js'

const now = 10_000_000
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

function member(number = 42, overrides: Partial<WatchPullRequest> = {}): WatchPullRequest {
  return { number, url: `https://github.com/example/repo/pull/${number}`, title: `PR ${number}`,
    repository: 'example/repo', headRepository: 'example/repo', branch: `feature/${number}`, headSha: `head-${number}`,
    state: 'OPEN', ci: 'passing', ciFingerprint: 'checks-passing', feedback: [], ...overrides }
}

function target(members = [member()], scope: 'pr' | 'stack' = 'pr'): WatchTarget {
  return { key: `github.com/example/repo:${scope}:${scope === 'stack' ? 'stack-id' : members[0]!.number}`,
    label: scope === 'stack' ? 'PR stack' : `PR #${members[0]!.number}`, scope, pullRequestUrl: members[0]!.url,
    ...(scope === 'stack' ? { stackId: 'stack-id' } : {}), members }
}

function feedback(id = 'comment-1') {
  return { id, url: 'https://github.com/example/repo/pull/42#discussion-1', author: 'reviewer', body: 'Please handle this edge case.', updatedAt: '2026-10-15T10:00:00Z' }
}

function saved(value: WatchTarget, overrides: Partial<SavedWatch> = {}): SavedWatch {
  return { key: value.key, cwd: '/source/repo', enabled: true, observed: [], handled: [], attempts: [],
    view: { id: `watch-${value.scope}-${value.members[0]!.number}`, scope: value.scope, pullRequestUrl: value.pullRequestUrl,
      label: value.label, threadId: `chat-${value.scope}-${value.members[0]!.number}`, status: 'watching', updatedAt: now,
      members: value.members.map((pr) => ({ number: pr.number, url: pr.url, title: pr.title, autoAddressFeedback: false })) },
    ...overrides }
}

function fixture(initial = target()) {
  const state = {
    target: structuredClone(initial), now,
    chat: { turn: 'idle', requests: [], remote: { state: 'connected' } } as Awaited<ReturnType<PrWatcherDependencies['chat']>>,
    saved: [] as Array<{ watches: SavedWatch[]; alerts: PrWatcherAlert[] }>,
  }
  const deps = {
    available: vi.fn(() => true),
    readTarget: vi.fn(async () => structuredClone(state.target)),
    create: vi.fn(async () => 'watch-chat'),
    chat: vi.fn(async () => structuredClone(state.chat)),
    send: vi.fn(async (_id: string, _prompt: string) => { state.chat.turn = 'running' }),
    cancel: vi.fn(async () => { state.chat.turn = 'idle' }),
    open: vi.fn(async () => {}),
    save: vi.fn(async (watches: SavedWatch[], alerts: PrWatcherAlert[]) => { state.saved.push(structuredClone({ watches, alerts })) }),
    changed: vi.fn(), now: () => state.now,
  } satisfies PrWatcherDependencies
  const model = new PrWatchers(deps)
  cleanup.push(() => model.dispose())
  const latest = (id?: string) => state.saved.at(-1)?.watches.find((watch) => !id || watch.view.id === id)
  return { model, deps, state, latest }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('PR watcher lifecycle', () => {
  it('deduplicates repeated and concurrent starts into one saved Blox chat', async () => {
    const f = fixture()
    const creation = deferred<string>()
    f.deps.create.mockReturnValue(creation.promise)
    const input = { pullRequestUrl: f.state.target.pullRequestUrl, scope: 'pr' as const, sourceCwd: '/source/repo' }
    const first = f.model.start(input)
    const second = f.model.start({ ...input, pullRequestUrl: `${input.pullRequestUrl}?from=toolbar` })
    await vi.waitFor(() => expect(f.deps.create).toHaveBeenCalledTimes(1))
    expect(f.latest()?.view.status).toBe('starting')
    creation.resolve('watch-chat')
    const [a, b] = await Promise.all([first, second])
    expect(a.id).toBe(b.id)
    await f.model.refresh(a.id)
    const again = await f.model.start(input)
    await f.model.refresh(a.id)
    expect(again.id).toBe(a.id)
    expect(f.deps.create).toHaveBeenCalledTimes(1)
    expect(f.model.snapshot().watches).toHaveLength(1)
  })

  it('deduplicates simultaneous starts from different PRs in the same native stack', async () => {
    const f = fixture(target([member(41), member(42)], 'stack'))
    const inputs = f.state.target.members.map((pr) => ({ pullRequestUrl: pr.url, scope: 'stack' as const, sourceCwd: '/source/repo' }))
    const [a, b] = await Promise.all(inputs.map((input) => f.model.start(input)))
    expect(a!.id).toBe(b!.id)
    await f.model.refresh(a!.id)
    expect(f.deps.create).toHaveBeenCalledTimes(1)
  })

  it('retries an initial creation failure on the same watch record without duplicating chats', async () => {
    const f = fixture()
    const input = { pullRequestUrl: f.state.target.pullRequestUrl, scope: 'pr' as const, sourceCwd: '/source/repo' }
    f.deps.create.mockRejectedValueOnce(new Error('Blox unavailable'))
    await expect(f.model.start(input)).rejects.toThrow('Blox unavailable')
    const failed = f.model.snapshot().watches[0]!
    expect(failed).toMatchObject({ status: 'blocked' })
    expect(failed.threadId).toBeUndefined()
    const [a, b] = await Promise.all([f.model.start(input), f.model.start(input)])
    expect(a.id).toBe(failed.id)
    expect(b.id).toBe(failed.id)
    await f.model.refresh(a.id)
    expect(f.model.snapshot().watches).toHaveLength(1)
    expect(f.deps.create).toHaveBeenCalledTimes(2)
    expect(f.deps.open).toHaveBeenCalledWith('watch-chat')
    expect(f.latest()).toMatchObject({ enabled: true, view: { threadId: 'watch-chat', status: 'watching' } })
  })

  it('serializes Start and Resume while retrying a failed chat creation', async () => {
    const f = fixture()
    const failed = saved(f.state.target, { enabled: false })
    delete failed.view.threadId
    failed.view.status = 'blocked'
    f.model.restore([failed], [])
    const creation = deferred<string>()
    f.deps.create.mockReturnValue(creation.promise)
    const starting = f.model.start({ pullRequestUrl: f.state.target.pullRequestUrl, scope: 'pr', sourceCwd: '/source/repo' })
    await vi.waitFor(() => expect(f.deps.create).toHaveBeenCalledOnce())
    const resuming = f.model.resume(failed.view.id)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const createsBeforeAcknowledgment = f.deps.create.mock.calls.length
    creation.resolve('watch-chat')
    await Promise.all([starting, resuming])
    expect(createsBeforeAcknowledgment).toBe(1)
    expect(f.deps.create).toHaveBeenCalledOnce()
  })

  it('keeps Pause effective when it arrives while the remote chat is still being created', async () => {
    const f = fixture(target([member(42, { ci: 'failing' })]))
    const creation = deferred<string>()
    f.deps.create.mockReturnValue(creation.promise)
    const starting = f.model.start({ pullRequestUrl: f.state.target.pullRequestUrl, scope: 'pr', sourceCwd: '/source/repo' })
    await vi.waitFor(() => expect(f.deps.create).toHaveBeenCalledOnce())
    const id = f.model.snapshot().watches[0]!.id
    let paused = false
    const pausing = f.model.pause(id).then(() => { paused = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(paused).toBe(false)
    creation.resolve('watch-chat')
    await Promise.all([starting, pausing])
    await f.model.refresh(id)
    expect(f.deps.create).toHaveBeenCalledOnce()
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.latest()).toMatchObject({ enabled: false, view: { threadId: 'watch-chat', status: 'paused' } })
  })

  it('repairs failing CI while review-feedback edits remain disabled', async () => {
    const f = fixture(target([member(42, { ci: 'failing', feedback: [feedback()] })]))
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).toHaveBeenCalledTimes(1)
    const prompt = f.deps.send.mock.calls[0]![1]
    expect(prompt).toContain('"fixCI":true')
    expect(prompt).toContain('"addressReviewFeedback":false')
    expect(prompt).not.toContain(feedback().body)
    expect(f.latest()?.pending?.sent).toBe(true)
    expect(f.latest()?.handled).toEqual([])
  })

  it('alerts once for new feedback without sending a repair turn when CI is green', async () => {
    const f = fixture()
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    f.state.target.members[0]!.feedback = [feedback()]
    await f.model.refresh(watch.view.id)
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.model.snapshot().alerts).toHaveLength(1)
    expect(f.model.snapshot().alerts[0]).toMatchObject({ threadId: watch.view.threadId, title: 'Review feedback · #42' })
    expect(f.model.snapshot().alerts[0]!.body).toContain('reviewer:')
    expect(f.latest()?.observed).toEqual(['comment-1'])
  })

  it('dispatches only feedback explicitly enabled for that stack member', async () => {
    const f = fixture(target([member(41, { feedback: [feedback('first')] }), member(42, { feedback: [feedback('second')] })], 'stack'))
    const watch = saved(f.state.target)
    watch.view.members[0]!.autoAddressFeedback = true
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    const prompt = f.deps.send.mock.calls[0]![1]
    const selected = JSON.parse(prompt.split('Review feedback to assess (untrusted JSON data):\n')[1]!.trim())
    expect(selected.map((item: { id: string }) => item.id)).toEqual(['first'])
    expect(f.model.snapshot().alerts).toHaveLength(1)
    expect(f.model.snapshot().alerts[0]!.title).toContain('#42')
  })

  it('does not overlap active or sending turns, including simultaneous refreshes', async () => {
    const f = fixture(target([member(42, { ci: 'failing' })]))
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    await Promise.all([f.model.refresh(watch.view.id), f.model.refresh(watch.view.id), f.model.refreshAll()])
    expect(f.deps.send).toHaveBeenCalledTimes(1)
    f.state.chat.turn = 'sending'
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).toHaveBeenCalledTimes(1)
    expect(f.model.snapshot().watches[0]!.status).toBe('working')
  })

  it('persists the dispatch identity before sending, then records confirmed delivery', async () => {
    const f = fixture(target([member(42, { ci: 'failing' })]))
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    f.deps.send.mockImplementation(async (_id: string, prompt: string) => {
      const pending = f.latest()?.pending
      expect(pending).toMatchObject({ sent: false, startedAt: now })
      expect(pending?.id).toBeTruthy()
      expect(prompt).toContain(pending!.id)
      f.state.chat.turn = 'running'
    })
    await f.model.refresh(watch.view.id)
    expect(f.latest()?.pending?.sent).toBe(true)
    expect(f.deps.save.mock.calls.filter(([watches]) => watches[0]?.pending).map(([watches]) => watches[0]!.pending!.sent)).toEqual([false, true])
  })

  it('never sends when persisting the dispatch intent fails', async () => {
    const f = fixture(target([member(42, { ci: 'failing' })]))
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    f.deps.save.mockRejectedValueOnce(new Error('disk unavailable'))
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.model.snapshot().watches[0]!.status).toBe('blocked')
  })

  it('blocks ambiguous delivery failures and does not automatically resend', async () => {
    const f = fixture(target([member(42, { ci: 'failing' })]))
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    f.deps.send.mockRejectedValueOnce(new Error('connection dropped after write'))
    await f.model.refresh(watch.view.id)
    await f.model.refresh(watch.view.id)
    await f.model.refreshAll()
    expect(f.deps.send).toHaveBeenCalledTimes(1)
    expect(f.latest()).toMatchObject({ enabled: false, pending: { sent: false }, view: { status: 'blocked' } })
    expect(f.model.snapshot().watches[0]!.message).toContain('Could not confirm delivery')
  })

  it('reconnects to an in-flight saved pass without redispatching or marking feedback handled', async () => {
    const f = fixture(target([member(42, { ci: 'failing', feedback: [feedback()] })]))
    const watch = saved(f.state.target, { pending: { id: 'pass-1', feedback: ['comment-1'], startedAt: now - 1000, sent: true } })
    f.state.chat.turn = 'running'
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.deps.create).not.toHaveBeenCalled()
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.latest()?.pending?.id).toBe('pass-1')
    expect(f.latest()?.handled).toEqual([])
  })

  it('accepts only a matching complete report before marking feedback handled', async () => {
    const f = fixture(target([member(42, { feedback: [feedback()] })]))
    const watch = saved(f.state.target, { pending: { id: 'pass-1', feedback: ['comment-1'], startedAt: now - 1000, sent: true } })
    watch.view.members[0]!.autoAddressFeedback = true
    f.state.chat.resultText = 'Fixed the edge case.\nALTO_WATCH_RESULT {"id":"pass-1","status":"complete","summary":"Fixed and tested"}'
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.latest()?.handled).toEqual(['comment-1'])
    expect(f.latest()?.pending).toBeUndefined()
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.latest()?.enabled).toBe(true)
  })

  it.each([
    { sent: true, text: 'Finished without a report' },
    { sent: true, text: 'ALTO_WATCH_RESULT {"id":"other-pass","status":"complete","summary":"Done"}' },
    { sent: true, text: 'ALTO_WATCH_RESULT {"id":"pass-1","status":"blocked","summary":"Missing credentials"}' },
    { sent: false, text: 'ALTO_WATCH_RESULT {"id":"pass-1","status":"complete","summary":"Done"}' },
  ])('keeps feedback unhandled and alerts after an unconfirmed result: %j', async ({ sent, text }) => {
    const f = fixture(target([member(42, { feedback: [feedback()] })]))
    const watch = saved(f.state.target, { observed: ['comment-1'], pending: { id: 'pass-1', feedback: ['comment-1'], startedAt: now - 1000, sent } })
    watch.view.members[0]!.autoAddressFeedback = true
    f.state.chat.resultText = text
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.latest()?.handled).toEqual([])
    expect(f.latest()?.enabled).toBe(false)
    expect(f.model.snapshot().watches[0]!.status).toBe('blocked')
    expect(f.model.snapshot().alerts).toHaveLength(1)
    expect(f.deps.send).not.toHaveBeenCalled()
  })

  it.each(['pause', 'feedback'] as const)('waits for cancellation acknowledgment before applying %s', async (operation) => {
    const f = fixture()
    const watch = saved(f.state.target)
    watch.view.members[0]!.autoAddressFeedback = true
    f.state.chat.turn = 'running'
    f.model.restore([watch], [])
    const acknowledged = deferred<Awaited<ReturnType<PrWatcherDependencies['chat']>>>()
    f.deps.cancel.mockImplementation(async () => {})
    f.deps.chat.mockResolvedValueOnce(structuredClone(f.state.chat)).mockImplementation(() => acknowledged.promise)
    let finished = false
    const pending = (operation === 'pause' ? f.model.pause(watch.view.id) : f.model.feedback(watch.view.id, 42, false)).then(() => { finished = true })
    await vi.waitFor(() => expect(f.deps.cancel).toHaveBeenCalledOnce())
    expect(finished).toBe(false)
    expect(f.latest()?.enabled).toBe(false)
    expect(f.model.snapshot().watches[0]!.members[0]!.autoAddressFeedback).toBe(true)
    expect(f.model.snapshot().watches[0]!.status).toBe('working')
    acknowledged.resolve({ turn: 'idle', requests: [], remote: { state: 'connected' } })
    await pending
    expect(finished).toBe(true)
    expect(f.model.snapshot().watches[0]!.status).toBe(operation === 'pause' ? 'paused' : 'watching')
    if (operation === 'feedback') expect(f.model.snapshot().watches[0]!.members[0]!.autoAddressFeedback).toBe(false)
    expect(f.deps.send).not.toHaveBeenCalled()
  })

  it('leaves automation paused and the old setting intact if stop cannot be confirmed', async () => {
    const f = fixture()
    const watch = saved(f.state.target)
    watch.view.members[0]!.autoAddressFeedback = true
    f.state.chat.turn = 'running'
    f.deps.cancel.mockRejectedValueOnce(new Error('Blox disconnected'))
    f.model.restore([watch], [])
    await expect(f.model.feedback(watch.view.id, 42, false)).rejects.toThrow('Blox disconnected')
    expect(f.latest()?.enabled).toBe(false)
    expect(f.model.snapshot().watches[0]!).toMatchObject({ status: 'blocked', members: [expect.objectContaining({ autoAddressFeedback: true })] })
  })

  it('enforces per-head repair limits and a cooldown between attempts', async () => {
    const f = fixture(target([member(42, { ci: 'failing' })]))
    const watch = saved(f.state.target, { attempts: [{ number: 42, head: 'head-42', at: now - 30_000 }] })
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.model.snapshot().watches[0]!.message).toBe('Waiting for CI to update')
    f.state.now += 120_001
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).toHaveBeenCalledOnce()

    const exhausted = fixture(target([member(42, { ci: 'failing' })]))
    const record = saved(exhausted.state.target, { attempts: [600_000, 400_000, 200_000].map((ago) => ({ number: 42, head: 'head-42', at: now - ago })) })
    exhausted.model.restore([record], [])
    await exhausted.model.refresh(record.view.id)
    expect(exhausted.deps.send).not.toHaveBeenCalled()
    expect(exhausted.latest()?.enabled).toBe(false)
    expect(exhausted.model.snapshot().alerts).toHaveLength(1)
  })

  it('counts one stack repair pass once even when it includes many failing PRs', async () => {
    const members = Array.from({ length: 7 }, (_, index) => member(index + 1, { ci: 'failing' }))
    const f = fixture(target(members, 'stack'))
    const watch = saved(f.state.target, { attempts: members.map((pr) => ({ number: pr.number, head: pr.headSha, at: now - 180_000 })) })
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.deps.send).toHaveBeenCalledOnce()
    expect(f.latest()?.enabled).toBe(true)
  })

  it('bounds repair cycles across changing commits until the user explicitly resumes', async () => {
    const f = fixture(target([member(42, { ci: 'failing', headSha: 'new-head' })]))
    const watch = saved(f.state.target, { attempts: Array.from({ length: 6 }, (_, index) => ({ number: 42, head: `old-head-${index}`, at: now - 180_000 * (index + 1) })) })
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    await f.model.refreshAll()
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.latest()?.enabled).toBe(false)
    expect(f.model.snapshot().watches[0]!.message).toContain('retry limit')
    await f.model.resume(watch.view.id)
    expect(f.deps.create).not.toHaveBeenCalled()
    expect(f.deps.send).toHaveBeenCalledOnce()
    expect(f.latest()?.attempts).toEqual([{ number: 42, head: 'new-head', at: now }])
  })

  it('keeps cancelled feedback unhandled so resuming can address it', async () => {
    const f = fixture(target([member(42, { feedback: [feedback()] })]))
    const watch = saved(f.state.target, { observed: ['comment-1'], pending: { id: 'cancelled-pass', feedback: ['comment-1'], startedAt: now - 1000, sent: true } })
    watch.view.members[0]!.autoAddressFeedback = true
    f.state.chat.turn = 'running'
    f.model.restore([watch], [])
    await f.model.pause(watch.view.id)
    expect(f.latest()?.pending).toBeUndefined()
    expect(f.latest()?.handled).toEqual([])
    expect(f.model.snapshot().watches[0]!.status).toBe('paused')
    await f.model.resume(watch.view.id)
    expect(f.deps.send).toHaveBeenCalledOnce()
    expect(f.latest()?.pending?.feedback).toEqual(['comment-1'])
    expect(f.latest()?.handled).toEqual([])
  })

  it('blocks stack expansion that overlaps another active watcher', async () => {
    const stack = target([member(41)], 'stack')
    const pr = target([member(42)])
    const f = fixture(stack)
    const stackWatch = saved(stack)
    const prWatch = saved(pr)
    f.model.restore([stackWatch, prWatch], [])
    f.state.target.members.push(member(42, { ci: 'failing' }))
    await f.model.refresh(stackWatch.view.id)
    expect(f.deps.send).not.toHaveBeenCalled()
    expect(f.model.snapshot().watches.find((watch) => watch.id === stackWatch.view.id)?.status).toBe('blocked')
  })

  it('does not grant feedback editing when a new member joins a stack', async () => {
    const f = fixture(target([member(41)], 'stack'))
    const watch = saved(f.state.target)
    watch.view.members[0]!.autoAddressFeedback = true
    f.model.restore([watch], [])
    f.state.target.members.push(member(42, { feedback: [feedback()] }))
    await f.model.refresh(watch.view.id)
    expect(f.model.snapshot().watches[0]!.members.map((pr) => pr.autoAddressFeedback)).toEqual([true, false])
    expect(f.model.snapshot().alerts).toHaveLength(1)
    expect(f.deps.send).not.toHaveBeenCalled()
  })

  it('finishes when all PRs are closed without launching another turn', async () => {
    const f = fixture(target([member(42, { state: 'MERGED', ci: 'failing' })]))
    const watch = saved(f.state.target)
    f.model.restore([watch], [])
    await f.model.refresh(watch.view.id)
    expect(f.latest()).toMatchObject({ enabled: false, view: { status: 'done' } })
    expect(f.deps.send).not.toHaveBeenCalled()
  })
})

describe('watcher completion reports', () => {
  it('requires the final line to contain this pass identity and an explicit valid outcome', () => {
    expect(parseWatcherResult('Summary\nALTO_WATCH_RESULT {"id":"pass","status":"complete","summary":"Fixed"}\n', 'pass')).toEqual({ status: 'complete', summary: 'Fixed' })
    expect(parseWatcherResult('ALTO_WATCH_RESULT {"id":"pass","status":"blocked","summary":"No credentials"}', 'pass')).toEqual({ status: 'blocked', summary: 'No credentials' })
    for (const text of [
      'ALTO_WATCH_RESULT {"id":"pass","status":"complete","summary":"Fixed"}\nAnother line',
      'ALTO_WATCH_RESULT {"id":"wrong","status":"complete","summary":"Fixed"}',
      'ALTO_WATCH_RESULT {"id":"pass","status":"complete","summary":" "}',
      'ALTO_WATCH_RESULT {"id":"pass","status":"unknown","summary":"Fixed"}',
      'ALTO_WATCH_RESULT null', 'ALTO_WATCH_RESULT malformed',
    ]) expect(parseWatcherResult(text, 'pass')).toBeUndefined()
  })
})
