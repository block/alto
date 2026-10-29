import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { clampRailWidth, parseVerticalTabPreferences } from '../program/plugins/vertical-tabs.client.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SquareTerminal } from 'lucide-react'
import { WorkspaceTabIcon } from '../program/plugins/workspace-layout.client.js'

const require = createRequire(import.meta.url)

it('restores bounded vertical tab preferences', () => {
  expect(parseVerticalTabPreferences(undefined)).toEqual({ orientation: 'vertical', width: 232, collapsed: false })
  expect(parseVerticalTabPreferences({ orientation: 'horizontal', width: 9000, collapsed: true }))
    .toEqual({ orientation: 'horizontal', width: 400, collapsed: true })
  expect(parseVerticalTabPreferences({ orientation: 'diagonal', width: 'wide', collapsed: 'yes' }))
    .toEqual({ orientation: 'vertical', width: 232, collapsed: false })
  expect(clampRailWidth(12.4)).toBe(168)
})

it('marks only non-chat tabs with a pane icon', () => {
  const view = (kind: string, name = 'alto review') => ({
    id: 'a', name, workspace: '/repo', focusedPaneId: 'p',
    root: { type: 'pane' as const, id: 'p', workspace: '/repo', kind },
  })
  const kinds = [{ id: 'terminal', label: 'Terminal', icon: SquareTerminal, renderer: () => null }]
  const chat = renderToStaticMarkup(createElement(WorkspaceTabIcon, { view: view('chat'), kinds }))
  expect(chat).not.toContain('<svg')
  expect(chat).toContain('workspace-tab-monogram')
  expect(chat).toContain('>A</i>')
  expect(renderToStaticMarkup(createElement(WorkspaceTabIcon, { view: view('chat', ' 🦀 crab'), kinds }))).toContain('>🦀</i>')
  expect(renderToStaticMarkup(createElement(WorkspaceTabIcon, { view: view('terminal'), kinds }))).toContain('lucide-square-terminal')
  expect(renderToStaticMarkup(createElement(WorkspaceTabIcon, { view: view('unknown'), kinds }))).toContain('<svg')
})

it.skipIf(process.platform !== 'darwin')('moves workspace tabs into a side rail without remounting panes', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/vertical-tabs.cjs'),
  ], { cwd: process.cwd(), env, timeout: 25_000 })
  expect(stdout).toContain('Vertical tab browser checks passed')
}, 30_000)
