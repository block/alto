import { Context, type Plugin } from 'cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import promptLayer from '../program/plugins/prompt-layer.js'
import { turnProgramPlugin } from '../src/server/services/turn-program.js'
import { uiRegistryPlugin, type UiShellRegistration } from '../src/server/services/ui-registry.js'

describe('Cordis prompt guidance', () => {
  it('preserves authoring guidance and live slots within the app-server entry limit', async () => {
    const ctx = new Context()
    const uiFiber = await ctx.plugin(uiRegistryPlugin)
    const turnFiber = await ctx.plugin(turnProgramPlugin)
    const shell: Plugin = (owner) => {
      owner.ui.registerShell(owner, {
        id: 'guidance-shell',
        root: {
          type: 'box',
          children: [
            {
              type: 'slot',
              name: 'header-right',
              presentation: 'inline',
              direction: 'row',
            },
            {
              type: 'slot',
              name: 'main',
              presentation: 'plain',
              direction: 'column',
              grow: true,
              scroll: 'y',
            },
            { type: 'outlet', name: 'sidebar' },
          ],
        },
      })
    }
    shell.inject = ['ui']
    const shellFiber = await ctx.plugin(shell)
    const promptFiber = await ctx.plugin(promptLayer, { context: 'Base Cordis context.' })

    const prepared = await ctx.turnProgram.prepare({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Add a widget.' }],
    })
    const guidance = Object.entries(prepared.additionalContext ?? {})
      .filter(([key]) => key.startsWith('cordis_authoring'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, entry]) => entry.value).join('')
    for (const entry of Object.values(prepared.additionalContext ?? {})) {
      expect(Buffer.byteLength(entry.value, 'utf8')).toBeLessThanOrEqual(4_000)
    }
    expect(prepared.additionalContext?.cordis_program?.value).toBe('Base Cordis context.')
    expect(prepared.additionalContext?.cordis_shell?.value).toContain(
      'header-right: inline, row',
    )
    expect(prepared.additionalContext?.cordis_shell?.value).toContain(
      'main: plain, column, grows, scroll=y',
    )
    expect(guidance).toContain(
      'Guard async work so it cannot call registration.update() after disposal.',
    )
    expect(guidance).toContain(
      'It must not enlarge its parent header',
    )
    expect(guidance).toContain(
      'Slots are the clean default for small additive widgets, not a capability boundary.',
    )
    expect(guidance).toContain(
      'Set its capabilities array from skills, markdown, images, and files',
    )
    expect(guidance).toContain(
      '{ type: "contribution", id, presentation }',
    )
    expect(prepared.additionalContext?.cordis_shell?.value).toContain(
      'sidebar: exclusive shell region',
    )
    expect(guidance).toContain(
      'ctx.ui.registerShellRegion',
    )
    expect(guidance).toContain(
      'ctx.clientUi.registerSurface',
    )
    expect(guidance).toContain(
      'ctx.clientUi.registerStyle',
    )
    expect(guidance).toContain(
      'Do not add feature switches',
    )
    expect(guidance).toContain(
      'ctx.clientExtensions.registerState/registerMethod',
    )
    expect(guidance).toContain(
      'default clientSession projection is a replaceable browser plugin',
    )

    await promptFiber.dispose()
    await shellFiber.dispose()
    await turnFiber.dispose()
    await uiFiber.dispose()
  })

  it.each([
    'x'.repeat(4_000),
    'x'.repeat(4_001),
    '😀'.repeat(1_001) + '\n' + '界'.repeat(1_500) + '\nfinal instruction',
  ])('preserves long configured context without splitting UTF-8 characters (%#)', async (context) => {
    const ctx = new Context()
    const uiFiber = await ctx.plugin(uiRegistryPlugin)
    const turnFiber = await ctx.plugin(turnProgramPlugin)
    const promptFiber = await ctx.plugin(promptLayer, { context })
    onTestFinished(async () => {
      await promptFiber.dispose()
      await turnFiber.dispose()
      await uiFiber.dispose()
    })

    const prepared = await ctx.turnProgram.prepare({
      threadId: 'thread-1', input: [{ type: 'text', text: 'Follow the instructions.' }],
      additionalContext: { attachment: { kind: 'untrusted', value: 'Existing attachment.' } },
    })
    const entries = Object.entries(prepared.additionalContext ?? {})
      .filter(([key]) => key.startsWith('cordis_program'))
      .sort(([a], [b]) => a.localeCompare(b))
    expect(entries.map(([, entry]) => entry.value).join('')).toBe(context)
    for (const [, entry] of entries) {
      expect(entry.kind).toBe('application')
      expect(Buffer.byteLength(entry.value, 'utf8')).toBeLessThanOrEqual(4_000)
      expect(Buffer.from(entry.value).toString('utf8')).toBe(entry.value)
    }
    expect(prepared.additionalContext?.attachment).toEqual({ kind: 'untrusted', value: 'Existing attachment.' })
  })

  it('updates a large shell snapshot without changing the static context keys or values', async () => {
    const ctx = new Context()
    const uiFiber = await ctx.plugin(uiRegistryPlugin)
    const turnFiber = await ctx.plugin(turnProgramPlugin)
    let registration!: UiShellRegistration
    const shell: Plugin = (owner) => {
      registration = owner.ui.registerShell(owner, {
        id: 'changing-shell', root: { type: 'box', children: [] },
      })
    }
    shell.inject = ['ui']
    const shellFiber = await ctx.plugin(shell)
    const promptFiber = await ctx.plugin(promptLayer, { context: 'Base Cordis context.' })
    onTestFinished(async () => {
      await promptFiber.dispose()
      await shellFiber.dispose()
      await turnFiber.dispose()
      await uiFiber.dispose()
    })
    const input = { threadId: 'thread-1', input: [{ type: 'text' as const, text: 'Inspect the shell.' }] }
    const before = await ctx.turnProgram.prepare(input)
    const names = Array.from({ length: 90 }, (_, index) => `slot-${index}-with-a-long-name-for-the-snapshot`)
    registration.update({ id: 'changing-shell', root: {
      type: 'box', children: names.map((name) => ({ type: 'slot', name })),
    } })
    const after = await ctx.turnProgram.prepare(input)
    const staticContext = (context: typeof before.additionalContext) => Object.fromEntries(
      Object.entries(context ?? {}).filter(([key]) => !key.startsWith('cordis_shell')),
    )
    expect(staticContext(after.additionalContext)).toEqual(staticContext(before.additionalContext))
    const shellEntries = Object.entries(after.additionalContext ?? {})
      .filter(([key]) => key.startsWith('cordis_shell'))
      .sort(([a], [b]) => a.localeCompare(b))
    const snapshot = shellEntries.map(([, entry]) => entry.value).join('')
    for (const name of names) expect(snapshot).toContain(`- ${name}: cards, column`)
    expect(snapshot).not.toContain('No live slots')
    for (const [, entry] of shellEntries) {
      expect(Buffer.byteLength(entry.value, 'utf8')).toBeLessThanOrEqual(4_000)
    }
  })

})
