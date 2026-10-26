import type { Context } from 'cordis'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { ClientContributionProps, ClientSurfaceProps } from '../src/client/plugin-api.js'
import uiSurfacesClient from '../program/plugins/ui-surfaces.client.js'

type SurfaceRenderer = (props: ClientSurfaceProps) => ReactElement<{
  program: unknown
  togglePlugin: (id: string, enabled: boolean) => Promise<unknown>
}>

it('keeps published renderers usable after their plugin context becomes inactive', async () => {
  const command = vi.fn().mockResolvedValue(undefined)
  const program = {}
  const surfaces = new Map<string, SurfaceRenderer>()
  let contribution: ((props: ClientContributionProps) => ReactElement) | undefined
  let active = true
  const context = new Proxy({
    clientHost: { command },
    clientProgram: program,
    clientSession: {},
    clientMarkdown: {},
    clientUi: {
      overlays: {},
      registerStyle: vi.fn(),
      registerComponent: vi.fn(),
      registerSurface: (_owner: unknown, id: string, renderer: SurfaceRenderer) => {
        surfaces.set(id, renderer)
      },
      registerContributionRenderer: (_owner: unknown, renderer: typeof contribution) => {
        contribution = renderer
      },
    },
    effect: vi.fn(),
  }, {
    get(target, key, receiver) {
      if (!active && typeof key === 'string' && key.startsWith('client')) {
        throw new Error(`Cannot read ${key} from an inactive context`)
      }
      return Reflect.get(target, key, receiver)
    },
  })
  const install = uiSurfacesClient as (ctx: Context) => void
  install(context as unknown as Context)

  // A host update can render the published components while the replacement
  // fiber is still activating. The old context no longer permits service reads.
  active = false
  expect(contribution).toBeDefined()
  expect(renderToStaticMarkup(contribution!({
    contribution: { id: 'test', nodes: [{ type: 'text', text: 'Still available' }] },
  }))).toContain('Still available')

  for (const id of ['default-settings', 'default-plugins']) {
    const rendered = surfaces.get(id)!({ surface: { id, kind: 'settings' } })
    expect(rendered.props.program).toBe(program)
    await rendered.props.togglePlugin('example', false)
  }
  expect(command).toHaveBeenCalledTimes(2)
  expect(command).toHaveBeenCalledWith('program.plugin.setEnabled', { id: 'example', enabled: false })
})
