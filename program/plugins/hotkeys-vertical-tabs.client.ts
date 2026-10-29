import type { Plugin } from 'cordis'
import './vertical-tabs-api.js'

const hotkeysVerticalTabs: Plugin = (ctx) => {
  ctx.clientHotkeys.registerAction(ctx, {
    id: 'panel.vertical-tabs.toggle',
    label: 'Toggle vertical tabs',
    detail: 'Collapse the side tab column to icons, or expand it again.',
    category: 'Panels',
    binding: { kind: 'global', key: 'b', meta: true },
    enabled: () => ctx.clientVerticalTabs.snapshot().orientation === 'vertical',
    run: () => ctx.clientVerticalTabs.toggleCollapsed(),
  })

  ctx.clientHotkeys.registerAction(ctx, {
    id: 'workspace.tabs.orientation.toggle',
    label: 'Switch tab orientation',
    detail: 'Move workspace tabs between the top bar and the side column.',
    category: 'Workspace',
    binding: {
      kind: 'leader',
      prefix: [{ key: 'w', label: 'Workspaces' }],
      key: 'v',
    },
    aliases: [{ kind: 'global', key: 'b', meta: true, shift: true }],
    run: () => ctx.clientVerticalTabs.toggleOrientation(),
  })
}

hotkeysVerticalTabs.inject = ['clientHotkeys', 'clientVerticalTabs']

export default hotkeysVerticalTabs
