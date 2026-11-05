import { Context } from 'cordis'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ClientUiRegistry } from '../src/client/plugin-runtime.js'
import diffViewerClient from '../program/plugins/diff-viewer.client.js'
import {
  diffReviewPaneRequest,
  diffReviewItems,
  openDiffReview,
  reviewPrompt,
  type DiffReviewOverlayRequest,
  type ReviewComment,
} from '../program/plugins/diff-viewer.client.js'
import { sendReviewComments } from '../program/plugins/diff-review-comments.js'
import { openGitDiffPane } from '../program/plugins/git-pane-status.client.js'
import {
  DIFF_CONTENT_COMPONENT,
  type DiffContentProps,
  type DiffReviewDocument,
} from '../program/plugins/diff-viewer-api.js'

const document: DiffReviewDocument = {
  id: 'review-1',
  title: 'Review changes',
  workspace: '/tmp/project',
  threadId: 'thread-1',
  patch: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new',
  createdAt: '2026-08-22T20:00:00.000Z',
}

describe('diff viewer client', () => {
  it('sends a remote PR review without a thread ID to a chat in its own workspace', async () => {
    const wrong = { snapshot: () => ({ turn: { tag: 'idle' } }), send: vi.fn(), steer: vi.fn() }
    const intended = { snapshot: () => ({ threadId: 'thread-a', turn: { tag: 'idle' } }), send: vi.fn(), steer: vi.fn() }
    const submit = vi.fn(async (_draft: unknown, send: () => Promise<void>) => send())
    const layout = {
      paneTargets: () => [
        { workspaceId: 'unrelated-workspace', paneId: 'blank-chat', focused: true, session: wrong },
        { workspaceId: 'pr-workspace', paneId: 'chat-a', focused: false, session: intended },
      ], focusPane: vi.fn(),
    }
    const { threadId: _threadId, ...remoteDocument } = document
    await sendReviewComments({ submit } as never, layout as never, remoteDocument, 'pr-workspace', [{
      id: 'note', itemId: 'file', path: 'a.ts', side: 'additions', start: 1, end: 1,
      body: 'Keep the validation.', createdAt: document.createdAt,
    }])
    expect(wrong.send).not.toHaveBeenCalled()
    expect(intended.send).toHaveBeenCalledOnce()
    expect(layout.focusPane).toHaveBeenCalledExactlyOnceWith('pr-workspace', 'chat-a')
  })

  it('shares the diff content renderer with other panes and removes it with its owner', async () => {
    const context = new Context()
    const ui = new ClientUiRegistry()
    const call = vi.fn()
    const explorerState = { revision: 0 }
    context.provide('clientUi', ui)
    context.provide('clientHost', { call } as never)
    context.provide('clientCodeExplorer', {
      subscribe: () => () => undefined,
      snapshot: () => explorerState,
    } as never)
    context.provide('clientWorkspaceLayout', {
      registerPaneKind: vi.fn(),
      paneTargets: () => [],
    } as never)
    const fiber = await context.plugin(diffViewerClient, {})
    try {
      const Content = ui.component<DiffContentProps>(DIFF_CONTENT_COMPONENT)
      expect(Content).toBeDefined()
      expect(diffViewerClient.resources?.provides?.components).toContain(DIFF_CONTENT_COMPONENT)
      const render = (patch: string, refreshing = false) => renderToStaticMarkup(createElement(Content!, {
        document: { ...document, title: 'Review pull request #42', patch },
        workspaceId: 'workspace-1',
        visible: true,
        onRefresh: () => undefined,
        refreshing,
      }))
      const html = render(document.patch)
      expect(html).toContain('Review pull request #42')
      expect(html).toContain('diff-viewer-code')
      expect(html).toContain('aria-label="Diff layout"')
      expect(html).toContain('aria-label="Refresh diff"')
      expect(html).not.toContain('Choose diff revision')
      expect(html).not.toContain('Working tree')
      expect(render('')).toContain('No text changes to display.')
      expect(render(document.patch, true)).toMatch(/aria-label="Refresh diff" disabled=""/u)
      expect(call).not.toHaveBeenCalled()

      await fiber.dispose()
      expect(ui.component(DIFF_CONTENT_COMPONENT)).toBeUndefined()
      expect(ui.rootRenderers()).toEqual([])
    } finally {
      await fiber.dispose()
    }
  })

  it('attaches a review comment to the selected Pierre diff line', () => {
    const itemId = `${document.id}:0:0`
    const comment: ReviewComment = {
      id: 'comment-1',
      itemId,
      path: 'a.ts',
      side: 'additions',
      start: 1,
      end: 1,
      body: 'Keep the old behavior here.',
      createdAt: '2026-08-22T20:01:00.000Z',
    }

    expect(diffReviewItems(document, [comment], 1)[0]).toMatchObject({
      id: itemId,
      annotations: [{
        side: 'additions',
        lineNumber: 1,
        metadata: comment,
      }],
    })
  })

  it('shares annotations by file path across Diff Review and Code Tour item ids', () => {
    const comment: ReviewComment = {
      id: 'comment-1',
      itemId: 'tour-stop:0:a.ts',
      path: 'a.ts',
      side: 'additions',
      start: 1,
      end: 1,
      body: 'Keep the old behavior here.',
      createdAt: '2026-08-22T20:01:00.000Z',
    }

    expect(diffReviewItems(document, [comment], 1)[0]).toMatchObject({
      annotations: [{ metadata: comment }],
    })
  })

  it('turns comments into a concrete chat review request', () => {
    const comment: ReviewComment = {
      id: 'comment-1',
      itemId: `${document.id}:0:0`,
      path: 'src/a.ts',
      side: 'deletions',
      start: 4,
      end: 6,
      body: 'Preserve this validation.',
      createdAt: '2026-08-22T20:01:00.000Z',
    }

    expect(reviewPrompt([comment])).toContain('`src/a.ts:4-6` (old lines 4–6)')
    expect(reviewPrompt([comment])).toContain('Preserve this validation.')
  })

  it('opens a review snapshot over the chat without creating a pane', async () => {
    const calls: unknown[] = []
    const overlays: DiffReviewOverlayRequest[] = []
    const session = {
      snapshot: () => ({
        session: { workspace: '/tmp/project' },
        threadId: 'thread-1',
        activeProjectId: 'project-1',
      }),
    }
    const host = {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload })
        return { id: 'review-1', resource: 'review:review-1' }
      },
    }
    const layout = {
      paneTargets: () => [{
        workspaceId: 'workspace-1',
        paneId: 'pane-1',
        focused: true,
        session,
      }],
    }
    const overlay = {
      open: (request: DiffReviewOverlayRequest) => overlays.push(request),
    }

    await openDiffReview('activity-1', [{
      path: '/tmp/project/a.ts',
      kind: 'update',
      diff: '@@ -1 +1 @@\n-old\n+new',
      additions: 1,
      deletions: 1,
    }], session as never, host as never, layout as never, overlay)

    expect(calls).toEqual([{
      method: 'diff-viewer.create',
      payload: {
        title: 'Review changes',
        workspace: '/tmp/project',
        threadId: 'thread-1',
        activityId: 'activity-1',
        files: [{
          path: '/tmp/project/a.ts',
          kind: 'update',
          diff: '@@ -1 +1 @@\n-old\n+new',
        }],
      },
    }])
    expect(overlays).toEqual([{
      activityId: 'activity-1',
      reviewId: 'review-1',
      resource: 'review:review-1',
      workspace: '/tmp/project',
      workspaceId: 'workspace-1',
      anchorPaneId: 'pane-1',
      threadId: 'thread-1',
      projectId: 'project-1',
    }])
    expect(diffReviewPaneRequest(overlays[0]!)).toEqual({
      direction: 'horizontal',
      kind: 'diff-viewer',
      resource: 'review:review-1',
      anchorThreadId: 'thread-1',
      workspace: '/tmp/project',
      projectId: 'project-1',
    })
  })

  it('sends tour comments to the thread that opened the review', async () => {
    const submitted: unknown[] = []
    const focused: string[] = []
    const sent: unknown[] = []
    const origin = {
      snapshot: () => ({ threadId: 'thread-1', turn: { tag: 'idle' } }),
      send: async (draft: unknown) => { sent.push(draft) },
      steer: async () => undefined,
    }
    const other = {
      snapshot: () => ({ threadId: 'thread-2', turn: { tag: 'idle' } }),
      send: async () => undefined,
      steer: async () => undefined,
    }
    const layout = {
      paneTargets: () => [
        { workspaceId: 'workspace-1', paneId: 'origin-pane', focused: false, session: origin },
        { workspaceId: 'workspace-1', paneId: 'tour-pane', focused: true, session: other },
      ],
      focusPane: (_workspaceId: string, paneId: string) => { focused.push(paneId); return true },
    }
    const ui = {
      submit: async (draft: unknown, next: () => Promise<void>, request: unknown) => {
        submitted.push({ draft, request })
        await next()
      },
    }
    const comment: ReviewComment = {
      id: 'comment-1',
      itemId: 'tour-stop:0:a.ts',
      path: 'a.ts',
      side: 'additions',
      start: 1,
      end: 1,
      body: 'Please keep this guard.',
      createdAt: '2026-08-22T20:01:00.000Z',
    }

    await sendReviewComments(ui as never, layout as never, document, 'workspace-1', [comment])

    expect(submitted).toEqual([expect.objectContaining({
      request: expect.objectContaining({
        mode: 'queue',
        target: expect.objectContaining({ threadId: 'thread-1' }),
      }),
    })])
    expect(sent).toHaveLength(1)
    expect(focused).toEqual(['origin-pane'])
  })

  it('opens the selected checkout diff beside its originating chat', () => {
    const panes: unknown[] = []
    const thread = {
      id: 'thread-1',
      title: 'Fix the parser',
      preview: 'Fix the parser',
      cwd: '/tmp/project-worktree',
      createdAt: 1,
      updatedAt: 2,
    }

    openGitDiffPane({
      openPane: (request: unknown) => {
        panes.push(request)
        return { workspaceId: 'workspace-1', paneId: 'pane-2' }
      },
    }, '/tmp/project-worktree', thread.id, thread, 'project-1')

    expect(panes).toEqual([{
      direction: 'horizontal',
      kind: 'diff-viewer',
      workspace: '/tmp/project-worktree',
      anchorThreadId: 'thread-1',
      thread,
      projectId: 'project-1',
    }])
  })
})
