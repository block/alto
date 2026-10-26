import { describe, expect, it, vi } from 'vitest'
import { parsePullRequestUrl, readExistingWatchTarget, readWatchTarget } from '../program/plugins/pr-watcher-github.js'
import type { ProcessRunnerService } from '../program/plugins/process-runner-api.js'

const SHA = 'a'.repeat(40)
const URL = 'https://github.com/example/repo/pull/42'
const signal = () => new AbortController().signal
const page = (nodes: unknown[] = [], cursor?: string) => ({ nodes, pageInfo: { hasNextPage: Boolean(cursor), endCursor: cursor ?? null } })
function pr(number = 42, overrides: Record<string, unknown> = {}) {
  return { id: `PR_${number}`, number, url: `https://github.com/example/repo/pull/${number}`,
    title: `PR ${number}`, state: 'OPEN', headRefName: `feature-${number}`, headRefOid: SHA,
    repository: { nameWithOwner: 'example/repo' }, headRepository: { nameWithOwner: 'example/repo' },
    statusCheckRollup: { state: 'SUCCESS', contexts: page() }, ...overrides }
}
function comment(id: string, overrides: Record<string, unknown> = {}) {
  return { id, url: `${URL}#${id}`, body: `Feedback ${id}`, author: { login: 'reviewer' }, updatedAt: '2026-10-15T12:00:00Z', ...overrides }
}
const feedback = (overrides: Record<string, unknown> = {}) => ({ comments: page(), reviews: page(), reviewThreads: page(), ...overrides })
const target = (value: unknown = pr()) => ({ viewer: { login: 'jm' }, repository: { pullRequest: value } })

function fixture(handle: (query: string, variables: Record<string, string>) => unknown | Promise<unknown>) {
  const execFile = vi.fn(async (_file: string, args: string[]) => {
    const variables: Record<string, string> = {}
    for (let index = 0; index < args.length - 1; index += 1) {
      if (args[index] !== '-f' && args[index] !== '-F') continue
      const field = args[++index]!
      const split = field.indexOf('=')
      variables[field.slice(0, split)] = field.slice(split + 1)
    }
    const query = variables.query!
    delete variables.query
    return { stdout: JSON.stringify({ data: await handle(query, variables) }), stderr: '' }
  })
  return { runner: { execFile } as ProcessRunnerService, execFile }
}
function simple(value = pr(), response = feedback()) {
  return fixture((query) => query.includes('AltoWatchTarget') ? target(value) : { node: response })
}

describe('PR watcher GitHub reader', () => {
  it('canonicalizes GitHub PR URLs and rejects unsafe or unsupported identities', () => {
    expect(parsePullRequestUrl('https://GitHub.com/Example/Repo/pull/42/?x=1#review')).toEqual({ repository: 'example/repo', number: 42, url: URL })
    for (const url of ['http://github.com/example/repo/pull/42', 'https://github.com.evil.test/example/repo/pull/42',
      'https://user@github.com/example/repo/pull/42', 'https://github.com:444/example/repo/pull/42',
      'https://github.com/example/repo/pull/0', 'https://github.com/example/repo/pull/9007199254740992',
      'https://github.com/example/repo/pull/42/files', 'https://github.com/example/repo%2Fother/pull/42']) {
      expect(() => parsePullRequestUrl(url)).toThrow()
    }
  })

  it('reads a single PR without requiring stack APIs and retains the actual fork head identity', async () => {
    const { runner, execFile } = simple(pr(42, { headRepository: { nameWithOwner: 'contributor/repo' } }))
    const result = await readWatchTarget(URL, 'pr', runner, signal())
    expect(result).toMatchObject({ key: `pr:${URL}`, scope: 'pr', pullRequestUrl: URL, members: [{
      number: 42, repository: 'example/repo', headRepository: 'contributor/repo', branch: 'feature-42', headSha: SHA,
    }] })
    expect(execFile.mock.calls[0]?.[1].join(' ')).not.toContain('stack {')
    expect(execFile).toHaveBeenCalledTimes(2)
    for (const call of execFile.mock.calls) {
      expect(call[0]).toBe('gh')
      expect(call[1].slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'github.com'])
      expect(call[1].join(' ')).not.toContain('mutation')
    }
  })

  it('pages through comments, reviews, review threads and every unresolved thread comment', async () => {
    const { runner, execFile } = fixture((query, variables) => {
      if (query.includes('AltoWatchTarget')) return target()
      if (query.includes('AltoWatchThreadComments')) {
        expect(variables).toEqual({ id: 'thread-2', cursor: 'thread-comments-next' })
        return { node: { comments: page([comment('thread-comment-2')]) } }
      }
      if (query.includes('AltoWatchFeedbackPage')) {
        if (variables.cursor === 'comments-next') return { node: { comments: page([comment('comment-2')]) } }
        if (variables.cursor === 'reviews-next') return { node: { reviews: page([comment('review-2', { state: 'CHANGES_REQUESTED' })]) } }
        return { node: { reviewThreads: page([{ id: 'thread-2', isResolved: false, comments: page([comment('thread-comment-1')], 'thread-comments-next') }]) } }
      }
      return { node: feedback({
        comments: page([comment('comment-1')], 'comments-next'),
        reviews: page([comment('review-1', { state: 'COMMENTED' })], 'reviews-next'),
        reviewThreads: page([{ id: 'resolved', isResolved: true, comments: page([comment('resolved-comment')]) }], 'threads-next'),
      }) }
    })
    const result = await readWatchTarget(URL, 'pr', runner, signal())
    expect(result.members[0]?.feedback.map(({ body }) => body).sort()).toEqual([
      'Feedback comment-1', 'Feedback comment-2', 'Feedback review-1', 'Feedback review-2',
      'Feedback thread-comment-1', 'Feedback thread-comment-2',
    ])
    expect(execFile).toHaveBeenCalledTimes(6)
  })

  it('keeps bot feedback, ignores own or unpublished review text, and revisits edited feedback', async () => {
    const data = feedback({ comments: page([
      comment('bot', { author: { login: 'review-bot[bot]' } }), comment('mine', { author: { login: 'JM' } }),
      comment('edited'), comment('empty', { body: '' }),
    ]), reviews: page([comment('draft', { state: 'PENDING' })]) })
    const first = await readWatchTarget(URL, 'pr', simple(pr(), data).runner, signal())
    const changed = feedback({ comments: page([comment('edited', { body: 'Edited feedback with the same timestamp' })]) })
    const second = await readWatchTarget(URL, 'pr', simple(pr(), changed).runner, signal())
    expect(first.members[0]?.feedback.map(({ author }) => author)).toEqual(['review-bot[bot]', 'reviewer'])
    expect(first.members[0]?.feedback.find(({ body }) => body === 'Feedback edited')?.id)
      .not.toEqual(second.members[0]?.feedback[0]?.id)
  })

  it('uses authoritative aggregate CI and keeps the same failure fingerprint as unrelated jobs complete', async () => {
    const failed = { __typename: 'CheckRun', id: 'check-1', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: 'start', completedAt: 'end' }
    const ciPr = (nodes: unknown[], headRefOid = SHA) => pr(42, { headRefOid, statusCheckRollup: { state: 'FAILURE', contexts: page(nodes) } })
    const first = (await readWatchTarget(URL, 'pr', simple(ciPr([failed])).runner, signal())).members[0]!
    const same = (await readWatchTarget(URL, 'pr', simple(ciPr([failed, { __typename: 'CheckRun', id: 'other', conclusion: 'SUCCESS' }])).runner, signal())).members[0]!
    const rerun = (await readWatchTarget(URL, 'pr', simple(ciPr([{ ...failed, id: 'check-2' }])).runner, signal())).members[0]!
    const newHead = (await readWatchTarget(URL, 'pr', simple(ciPr([failed], 'b'.repeat(40))).runner, signal())).members[0]!
    expect(first.ci).toBe('failing')
    expect(same.ciFingerprint).toBe(first.ciFingerprint)
    expect(rerun.ciFingerprint).not.toBe(first.ciFingerprint)
    expect(newHead.ciFingerprint).not.toBe(first.ciFingerprint)
    expect((await readWatchTarget(URL, 'pr', simple(ciPr([])).runner, signal())).members[0]?.ci).toBe('failing')
  })

  it('paginates checks so later failing jobs are part of the fingerprint', async () => {
    const checked = fixture((query) => {
      if (query.includes('AltoWatchTarget')) return target(pr(42, { statusCheckRollup: { state: 'FAILURE', contexts: page([], 'more-checks') } }))
      if (query.includes('AltoWatchChecks')) return { node: { headRefOid: SHA, statusCheckRollup: {
        contexts: page([{ __typename: 'StatusContext', id: 'status-1', state: 'FAILURE', createdAt: 'now' }]),
      } } }
      return { node: feedback() }
    })
    const result = await readWatchTarget(URL, 'pr', checked.runner, signal())
    const empty = await readWatchTarget(URL, 'pr', simple(pr(42, { statusCheckRollup: { state: 'FAILURE', contexts: page() } })).runner, signal())
    expect(result.members[0]?.ciFingerprint).not.toBe(empty.members[0]?.ciFingerprint)
    expect(checked.execFile).toHaveBeenCalledTimes(3)
  })

  it('fails a poll if the head changes while checks are being paginated', async () => {
    const { runner } = fixture((query) => {
      if (query.includes('AltoWatchTarget')) return target(pr(42, { statusCheckRollup: { state: 'FAILURE', contexts: page([], 'next') } }))
      if (query.includes('AltoWatchChecks')) return { node: { headRefOid: 'b'.repeat(40), statusCheckRollup: { contexts: page() } } }
      return { node: feedback() }
    })
    await expect(readWatchTarget(URL, 'pr', runner, signal())).rejects.toThrow('head changed')
  })

  it('refreshes native stack membership with one metadata query and orders by native position', async () => {
    let membership = [43, 42]
    const { runner, execFile } = fixture((query) => query.includes('AltoWatchTarget')
      ? target(pr(42, { stack: { id: 'stack-7', number: 7, size: membership.length,
        entries: page(membership.map((number) => ({ position: number - 40, pullRequest: pr(number) }))) } }))
      : { node: feedback() })
    const first = await readWatchTarget(URL, 'stack', runner, signal())
    expect(first.members.map(({ number }) => number)).toEqual([42, 43])
    expect(first).toMatchObject({ key: 'stack:example/repo:stack-7', stackId: 'stack-7', scope: 'stack' })
    expect(execFile).toHaveBeenCalledTimes(3)
    membership = [44, 42, 43]
    const next = await readWatchTarget(URL, 'stack', runner, signal())
    expect(next.members.map(({ number }) => number)).toEqual([42, 43, 44])
    expect(execFile).toHaveBeenCalledTimes(7)
  })

  it('never infers a stack, and rejects incomplete or duplicated native membership', async () => {
    await expect(readWatchTarget(URL, 'stack', simple(pr(42, { stack: null })).runner, signal())).rejects.toThrow('native GitHub stack')
    for (const stack of [
      { id: 'stack', number: 1, size: 101, entries: page([], 'more') },
      { id: 'stack', number: 1, size: 2, entries: page([{ position: 1, pullRequest: pr() }]) },
      { id: 'stack', number: 1, size: 2, entries: page([{ position: 1, pullRequest: pr() }, { position: 2, pullRequest: pr() }]) },
    ]) await expect(readWatchTarget(URL, 'stack', simple(pr(42, { stack })).runner, signal())).rejects.toThrow()
  })

  it('fails explicitly on feedback pagination loops or overflow', async () => {
    let count = 0
    const { runner } = fixture((query) => {
      if (query.includes('AltoWatchTarget')) return target()
      if (query.includes('AltoWatchFeedbackPage')) return { node: { comments: page([], `cursor-${++count}`) } }
      return { node: feedback({ comments: page([], 'cursor-0') }) }
    })
    await expect(readWatchTarget(URL, 'pr', runner, signal())).rejects.toThrow('incomplete')
    expect(count).toBe(19)
    const loop = fixture((query) => query.includes('AltoWatchTarget') ? target() : { node: feedback({ comments: page([], 'loop') }) })
    await expect(readWatchTarget(URL, 'pr', loop.runner, signal())).rejects.toThrow('incomplete')
  })

  it('fails closed on mismatched repositories, missing heads and invalid branch names', async () => {
    for (const override of [
      { repository: { nameWithOwner: 'other/repo' } }, { headRepository: null },
      { headRefOid: 'not-a-sha' }, { headRefName: '--delete' }, { headRefName: 'feature;\ncommand' },
      { headRefName: 'feature/../main' }, { url: 'https://github.com/other/repo/pull/42' },
    ]) await expect(readWatchTarget(URL, 'pr', simple(pr(42, override)).runner, signal())).rejects.toThrow()
  })

  it('keeps closed and merged PRs terminal when their fork or head ref has been deleted', async () => {
    for (const state of ['CLOSED', 'MERGED']) {
      const { runner, execFile } = simple(pr(42, {
        state, headRepository: null, headRefName: null, headRefOid: null, statusCheckRollup: null,
      }))
      const result = await readWatchTarget(URL, 'pr', runner, signal())
      expect(result.members).toMatchObject([{
        state, repository: 'example/repo', headRepository: 'example/repo',
        branch: '', headSha: '', ci: 'unknown', feedback: [],
      }])
      expect(execFile).toHaveBeenCalledTimes(1)
    }
  })

  it('completes all-closed native stacks without querying unavailable heads or feedback', async () => {
    const stack = { id: 'stack', number: 1, size: 2, entries: page([
      { position: 1, pullRequest: pr(42, { state: 'MERGED', headRepository: null, headRefName: undefined, headRefOid: undefined }) },
      { position: 2, pullRequest: pr(43, { state: 'CLOSED', headRepository: null, headRefName: null, headRefOid: null }) },
    ]) }
    const { runner, execFile } = simple(pr(42, { state: 'MERGED', stack }))
    const result = await readWatchTarget(URL, 'stack', runner, signal())
    expect(result.members.map(({ state }) => state)).toEqual(['MERGED', 'CLOSED'])
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('continues watching open members beside closed stack members with deleted refs', async () => {
    const stack = { id: 'stack', number: 1, size: 2, entries: page([
      { position: 1, pullRequest: pr(42, { state: 'MERGED', headRepository: null, headRefName: null, headRefOid: null }) },
      { position: 2, pullRequest: pr(43) },
    ]) }
    const { runner, execFile } = simple(pr(42, { state: 'MERGED', stack }))
    const result = await readWatchTarget(URL, 'stack', runner, signal())
    expect(result.members.map(({ state }) => state)).toEqual(['MERGED', 'OPEN'])
    expect(result.members[1]).toMatchObject({ headRepository: 'example/repo', branch: 'feature-43', headSha: SHA, ci: 'passing' })
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('reanchors a watched stack after its merged anchor leaves while another member remains', async () => {
    const saved = { key: 'stack:example/repo:stack-7', label: 'Saved stack', scope: 'stack' as const,
      pullRequestUrl: URL, members: [{ url: URL }, { url: 'https://github.com/example/repo/pull/43' }] }
    const { runner, execFile } = fixture((query, variables) => {
      if (!query.includes('AltoWatchTarget')) return { node: feedback() }
      if (variables.number === '42') return target(pr(42, { state: 'MERGED', stack: null }))
      return target(pr(43, { stack: { id: 'stack-7', number: 7, size: 1,
        entries: page([{ position: 2, pullRequest: pr(43) }]) } }))
    })
    const result = await readExistingWatchTarget(saved, runner, signal())
    expect(result).toMatchObject({ key: saved.key, scope: 'stack', pullRequestUrl: 'https://github.com/example/repo/pull/43' })
    expect(result.members.map(({ number }) => number)).toEqual([43])
    expect(execFile).toHaveBeenCalledTimes(3)
  })

  it('refuses a different stack during reanchoring before querying its feedback', async () => {
    const saved = { key: 'stack:example/repo:stack-7', label: 'Saved stack', scope: 'stack' as const,
      pullRequestUrl: URL, members: [{ url: 'https://github.com/example/repo/pull/43' }] }
    const { runner, execFile } = fixture((_query, variables) => variables.number === '42'
      ? target(pr(42, { state: 'MERGED', stack: null }))
      : target(pr(43, { stack: { id: 'different-stack', number: 8, size: 1,
        entries: page([{ position: 1, pullRequest: pr(43) }]) } })))
    await expect(readExistingWatchTarget(saved, runner, signal())).rejects.toThrow('different native GitHub stack')
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('returns the saved terminal stack identity only when every former member is closed', async () => {
    const saved = { key: 'stack:example/repo:stack-7', label: 'Saved stack', scope: 'stack' as const,
      pullRequestUrl: URL, members: [{ url: URL }, { url: 'https://github.com/example/repo/pull/43' }] }
    const { runner, execFile } = fixture((_query, variables) => target(pr(Number(variables.number), {
      state: variables.number === '42' ? 'MERGED' : 'CLOSED', stack: null,
      headRepository: null, headRefName: null, headRefOid: null,
    })))
    const result = await readExistingWatchTarget(saved, runner, signal())
    expect(result).toMatchObject({ key: saved.key, label: saved.label, scope: 'stack', pullRequestUrl: URL })
    expect(result.members.map(({ state }) => state)).toEqual(['MERGED', 'CLOSED'])
    expect(execFile).toHaveBeenCalledTimes(4)
  })

  it('does not treat a dissolved stack with an open saved member as finished', async () => {
    const saved = { key: 'stack:example/repo:stack-7', label: 'Saved stack', scope: 'stack' as const,
      pullRequestUrl: URL, members: [{ url: URL }] }
    const { runner } = simple(pr(42, { stack: null }))
    await expect(readExistingWatchTarget(saved, runner, signal())).rejects.toThrow('saved member is still open')
  })

  it('does not retry authentication, network, or unsupported-schema errors across saved members', async () => {
    const saved = { key: 'stack:example/repo:stack-7', label: 'Saved stack', scope: 'stack' as const,
      pullRequestUrl: URL, members: [{ url: 'https://github.com/example/repo/pull/43' }] }
    for (const message of ['GitHub API rate limit exceeded', 'network timed out', "Field stack does not exist"]) {
      const { runner, execFile } = fixture(() => { throw new Error(message) })
      await expect(readExistingWatchTarget(saved, runner, signal())).rejects.toThrow(message)
      expect(execFile).toHaveBeenCalledTimes(1)
    }
  })

  it('passes cancellation to every subprocess and makes no request when already cancelled', async () => {
    const controller = new AbortController()
    const { runner, execFile } = simple()
    controller.abort()
    await expect(readWatchTarget(URL, 'pr', runner, controller.signal)).rejects.toThrow()
    expect(execFile).not.toHaveBeenCalled()
    const active = signal()
    await readWatchTarget(URL, 'pr', runner, active)
    for (const call of execFile.mock.calls as unknown[][]) expect(call[2]).toMatchObject({ signal: active })
  })
})
