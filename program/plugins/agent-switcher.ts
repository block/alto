import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { AGENT_SWITCHER_TOGGLE } from './agent-switcher-api.js'

const agentSwitcher: HarnessPlugin = (ctx) => {
  ctx.ui.register(ctx, {
    id: AGENT_SWITCHER_TOGGLE,
    slot: 'header-right',
    order: 980,
    nodes: [],
  })
}

agentSwitcher.inject = ['ui']

export default agentSwitcher

