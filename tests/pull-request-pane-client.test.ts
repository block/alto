import { afterEach, describe, expect, it, vi } from 'vitest'
import { callPullRequestRead, openPullRequestPane, pullRequestCheckTone, pullRequestLinkResource, pullRequestMarkdownUrl } from '../program/plugins/pull-request-pane.client.js'
import { MarkdownContent } from '../program/plugins/ui/markdown.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PullRequestCheck } from '../program/plugins/pull-request-pane-api.js'
import type { ClientWorkspaceLayoutService } from '../program/plugins/workspace-layout-api.js'

describe('restored PR pane activation', () => {
  afterEach(() => vi.useRealTimers())
  const mismatch = () => new Error('browser program revision 5 is incompatible with server revision 6')
  it('waits for program activation without exposing a transient startup error', async () => {
    vi.useFakeTimers()
    const call = vi.fn().mockRejectedValueOnce(mismatch()).mockResolvedValueOnce({ ready: true })
    const result = callPullRequestRead({ call }, 'pull-request.read', {}, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(99)
    expect(call).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ ready: true })
    expect(call).toHaveBeenCalledTimes(2)
  })
  it('leaves authentication and connection errors actionable without automatic retries', async () => {
    vi.useFakeTimers()
    const call = vi.fn().mockRejectedValue(new Error('Check your GitHub access.'))
    await expect(callPullRequestRead({ call }, 'pull-request.read', {}, new AbortController().signal)).rejects.toThrow('GitHub access')
    expect(call).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels the activation wait when a pane hides, closes, or changes PR', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const call = vi.fn().mockRejectedValue(mismatch())
    const result = callPullRequestRead({ call }, 'pull-request.read', {}, controller.signal)
    const assertion = expect(result).rejects.toThrow('Pane changed')
    await vi.advanceTimersByTimeAsync(1)
    controller.abort(new Error('Pane changed'))
    await assertion
    expect(vi.getTimerCount()).toBe(0)
    expect(call).toHaveBeenCalledOnce()
  })
  it('bounds revision retries rather than waiting forever', async () => {
    vi.useFakeTimers()
    const call = vi.fn().mockRejectedValue(mismatch())
    const result = callPullRequestRead({ call }, 'pull-request.read', {}, new AbortController().signal)
    const assertion = expect(result).rejects.toThrow('incompatible')
    await vi.runAllTimersAsync()
    await assertion
    expect(call).toHaveBeenCalledTimes(7)
  })
})

describe('pull request link routing', () => {
  it.each([
    'https://github.com/block/alto/pull/12',
    'https://github.com/Block/Alto/pull/12/',
    'https://github.com/block/alto/pull/12/files',
    'https://github.com/block/alto/pull/12#discussion_r1',
    'https://github.com/block/alto/pull/12/files#diff-123',
    'https://github.com/block/alto/pull/12?tab=checks',
    'https://github.com/block/alto/pull/12/commits',
    'https://github.com/block/alto/pull/12/commits?tab=activity#commit-123',
  ])('opens supported PR views at their canonical Alto destination: %s', href => {
    expect(pullRequestLinkResource(href)).toBe('https://github.com/block/alto/pull/12')
  })

  it.each([
    'https://github.com/block/alto/pull/12/checks',
    'https://github.com/block/alto/pull/12/checks?tab=checks#check-1',
    'https://github.com/block/alto/issues/12',
    'https://github.com.evil.test/block/alto/pull/12',
    'https://user:secret@github.com/block/alto/pull/12',
    'http://github.com/block/alto/pull/12',
    'https://github.com:443/block/alto/pull/12',
    'javascript:alert(1)', 'https://example.test', 'block/alto#12',
  ])('leaves unsupported or invalid destinations external: %s', href => {
    expect(pullRequestLinkResource(href)).toBeUndefined()
  })

  it('anchors a link to its original chat rather than another focused chat', () => {
    const openPane = vi.fn()
    const layout = {
      openPane,
      paneTargets: () => [{ workspaceId: 'workspace-a', paneId: 'source', session: { snapshot: () => ({ session: { workspace: '/project' }, activeProjectId: 'project-a' }) } }],
    } as unknown as ClientWorkspaceLayoutService
    const origin = { closest: () => ({ dataset: { workspacePaneId: 'source' } }) } as unknown as HTMLElement
    openPullRequestPane(layout, 'https://github.com/block/alto/pull/12', origin)
    expect(openPane).toHaveBeenCalledExactlyOnceWith({
      direction: 'horizontal', kind: 'pull-request', resource: 'https://github.com/block/alto/pull/12',
      anchor: { workspaceId: 'workspace-a', paneId: 'source' }, workspace: '/project', projectId: 'project-a',
    })
  })
})

describe('pull request checks', () => {
  const check = (overrides: Partial<PullRequestCheck>): PullRequestCheck => ({ id: 'check', name: 'Test', status: 'COMPLETED', conclusion: null, url: null, ...overrides })
  it('distinguishes running, failing, passing, and skipped checks', () => {
    expect(pullRequestCheckTone(check({ status: 'IN_PROGRESS' }))).toBe('pending')
    expect(pullRequestCheckTone(check({ conclusion: 'SUCCESS' }))).toBe('success')
    expect(pullRequestCheckTone(check({ conclusion: 'TIMED_OUT' }))).toBe('failure')
    expect(pullRequestCheckTone(check({ conclusion: 'ERROR' }))).toBe('failure')
    expect(pullRequestCheckTone(check({ conclusion: 'SKIPPED' }))).toBe('neutral')
    expect(pullRequestCheckTone(check({ conclusion: 'NEUTRAL' }))).toBe('neutral')
    expect(pullRequestCheckTone(check({ status: 'QUEUED', conclusion: 'PENDING' }))).toBe('pending')
  })
})

describe('GitHub Markdown context', () => {
  const pr = { url: 'https://github.com/block/alto/pull/12', repository: 'block/alto', headRepository: 'contributor/alto', branch: 'feature/sidebar' }
  it('resolves repository links, attachments, fragments, and images without local file handlers', () => {
    const html = renderToStaticMarkup(createElement(MarkdownContent, {
      source: '[Source](/block/alto/blob/main/README.md) [Guide](docs/guide.md) [Comment](#issuecomment-1) ![Preview](preview.png)',
      className: 'activity-markdown', urlTransform: (url, key) => pullRequestMarkdownUrl(url, pr, key),
    }))
    expect(html).toContain('https://github.com/block/alto/blob/main/README.md')
    expect(html).toContain('https://github.com/contributor/alto/blob/feature%2Fsidebar/docs/guide.md')
    expect(html).toContain('https://github.com/block/alto/pull/12#issuecomment-1')
    expect(html).toContain('https://raw.githubusercontent.com/contributor/alto/feature%2Fsidebar/preview.png')
    expect(html).not.toContain('file-citation')
    expect(html).not.toContain('data-file-link-handler')
  })
  it('does not turn remote content into an Alto-specific or executable link', () => {
    expect(pullRequestMarkdownUrl('codex-file-citation:payload', pr)).toBe('')
    expect(pullRequestMarkdownUrl('file:///Users/test/secret', pr)).toBe('')
    expect(pullRequestMarkdownUrl('javascript:alert(1)', pr)).toBe('')
    expect(pullRequestMarkdownUrl('https://example.test/path', pr)).toBe('https://example.test/path')
    expect(pullRequestMarkdownUrl('mailto:reviewer@example.test', pr)).toBe('mailto:reviewer@example.test')
  })
})
