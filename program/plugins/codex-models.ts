import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import type { CodexModelRoute } from '../../src/server/services/codex-service.js'

/** Declarative native Codex routes; credentials remain in Codex's auth configuration. */
const codexModels: HarnessPlugin<{ routes: CodexModelRoute[] }> = (ctx, options) => {
  // The server transport is not hot-reloadable. A profile can be installed
  // before a desktop restart without replacing the running native sessions.
  if (typeof ctx.codex.registerModelRoute !== 'function') return
  for (const route of options.routes ?? []) {
    ctx.effect(() => ctx.codex.registerModelRoute(route), `model:${route.modelProvider}`)
  }
}

codexModels.inject = ['codex']
export default codexModels
