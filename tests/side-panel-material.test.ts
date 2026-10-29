import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('side panel material', () => {
  it('shares panel surface roles while keeping visibility independent of material', async () => {
    const [theme, sidebar, agents, pullRequests, surfaces] = await Promise.all(
      ['theme', 'sidebar', 'orchestrator', 'pull-requests', 'ui/surfaces'].map((name) =>
        readFile(new URL(`../program/plugins/${name}.css`, import.meta.url), 'utf8'),
      ),
    )

    expect(theme).toContain('--side-panel-background: color-mix(in srgb, var(--sidebar-material) 50%, transparent);')
    expect(theme).toContain('--side-panel-backdrop: blur(32px) saturate(112%);')
    expect(sidebar).toContain('background: var(--ui-surface);')
    for (const css of [agents, pullRequests]) {
      expect(css).toContain('--alto-floating-panel-background: var(--ui-surface);')
      expect(css).toContain('--alto-floating-panel-backdrop: none;')
    }
    expect(surfaces).toContain('background: var(--ui-surface);')
    expect(surfaces).toContain('backdrop-filter: none;')
    for (const css of [sidebar, agents, pullRequests]) {
      expect(css).not.toContain('--side-panel-')
      expect(css).toMatch(/opacity:\s*0;[^}]*pointer-events:\s*none;/)
    }
    expect(sidebar).toMatch(/html\[data-sidebar-mode='pinned'\][\s\S]*?opacity: 1;/)
    expect(agents).toMatch(/\.agents-panel\.is-open\s*\{\s*opacity: 1;/)
  })
})
