import { Context, type Plugin } from 'cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  clientExtensionRegistryPlugin,
  type ClientExtensionStateRegistration,
} from '../src/server/services/client-extension-registry.js'

describe('client extension registry', () => {
  it('removes plugin methods and state with the owning fiber', async () => {
    const ctx = new Context()
    const registryFiber = await ctx.plugin(clientExtensionRegistryPlugin)
    const changed = vi.fn()
    ctx.on('clientExtensions/changed', changed)

    let state: ClientExtensionStateRegistration | undefined
    const feature: Plugin = (owner) => {
      owner.clientExtensions.registerMethod(owner, 'counter.increment', (payload) => {
        const amount = typeof payload === 'number' ? payload : 1
        return { value: amount + 1 }
      })
      state = owner.clientExtensions.registerState(owner, 'counter', { value: 1 })
    }
    feature.inject = ['clientExtensions']

    const featureFiber = await ctx.plugin(feature)
    expect(ctx.clientExtensions.describe()).toEqual({
      methods: [{ name: 'counter.increment', owner: expect.any(String) }],
      states: [{ name: 'counter', owner: expect.any(String) }],
    })
    expect(ctx.clientExtensions.snapshot()).toEqual({ counter: { value: 1 } })
    expect(changed).toHaveBeenLastCalledWith({ counter: { value: 1 } }, 'counter')
    await expect(ctx.clientExtensions.call('counter.increment', 4)).resolves.toEqual({ value: 5 })

    state?.update({ value: 2 })
    expect(ctx.clientExtensions.snapshot()).toEqual({ counter: { value: 2 } })
    expect(changed).toHaveBeenLastCalledWith({ counter: { value: 2 } }, 'counter')

    await featureFiber.dispose()
    expect(ctx.clientExtensions.snapshot()).toEqual({})
    expect(changed).toHaveBeenLastCalledWith({}, 'counter')
    expect(ctx.clientExtensions.describe()).toEqual({ methods: [], states: [] })
    await expect(ctx.clientExtensions.call('counter.increment', 1))
      .rejects.toThrow('unknown client extension method')

    await registryFiber.dispose()
  })

  it('identifies the changed key while preserving full snapshots for server subscribers', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(clientExtensionRegistryPlugin)
    const changed = vi.fn()
    ctx.on('clientExtensions/changed', changed)
    const saved = ctx.clientExtensions.registerState(ctx, 'saved', { text: 'Retained chat' })
    const progress = ctx.clientExtensions.registerState(ctx, 'progress', null)
    try {
      expect(changed).toHaveBeenLastCalledWith({ saved: { text: 'Retained chat' }, progress: null }, 'progress')
      progress.update({ value: 1 })
      expect(changed).toHaveBeenLastCalledWith({ saved: { text: 'Retained chat' }, progress: { value: 1 } }, 'progress')
      await progress.dispose()
      expect(changed).toHaveBeenLastCalledWith({ saved: { text: 'Retained chat' } }, 'progress')
      const replacement = ctx.clientExtensions.registerState(ctx, 'progress', null)
      expect(changed).toHaveBeenLastCalledWith({ saved: { text: 'Retained chat' }, progress: null }, 'progress')
      await replacement.dispose()
    } finally {
      await progress.dispose()
      await saved.dispose()
      await fiber.dispose()
    }
  })
})
