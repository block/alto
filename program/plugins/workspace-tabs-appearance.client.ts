import type { BrowserPlugin } from '../../src/client/plugin-api.js'
import styles from './workspace-tabs-appearance.css'

const workspaceTabsAppearance: BrowserPlugin = (ctx) => {
  ctx.clientUi.registerStyle(ctx, 'workspace-tabs-appearance', String(styles))
}

workspaceTabsAppearance.inject = ['clientUi']

export default workspaceTabsAppearance
