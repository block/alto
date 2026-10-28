import type { BrowserPlugin } from '../../src/client/plugin-api.js'
import tokens from './ui/appearance-tokens.css'
import controls from './ui/controls.css'
import surfaces from './ui/surfaces.css'
import reviewAnnotations from './ui/review-annotations.css'
import geometry from './ui/geometry.css'

const interfaceAppearance: BrowserPlugin = (ctx) => {
  ctx.clientUi.registerStyle(ctx, 'interface-appearance-tokens', String(tokens))
  ctx.clientUi.registerStyle(ctx, 'interface-controls', String(controls))
  ctx.clientUi.registerStyle(ctx, 'interface-surfaces', String(surfaces))
  ctx.clientUi.registerStyle(ctx, 'interface-review-annotations', String(reviewAnnotations))
  ctx.clientUi.registerStyle(ctx, 'interface-geometry', String(geometry))
}

interfaceAppearance.inject = ['clientUi']

export default interfaceAppearance
