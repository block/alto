import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '../src/shared/protocol.js'
import type { PullRequestDetails } from '../program/plugins/pull-request-pane-api.js'
import type { DiffReviewDocument } from '../program/plugins/diff-viewer-api.js'
import { PullRequestPaneLoader, pullRequestRevision } from '../program/plugins/pull-request-pane-loader.js'

const resource = (number = 42) => `https://github.com/example/repo/pull/${number}`
const details = (number = 42, overrides: Partial<PullRequestDetails> = {}): PullRequestDetails => ({
  id: `PR_${number}`, number, title: `PR ${number}`, url: resource(number), repository: 'example/repo', headRepository: 'example/repo',
  branch: 'feature', baseBranch: 'main', state: 'OPEN', draft: false, author: null, body: 'Description',
  updatedAt: '2026-11-06T12:00:00Z', headSha: 'head-a', baseSha: 'base-a', review: null, checks: null,
  mergeable: 'MERGEABLE', mergeState: 'CLEAN', unresolvedThreads: 0, moreThreads: false,
  additions: 1, deletions: 1, changedFiles: 1, checksList: [], moreChecks: false, comments: [], moreComments: false, threads: [], ...overrides,
})
const document = (number = 42, workspace = '/repo', patch = 'patch-a'): DiffReviewDocument => ({
  id: `patch-${number}-${patch}`, title: `PR ${number}`, workspace, patch, createdAt: '2026-11-06T12:00:00Z',
})
const json = (value: unknown) => value as JsonValue
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function pendingHost() {
  const requests: { method: string; payload: JsonValue | undefined; response: ReturnType<typeof deferred<JsonValue>> }[] = []
  const call = vi.fn((method: string, payload?: JsonValue) => {
    const response = deferred<JsonValue>()
    requests.push({ method, payload, response })
    return response.promise
  })
  return { call, requests }
}

function immediateHost() {
  let revision: Partial<PullRequestDetails> = {}
  const call = vi.fn(async (method: string, payload?: JsonValue) => {
    const input = payload as { resource: string; workspace?: string }
    const number = Number(input.resource.split('/').at(-1))
    return json(method === 'pull-request.read' ? details(number, revision) : document(number, input.workspace))
  })
  return { call, setRevision: (value: Partial<PullRequestDetails>) => { revision = value } }
}

async function finish(loader: PullRequestPaneLoader, number = 42, mode: 'open' | 'metadata' | 'refresh' | 'diff' = 'open', workspace = '/repo') {
  const pending = loader.load(resource(number), workspace, mode)
  const [summary, diff] = await Promise.all([pending.details, pending.diff])
  return { summary, diff }
}

describe('PR pane loading and cache', () => {
  afterEach(() => vi.useRealTimers())

  it('starts summary and patch together, shares both calls, and accepts a diff-first response without a duplicate download', async () => {
    const host = pendingHost()
    const loader = new PullRequestPaneLoader(host)
    const first = loader.load(resource(), '/repo')
    const second = loader.load('https://github.com/EXAMPLE/REPO/pull/42/files#diff-1', '/repo')
    expect(host.requests.map(request => request.method)).toEqual(['pull-request.read', 'pull-request.diff'])
    expect(first.details).toBe(second.details)
    host.requests[1]!.response.resolve(json(document()))
    await tick()
    expect(loader.peek(resource(), '/repo').details).toBeUndefined()
    host.requests[0]!.response.resolve(json(details()))
    const [a, b] = await Promise.all([first.diff, second.diff])
    expect(a.document).toBe(b.document)
    expect(a.revision).toBe(pullRequestRevision(details()))
    expect(host.call).toHaveBeenCalledTimes(2)
    loader.dispose()
  })

  it('publishes summary before a slow patch and keeps repeat opens and A→B→A in memory', async () => {
    const host = pendingHost()
    const loader = new PullRequestPaneLoader(host)
    const first = loader.load(resource(), '/repo')
    host.requests[0]!.response.resolve(json(details()))
    await expect(first.details).resolves.toMatchObject({ title: 'PR 42' })
    expect(loader.peek(resource(), '/repo').diff).toBeUndefined()
    host.requests[1]!.response.resolve(json(document()))
    const a = await first.diff
    const next = loader.load(resource(43), '/repo')
    host.requests[2]!.response.resolve(json(details(43)))
    host.requests[3]!.response.resolve(json(document(43)))
    await next.diff
    const restored = await finish(loader)
    expect(restored.diff.document).toBe(a.document)
    expect(host.call).toHaveBeenCalledTimes(4)
    loader.dispose()
  })

  it('expires provisional cold bytes after the short TTL, then reuses a newly fetched patch across unchanged metadata polls', async () => {
    let now = 0
    const host = immediateHost()
    const loader = new PullRequestPaneLoader(host, { now: () => now })
    await finish(loader)
    now = 14_999
    await finish(loader)
    expect(host.call).toHaveBeenCalledTimes(2)
    now = 15_001
    await finish(loader, 42, 'metadata')
    expect(host.call.mock.calls.map(([method]) => method)).toEqual(['pull-request.read', 'pull-request.diff', 'pull-request.read', 'pull-request.diff'])
    now = 75_001
    await finish(loader, 42, 'metadata')
    expect(host.call.mock.calls.filter(([method]) => method === 'pull-request.diff')).toHaveLength(2)
    loader.dispose()
  })

  it.each(['headSha', 'baseSha', 'baseBranch'] as const)('invalidates provisional bytes after a known %s change', async field => {
    const host = pendingHost()
    const loader = new PullRequestPaneLoader(host)
    const initial = loader.load(resource(), '/repo')
    host.requests[1]!.response.resolve(json(document()))
    host.requests[0]!.response.resolve(json(details()))
    await initial.diff
    const poll = loader.load(resource(), '/repo', 'metadata')
    expect(host.call).toHaveBeenCalledTimes(3)
    host.requests[2]!.response.resolve(json(details(42, { [field]: 'changed' })))
    await poll.details
    await tick()
    expect(host.call).toHaveBeenCalledTimes(4)
    expect(loader.peek(resource(), '/repo').diff).toBeUndefined()
    host.requests[3]!.response.resolve(json(document(42, '/repo', 'patch-b')))
    await expect(poll.diff).resolves.toMatchObject({ document: { patch: 'patch-b' } })
    loader.dispose()
  })

  it('starts a replacement immediately when metadata invalidates an obsolete patch that has not settled', async () => {
    const host = pendingHost()
    const loader = new PullRequestPaneLoader(host)
    const initial = loader.load(resource(), '/repo')
    host.requests[0]!.response.resolve(json(details()))
    host.requests[1]!.response.resolve(json(document()))
    await initial.diff
    const refresh = loader.load(resource(), '/repo', 'refresh')
    const freshDetails = details(42, { headSha: 'head-b' })
    host.requests[2]!.response.resolve(json(freshDetails))
    await refresh.details
    await tick()
    expect(host.requests.map(request => request.method)).toEqual(['pull-request.read', 'pull-request.diff', 'pull-request.read', 'pull-request.diff', 'pull-request.diff'])
    host.requests[4]!.response.resolve(json(document(42, '/repo', 'patch-b')))
    const result = await refresh.diff
    expect(result.revision).toBe(pullRequestRevision(freshDetails))
    expect(result.document.patch).toBe('patch-b')
    host.requests[3]!.response.resolve(json(document(42, '/repo', 'obsolete')))
    await tick()
    expect(loader.peek(resource(), '/repo').diff?.patch).toBe('patch-b')
    loader.dispose()
  })

  it.each(['older first', 'newer first'] as const)('converges different known-revision consumers without cached metadata when the %s request resolves', async order => {
    const host = pendingHost()
    const loader = new PullRequestPaneLoader(host, { maxPatchBytes: 0 })
    // A repeated resolved-promise selection can otherwise starve the event loop
    // forever, including the test timeout. Fail that regression synchronously.
    const selection = loader as unknown as { patch: (...args: unknown[]) => unknown }
    const original = selection.patch.bind(loader)
    let selections = 0
    vi.spyOn(selection, 'patch').mockImplementation((...args) => {
      if (++selections > 8) throw new Error('Revision selection did not converge')
      return original(...args)
    })
    const first = loader.load(resource(), '/repo', 'diff', details())
    await tick() // The first consumer is already awaiting its obsolete patch.
    const newerDetails = details(42, { headSha: 'head-b' })
    const second = loader.load(resource(), '/repo', 'diff', newerDetails)
    const results = Promise.all([first.diff, second.diff])
    expect(host.requests.map(request => request.method)).toEqual(['pull-request.diff', 'pull-request.diff'])
    if (order === 'newer first') {
      host.requests[1]!.response.resolve(json(document(42, '/repo', 'patch-b')))
      await expect(second.diff).resolves.toMatchObject({ revision: pullRequestRevision(newerDetails), document: { patch: 'patch-b' } })
      expect(loader.peek(resource(), '/repo').diff).toBeUndefined() // B cannot fit in this cache.
      host.requests[0]!.response.resolve(json(document(42, '/repo', 'obsolete')))
    } else {
      host.requests[0]!.response.resolve(json(document(42, '/repo', 'obsolete')))
      await tick()
      expect(host.call).toHaveBeenCalledTimes(2)
      host.requests[1]!.response.resolve(json(document(42, '/repo', 'patch-b')))
    }
    const [older, newer] = await results
    expect(older.document).toBe(newer.document)
    expect(older.document.patch).toBe('patch-b')
    expect(older.revision).toBe(pullRequestRevision(newerDetails))
    expect(older.details?.headSha).toBe('head-b')
    expect(loader.peek(resource(), '/repo').details).toBeUndefined()
    expect(host.call).toHaveBeenCalledTimes(2)
    loader.dispose()
  })

  it('makes header refresh fetch both resources, while diff refresh fetches only the patch', async () => {
    const host = immediateHost()
    const loader = new PullRequestPaneLoader(host)
    await finish(loader)
    await finish(loader, 42, 'refresh')
    expect(host.call.mock.calls.map(([method]) => method)).toEqual(['pull-request.read', 'pull-request.diff', 'pull-request.read', 'pull-request.diff'])
    await finish(loader, 42, 'diff')
    expect(host.call.mock.calls.at(-1)?.[0]).toBe('pull-request.diff')
    expect(host.call).toHaveBeenCalledTimes(5)
    loader.dispose()
  })

  it('shares metadata across workspaces but never returns another workspace document', async () => {
    const host = immediateHost()
    const loader = new PullRequestPaneLoader(host)
    const a = await finish(loader)
    const b = await finish(loader, 42, 'open', '/other')
    expect(a.diff.document.workspace).toBe('/repo')
    expect(b.diff.document.workspace).toBe('/other')
    expect(host.call.mock.calls.filter(([method]) => method === 'pull-request.read')).toHaveLength(1)
    expect(host.call.mock.calls.filter(([method]) => method === 'pull-request.diff')).toHaveLength(2)
    loader.dispose()
  })

  it('does not cache read, diff, or response-identity errors', async () => {
    const host = pendingHost()
    const loader = new PullRequestPaneLoader(host)
    const first = loader.load(resource(), '/repo')
    const failed = Promise.allSettled([first.details, first.diff])
    host.requests[0]!.response.reject(new Error('Check GitHub access'))
    host.requests[1]!.response.reject(new Error('Patch is unavailable'))
    expect((await failed).every(result => result.status === 'rejected')).toBe(true)
    const retry = loader.load(resource(), '/repo')
    const invalid = Promise.allSettled([retry.details, retry.diff])
    host.requests[2]!.response.resolve(json(details(43)))
    host.requests[3]!.response.resolve(json(document(42, '/wrong-workspace')))
    expect((await invalid).every(result => result.status === 'rejected')).toBe(true)
    expect(loader.peek(resource(), '/repo')).toEqual({ details: undefined, diff: undefined, diffRevision: undefined })
    expect(host.call).toHaveBeenCalledTimes(4)
    loader.dispose()
  })

  it('bounds cached entry count and UTF-8 patch bytes, including oversized uncached patches', async () => {
    const host = immediateHost()
    const small = new PullRequestPaneLoader(host, { maxEntries: 2 })
    await finish(small)
    await finish(small, 43)
    expect(small.peek(resource(), '/repo').details).toBeUndefined()
    expect(small.peek(resource(), '/repo').diff).toBeUndefined()
    small.dispose()

    const call = vi.fn(async (method: string, payload?: JsonValue) => {
      const input = payload as { resource: string; workspace: string }
      const number = Number(input.resource.split('/').at(-1))
      return json(method === 'pull-request.read' ? details(number) : document(number, input.workspace, number === 44 ? 'é'.repeat(10) : 'é'.repeat(3)))
    })
    const budget = new PullRequestPaneLoader({ call }, { maxPatchBytes: 10 })
    await finish(budget)
    await finish(budget, 43)
    expect(budget.peek(resource(), '/repo').diff).toBeUndefined()
    expect(budget.peek(resource(43), '/repo').diff?.patch).toBe('é'.repeat(3))
    const oversized = await finish(budget, 44)
    expect(oversized.diff.document.patch).toBe('é'.repeat(10))
    expect(budget.peek(resource(44), '/repo').diff).toBeUndefined()
    expect(call.mock.calls.filter(([method, payload]) => method === 'pull-request.diff' && (payload as { resource: string }).resource === resource(44))).toHaveLength(1)
    budget.dispose()
  })

  it('disposes plugin retry waits and ignores late server results without warming the next plugin installation', async () => {
    vi.useFakeTimers()
    const call = vi.fn().mockRejectedValue(new Error('browser program revision 5 is incompatible with server revision 6'))
    const loader = new PullRequestPaneLoader({ call })
    const pending = loader.load(resource(), '/repo')
    const settled = Promise.allSettled([pending.details, pending.diff])
    await tick()
    expect(vi.getTimerCount()).toBe(2)
    loader.dispose()
    expect((await settled).every(result => result.status === 'rejected')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(call).toHaveBeenCalledTimes(2)

    const lateHost = pendingHost()
    const old = new PullRequestPaneLoader(lateHost)
    const late = old.load(resource(), '/repo')
    const ignored = Promise.allSettled([late.details, late.diff])
    old.dispose()
    lateHost.requests[0]!.response.resolve(json(details()))
    lateHost.requests[1]!.response.resolve(json(document()))
    await ignored
    expect(old.peek(resource(), '/repo').details).toBeUndefined()
    expect(old.peek(resource(), '/repo').diff).toBeUndefined()
  })
})
