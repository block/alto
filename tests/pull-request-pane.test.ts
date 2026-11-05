import { describe, expect, it, vi } from 'vitest'
import type { HarnessContext } from '../src/server/plugin-api.js'
import type { ClientExtensionHandler } from '../src/server/services/client-extension-registry.js'
import type { JsonValue } from '../src/shared/protocol.js'
import type { ProcessOptions, ProcessOutput, ProcessRunnerService } from '../program/plugins/process-runner-api.js'
import { parsePullRequestDetails, parsePullRequestReference, PULL_REQUEST_DIFF_METHOD, PULL_REQUEST_READ_METHOD } from '../program/plugins/pull-request-pane-api.js'
import pullRequestPane, { readPullRequestDetails, readPullRequestDiff } from '../program/plugins/pull-request-pane.js'

const URL = 'https://github.com/example/repo/pull/42'
const signal = () => new AbortController().signal
const page = (nodes: unknown[] = [], more = false) => ({ nodes, pageInfo: { hasNextPage: more, hasPreviousPage: more } })
const account = { login: 'reviewer', url: 'https://github.com/reviewer' }
const comment = (id = 'comment-1', overrides: Record<string, unknown> = {}) => ({ id, body: `Comment ${id}`, author: account, createdAt: '2026-11-01T12:00:00Z', url: `${URL}#${id}`, ...overrides })
function pr(overrides: Record<string, unknown> = {}) {
  return {
    id: 'PR_42', number: 42, title: 'Improve the sidebar', url: URL, state: 'OPEN', isDraft: false,
    body: '# Summary\n\nKeeps the glass light.', createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-02T12:00:00Z',
    headRefName: 'glass', baseRefName: 'main', headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED',
    additions: 25, deletions: 7, changedFiles: 3, author: account, repository: { nameWithOwner: 'example/repo' }, headRepository: { nameWithOwner: 'contributor/repo' },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: page([
      { __typename: 'CheckRun', id: 'check-1', name: 'Tests', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://buildkite.com/example/builds/1' },
      { __typename: 'StatusContext', id: 'context-1', context: 'Lint', state: 'SUCCESS', targetUrl: null },
    ]) } } }] },
    comments: page([comment()]),
    reviewThreads: page([
      { id: 'thread-1', path: 'src/glass.ts', line: 10, isResolved: false, isOutdated: false, comments: page([comment('inline-1')]) },
      { id: 'thread-2', path: 'src/old.ts', line: null, isResolved: true, isOutdated: true, comments: page([comment('inline-2')]) },
    ]), ...overrides,
  }
}
function fixture(value: unknown = { data: { repository: { pullRequest: pr() } } }) {
  const execFile = vi.fn(async (_file: string, _args: string[], _options?: ProcessOptions) => ({ stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' }))
  return { runner: { execFile } satisfies ProcessRunnerService, execFile }
}

describe('pull request resources', () => {
  it('canonicalizes shorthand and supported GitHub pages without relying on local Git context', () => {
    const reference = { repository: 'example/repo', number: 42, url: URL }
    for (const input of [' Example/Repo#42 ', 'https://GitHub.com/Example/Repo/pull/42/',
      `${URL}/files?diff=split#diff-1`, `${URL}/commits`, `${URL}?query=value#issuecomment-123`]) {
      expect(parsePullRequestReference(input)).toEqual(reference)
    }
  })

  it('rejects unsafe hosts, URL normalization, options, and invalid PR numbers before spawning gh', async () => {
    const { runner, execFile } = fixture()
    for (const input of ['http://github.com/example/repo/pull/42', 'https://github.com.evil.test/example/repo/pull/42',
      'https://user@github.com/example/repo/pull/42', 'https://github.com:443/example/repo/pull/42', 'https://github.com:444/example/repo/pull/42',
      'https://github.com/example/../example/repo/pull/42', 'https://github.com/example/%2e%2e/example/repo/pull/42',
      'https://github.com/example/repo%2Fother/pull/42', `${URL}/checks`, 'https://github.com/example/repo/pull/0',
      'example/repo#2147483648', 'example/repo#9007199254740992', 'example/..#42', '--hostname/evil#42', 'example/repo#42\n--jq']) {
      await expect(readPullRequestDetails(input, runner, signal())).rejects.toThrow()
    }
    expect(execFile).not.toHaveBeenCalled()
  })
})

describe('pull request GitHub reader', () => {
  it('reads native summary, check details, discussion and thread previews through the shared runner', async () => {
    const { runner, execFile } = fixture()
    const requestSignal = signal()
    const details = await readPullRequestDetails('example/repo#42', runner, requestSignal)
    expect(details).toMatchObject({ repository: 'example/repo', number: 42, state: 'OPEN', author: account,
      branch: 'glass', baseBranch: 'main', headRepository: 'contributor/repo', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), review: 'CHANGES_REQUESTED', checks: 'FAILURE',
      additions: 25, deletions: 7, changedFiles: 3, unresolvedThreads: 1, moreThreads: false,
      body: '# Summary\n\nKeeps the glass light.', checksList: [
        { id: 'check-1', name: 'Tests', status: 'COMPLETED', conclusion: 'FAILURE', url: 'https://buildkite.com/example/builds/1' },
        { id: 'context-1', name: 'Lint', status: 'COMPLETED', conclusion: 'SUCCESS', url: null },
      ], comments: [{ id: 'comment-1', body: 'Comment comment-1' }], threads: [{ id: 'thread-1', line: 10 }, { id: 'thread-2', line: null }] })
    expect(parsePullRequestDetails(details as unknown as JsonValue)).toEqual(details)
    const [file, args, options] = execFile.mock.calls[0]!
    expect(file).toBe('gh')
    expect(args.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'github.com'])
    expect(args.slice(-6)).toEqual(['-f', 'owner=example', '-f', 'name=repo', '-F', 'number=42'])
    expect(args.join(' ')).not.toContain('mutation')
    expect(options).toMatchObject({ signal: requestSignal, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: { GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GH_PAGER: 'cat' } })
  })

  it('retains bounded connection flags instead of implying complete checks or resolved threads', async () => {
    const value = pr()
    const { runner } = fixture({ data: { repository: { pullRequest: pr({
      comments: page([comment()], true), reviewThreads: page([{ id: 'thread-1', path: 'file.ts', line: null,
        isResolved: false, isOutdated: true, comments: page([comment()], true) }], true),
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: page([], true) } } }] },
    }) } } })
    expect(await readPullRequestDetails(URL, runner, signal())).toMatchObject({ moreComments: true, moreChecks: true,
      moreThreads: true, unresolvedThreads: 1, threads: [{ moreComments: true }] })
    value.comments = page(Array.from({ length: 31 }, (_, i) => comment(`comment-${i}`)))
    await expect(readPullRequestDetails(URL, fixture({ data: { repository: { pullRequest: value } } }).runner, signal())).rejects.toThrow('incomplete')
  })

  it.each(['CLOSED', 'MERGED'])('keeps %s PRs readable when the fork, author or head was deleted', async (state) => {
    const { runner } = fixture({ data: { repository: { pullRequest: pr({ state, author: null, headRepository: null,
      headRefName: null, headRefOid: null, commits: { nodes: [] }, comments: page(), reviewThreads: page() }) } } })
    expect(await readPullRequestDetails(URL, runner, signal())).toMatchObject({ state, author: null, headRepository: null,
      branch: '', headSha: '', checks: null, checksList: [], comments: [], threads: [] })
  })

  it('rejects partial, missing, malformed and mismatched GitHub responses', async () => {
    for (const value of [{ errors: [{ message: 'Unavailable' }], data: { repository: { pullRequest: pr() } } },
      { data: { repository: null } }, { data: { repository: { pullRequest: null } } }, {}, '{',
      { data: { repository: { pullRequest: pr({ repository: { nameWithOwner: 'other/repo' } }) } } },
      { data: { repository: { pullRequest: pr({ url: 'https://github.com/other/repo/pull/42' }) } } }]) {
      await expect(readPullRequestDetails(URL, fixture(value).runner, signal())).rejects.toThrow()
    }
    expect(() => parsePullRequestDetails({ id: 'partial' })).toThrow('invalid pull request')
  })

  it('never passes unsafe response URLs through to rendered anchors', async () => {
    const { runner } = fixture({ data: { repository: { pullRequest: pr({
      author: { ...account, url: 'javascript:alert(1)' }, comments: page([comment('unsafe', { url: 'data:text/html,<script>' })]),
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: page([
        { __typename: 'CheckRun', id: 'check', name: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'http://unsafe.test' },
      ]) } } }] },
    }) } } })
    expect(await readPullRequestDetails(URL, runner, signal())).toMatchObject({ author: { url: 'https://github.com' },
      comments: [{ url: URL }], checksList: [{ url: null }] })
  })

  it('propagates cancellation before and after the runner and gives actionable auth errors', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Pane closed'))
    const first = fixture()
    await expect(readPullRequestDetails(URL, first.runner, controller.signal)).rejects.toThrow('Pane closed')
    expect(first.execFile).not.toHaveBeenCalled()
    const second = fixture()
    const during = new AbortController()
    second.execFile.mockImplementationOnce(async () => { during.abort(new Error('Disposed')); return { stdout: '{}', stderr: '' } })
    await expect(readPullRequestDetails(URL, second.runner, during.signal)).rejects.toThrow('Disposed')
    const failed = fixture()
    failed.execFile.mockRejectedValueOnce(new Error('private token-like stderr should not leak'))
    await expect(readPullRequestDetails(URL, failed.runner, signal())).rejects.toThrow('gh auth status --hostname github.com')
  })
})

describe('pull request diffs and ownership', () => {
  const patch = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n'
  it('loads the complete remote diff lazily without checking out or modifying a local repository', async () => {
    const { runner, execFile } = fixture(patch)
    const document = await readPullRequestDiff(`${URL}/files`, runner, signal(), '/local/workspace')
    expect(document).toMatchObject({ title: 'example/repo #42', workspace: '/local/workspace', patch })
    expect(execFile.mock.calls[0]?.[1]).toEqual(['api', '--hostname', 'github.com', 'repos/example/repo/pulls/42', '--header', 'Accept: application/vnd.github.diff'])
    expect(execFile.mock.calls[0]?.[2]).toMatchObject({ maxBuffer: 20 * 1024 * 1024 })
    expect(execFile.mock.calls[0]?.[2]).not.toHaveProperty('cwd')
    expect((await readPullRequestDiff(URL, fixture(patch).runner, signal())).id).toBe(document.id)
    expect((await readPullRequestDiff(URL, fixture(`${patch}\n`).runner, signal())).id).not.toBe(document.id)
  })

  it('supports empty and binary patches while refusing unsupported or oversized responses', async () => {
    expect((await readPullRequestDiff(URL, fixture('').runner, signal())).patch).toBe('')
    const binary = 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n'
    expect((await readPullRequestDiff(URL, fixture(binary).runner, signal())).patch).toBe(binary)
    await expect(readPullRequestDiff(URL, fixture('<html>Error</html>').runner, signal())).rejects.toThrow('supported diff')
    await expect(readPullRequestDiff(URL, fixture('x'.repeat(20 * 1024 * 1024 + 1)).runner, signal())).rejects.toThrow('20 MB limit')
    const failed = fixture()
    failed.execFile.mockRejectedValueOnce(Object.assign(new Error('maxbuffer'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }))
    await expect(readPullRequestDiff(URL, failed.runner, signal())).rejects.toThrow('20 MB limit')
  })

  it('registers only read methods and aborts outstanding work when its owning plugin is disposed', async () => {
    const methods = new Map<string, ClientExtensionHandler>()
    const dispose: Array<() => void> = []
    let requestSignal: AbortSignal | undefined
    const runner: ProcessRunnerService = { execFile: vi.fn(async (_file, _args, options) => {
      requestSignal = options?.signal
      return new Promise<ProcessOutput>((_resolve, reject) => requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true }))
    }) }
    const ctx = {
      processRunner: runner, effect: (effect: () => () => void) => dispose.push(effect()),
      clientExtensions: { registerMethod: (_owner: unknown, name: string, handler: ClientExtensionHandler) => methods.set(name, handler) },
    }
    ;(pullRequestPane as (ctx: HarnessContext) => void)(ctx as unknown as HarnessContext)
    expect([...methods.keys()]).toEqual([PULL_REQUEST_READ_METHOD, PULL_REQUEST_DIFF_METHOD])
    for (const payload of [undefined, null, {}, { resource: 42 }]) await expect(methods.get(PULL_REQUEST_READ_METHOD)!(payload)).rejects.toThrow('needs a GitHub')
    const pending = Promise.resolve(methods.get(PULL_REQUEST_READ_METHOD)!({ resource: URL }))
    expect(requestSignal?.aborted).toBe(false)
    dispose.forEach((close) => close())
    await expect(pending).rejects.toThrow()
    expect(requestSignal?.aborted).toBe(true)
  })
})
