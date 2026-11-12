import { Context, type Plugin } from 'cordis'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TerminalTabAccessory } from '../program/plugins/ghostty-terminal-api.js'
import { PaneTabsRegistry } from '../program/plugins/pane-tabs.client.js'
import { TerminalTabAccessories } from '../program/plugins/terminal-launchers.js'

describe('tab accessories', () => {
  it('draws an accessory after the title of its pane tab only', () => {
    const Tabs = new PaneTabsRegistry().renderer
    const markup = renderToStaticMarkup(
      <Tabs
        tabs={[
          { id: 'one', title: 'One', accessory: <i data-testid="badge" /> },
          { id: 'two', title: 'Two' },
        ]}
        activeId="one"
        label="Terminals"
        createLabel="New terminal"
        activate={() => undefined}
        create={() => undefined}
        close={() => undefined}
      />,
    )

    expect(markup).toContain('<span>One</span><span class="pane-tab-accessory"><i data-testid="badge"></i></span>')
    expect(markup).toContain('<span>Two</span></button>')
    expect(markup.match(/pane-tab-accessory/gu)).toHaveLength(1)
  })

  it('orders terminal tab accessories and removes them with their owners', async () => {
    const context = new Context()
    const accessories = new TerminalTabAccessories()
    const late: TerminalTabAccessory = { id: 'late', order: 2, renderer: () => null }
    const early: TerminalTabAccessory = { id: 'early', order: 1, renderer: () => null }
    let notified = 0
    const unsubscribe = accessories.subscribe(() => { notified += 1 })

    const lateFiber = await context.plugin(((owner) => { accessories.register(owner, late) }) as Plugin)
    const earlyFiber = await context.plugin(((owner) => { accessories.register(owner, early) }) as Plugin)
    expect(accessories.snapshot()).toEqual([early, late])
    expect(notified).toBe(2)

    await lateFiber.dispose()
    expect(accessories.snapshot()).toEqual([early])
    await earlyFiber.dispose()
    expect(accessories.snapshot()).toEqual([])
    unsubscribe()
  })

  it('rejects a second terminal tab accessory with the same id', async () => {
    const context = new Context()
    const accessories = new TerminalTabAccessories()
    const accessory: TerminalTabAccessory = { id: 'status', renderer: () => null }
    await context.plugin(((owner) => { accessories.register(owner, accessory) }) as Plugin)

    expect(() => accessories.register(context, { ...accessory })).toThrow(/already registered/u)
    expect(accessories.snapshot()).toEqual([accessory])
  })
})
