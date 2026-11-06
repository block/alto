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

  it('copies reused mutable input and shares only isolated unchanged branches', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(clientExtensionRegistryPlugin)
    const changed = vi.fn()
    ctx.on('clientExtensions/changed', changed)
    const value = { items: [{ text: 'Saved answer' }, { text: 'Stream' }], requests: [] }
    const state = ctx.clientExtensions.registerState(ctx, 'chat', value)
    try {
      const first = changed.mock.lastCall![0].chat as typeof value
      value.items[1]!.text += 'ing'
      state.update(value)
      const second = changed.mock.lastCall![0].chat as typeof value
      expect(second.items[0]).toBe(first.items[0])
      expect(second.items[0]).not.toBe(value.items[0])
      expect(second.items[1]).not.toBe(value.items[1])
      expect(first.items[1]!.text).toBe('Stream')
      expect(second.items[1]!.text).toBe('Streaming')
      value.items[0]!.text = 'Changed after update'
      value.items[1]!.text += ' again'
      expect(second.items[0]!.text).toBe('Saved answer')
      expect(second.items[1]!.text).toBe('Streaming')
      state.update(value)
      expect(changed.mock.lastCall![0].chat).toEqual(value)

      const reconnect = ctx.clientExtensions.snapshot()
      expect(reconnect.chat).toEqual(value)
      expect(reconnect.chat).not.toBe(changed.mock.lastCall![0].chat)
      const reconnectChat = reconnect.chat as typeof value
      reconnectChat.items[0]!.text = 'Changed snapshot'
      expect((ctx.clientExtensions.snapshot().chat as typeof value).items[0]!.text).toBe('Changed after update')
      await state.dispose()
      expect(() => state.update(value)).toThrow('not active')
      expect(ctx.clientExtensions.snapshot()).toEqual({})
    } finally {
      await state.dispose()
      await fiber.dispose()
    }
  })
})
