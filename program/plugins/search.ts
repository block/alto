import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { searchSurface } from './search-api.js'

const searchPlugin: HarnessPlugin = (ctx) => {
  ctx.ui.registerSurface(ctx, searchSurface)
}

searchPlugin.inject = ['ui']

export default searchPlugin
