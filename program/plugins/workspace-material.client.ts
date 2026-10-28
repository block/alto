import type { BrowserPlugin } from '../../src/client/plugin-api.js'
import styles from './workspace-material.css'

const workspaceMaterial: BrowserPlugin = (ctx) => {
  ctx.clientUi.registerStyle(ctx, 'workspace-material', String(styles))
}

workspaceMaterial.inject = ['clientUi']

export default workspaceMaterial
