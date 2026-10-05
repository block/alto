import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  SidebarController,
  sidebarWidthBounds,
} from '../program/plugins/sidebar.client.js'

describe('sidebar resizing', () => {
  it('uses restrained defaults', () => {
    expect(sidebarWidthBounds()).toEqual({ min: 196, max: 420 })
    expect(clampSidebarWidth(120, sidebarWidthBounds())).toBe(196)
    expect(clampSidebarWidth(600, sidebarWidthBounds())).toBe(420)
  })

  it('stops growing before it starves the conversation', () => {
    expect(sidebarWidthBounds({}, {
      currentWidth: 246,
      conversationWidth: 560,
    })).toEqual({ min: 196, max: 420 })
    expect(sidebarWidthBounds({}, {
      currentWidth: 246,
      conversationWidth: 430,
    })).toEqual({ min: 196, max: 316 })
    expect(sidebarWidthBounds({}, {
      currentWidth: 420,
      conversationWidth: 330,
    })).toEqual({ min: 196, max: 390 })
  })

  it('honors plugin configuration', () => {
    expect(sidebarWidthBounds({
      minWidth: 210,
      maxWidth: 480,
      minConversationWidth: 400,
    }, {
      currentWidth: 250,
      conversationWidth: 500,
    })).toEqual({ min: 210, max: 350 })
  })

  it('moves between hidden, floating, and pinned states', () => {
    const sidebar = new SidebarController()
    let notifications = 0
    const unsubscribe = sidebar.subscribe(() => notifications += 1)

    expect(sidebar.snapshot()).toEqual({
      revision: 0,
      mode: 'hidden',
      collapsed: true,
      pinned: false,
      workspaceKey: 'default',
    })
    sidebar.toggle()
    expect(sidebar.snapshot()).toMatchObject({ revision: 1, mode: 'pinned', collapsed: false, pinned: true })
    sidebar.toggle()
    expect(sidebar.snapshot()).toMatchObject({ revision: 2, mode: 'hidden', collapsed: true, pinned: false })
    sidebar.setCollapsed(false)
    expect(sidebar.snapshot()).toMatchObject({ revision: 3, mode: 'floating', collapsed: false })
    sidebar.toggle()
    expect(sidebar.snapshot()).toMatchObject({ revision: 4, mode: 'pinned', pinned: true })
    sidebar.setPinned(false)
    expect(sidebar.snapshot()).toMatchObject({ revision: 5, mode: 'floating', pinned: false })
    sidebar.activateWorkspace('workspace-b')
    expect(sidebar.snapshot()).toMatchObject({
      revision: 6,
      mode: 'hidden',
      pinned: false,
      workspaceKey: 'workspace-b',
    })
    sidebar.setPinned(true)
    expect(sidebar.snapshot()).toMatchObject({ revision: 7, mode: 'pinned', pinned: true })
    sidebar.activateWorkspace('workspace-c')
    expect(sidebar.snapshot()).toMatchObject({
      revision: 8,
      mode: 'pinned',
      pinned: true,
      workspaceKey: 'workspace-c',
    })
    expect(notifications).toBe(8)

    unsubscribe()
    sidebar.dispose()
  })

  it('orders plugin actions and removes them with their fibers', async () => {
    const context = new Context()
    const sidebar = new SidebarController()
    const Later = () => null
    const Earlier = () => null
    const laterFiber = await context.plugin((ctx) => {
      sidebar.registerAction(ctx, { id: 'later', order: 200, renderer: Later })
    })
    const earlierFiber = await context.plugin((ctx) => {
      sidebar.registerAction(ctx, { id: 'earlier', order: 100, renderer: Earlier })
    })

    try {
      expect(sidebar.actions().map((action) => action.id)).toEqual(['earlier', 'later'])

      await earlierFiber.dispose()
      expect(sidebar.actions().map((action) => action.id)).toEqual(['later'])
    } finally {
      await laterFiber.dispose()
      sidebar.dispose()
    }
  })
})
