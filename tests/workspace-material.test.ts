import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessContext } from '../src/server/plugin-api.js'
import workspaceMaterial from '../program/plugins/workspace-material.js'

const { createRequire } = vi.hoisted(() => ({ createRequire: vi.fn() }))
vi.mock('node:module', () => ({ createRequire }))

class Window extends EventEmitter {
  destroyed = false
  title = 'Alto'
  parent: Window | null = null
  material: string | null = 'under-window'
  setVibrancy = vi.fn(function (this: Window, type: string | null, _options?: unknown) {
    if (this.destroyed) throw new Error('Window is destroyed')
    this.material = type
  })
  isDestroyed(): boolean { return this.destroyed }
  getTitle(): string { return this.title }
  getParentWindow(): Window | null { return this.parent }
  close(): void { this.destroyed = true; this.emit('closed') }
}

const descriptors = {
  platform: Object.getOwnPropertyDescriptor(process, 'platform')!,
  type: Object.getOwnPropertyDescriptor(process, 'type'),
}
const app = Object.assign(new EventEmitter(), { getName: () => 'Alto' })
const getAllWindows = vi.fn<() => Window[]>()
const requireElectron = vi.fn(() => ({ app, BrowserWindow: { getAllWindows } }))
const lifetimes: Array<() => void> = []

function install(): () => void {
  let dispose = () => {}
  const ctx = { effect: (effect: () => () => void) => { dispose = effect() } }
  ;(workspaceMaterial as (ctx: HarnessContext) => void)(ctx as unknown as HarnessContext)
  lifetimes.push(dispose)
  return dispose
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  Object.defineProperty(process, 'type', { configurable: true, value: 'browser' })
  createRequire.mockReturnValue(requireElectron)
  getAllWindows.mockReturnValue([])
})

afterEach(() => {
  for (const dispose of lifetimes.splice(0).reverse()) dispose()
  app.removeAllListeners()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', descriptors.platform)
  if (descriptors.type) Object.defineProperty(process, 'type', descriptors.type)
  else delete (process as unknown as { type?: string }).type
})

describe('workspace native material lifetime', () => {
  it('keeps the existing host refreshes on HUD and restores the native method on unload', () => {
    const target = new Window()
    const original = target.setVibrancy
    getAllWindows.mockReturnValue([target])
    const dispose = install()
    expect(target.material).toBe('hud')

    // Focus, movement and resizing use this same call in the desktop host.
    const options = { animationDuration: 100 }
    target.setVibrancy('under-window', options)
    expect(original).toHaveBeenLastCalledWith('hud', options)
    expect(target.material).toBe('hud')
    target.setVibrancy('sidebar')
    expect(target.material).toBe('sidebar')
    target.setVibrancy(null)
    expect(target.material).toBeNull()

    dispose()
    expect(target.setVibrancy).toBe(original)
    expect(target.material).toBe('under-window')
    expect(app.listenerCount('browser-window-created')).toBe(0)
    expect(target.listenerCount('closed')).toBe(0)
    const calls = original.mock.calls.length
    dispose()
    expect(original).toHaveBeenCalledTimes(calls)
  })

  it('covers future Alto windows after construction without touching dialogs or destroyed windows', async () => {
    const disposed = new Window()
    disposed.close()
    const dialog = new Window()
    dialog.title = 'Settings'
    const child = new Window()
    child.parent = new Window()
    getAllWindows.mockReturnValue([disposed, dialog, child])
    const dispose = install()
    for (const target of [disposed, dialog, child]) expect(target.setVibrancy).not.toHaveBeenCalled()

    const target = new Window()
    target.title = 'Electron'
    app.emit('browser-window-created', {}, target)
    target.title = 'Alto'
    await Promise.resolve()
    target.setVibrancy('under-window')
    expect(target.material).toBe('hud')
    dispose()
    const later = new Window()
    app.emit('browser-window-created', {}, later)
    await Promise.resolve()
    expect(later.setVibrancy).not.toHaveBeenCalled()
  })

  it('does not attach a queued future host after its fiber or window has gone away', async () => {
    const dispose = install()
    const target = new Window()
    app.emit('browser-window-created', {}, target)
    dispose()
    await Promise.resolve()
    expect(target.setVibrancy).not.toHaveBeenCalled()

    install()
    const closed = new Window()
    app.emit('browser-window-created', {}, closed)
    closed.close()
    await Promise.resolve()
    expect(closed.setVibrancy).not.toHaveBeenCalled()
  })

  it('leaves a later owner intact and makes its retained wrapper inert after disposal', () => {
    const target = new Window()
    const original = target.setVibrancy
    getAllWindows.mockReturnValue([target])
    const dispose = install()
    const ours = target.setVibrancy
    const later = vi.fn((type: string | null, options?: unknown) => ours(type, options))
    target.setVibrancy = later as typeof target.setVibrancy
    dispose()
    expect(target.setVibrancy).toBe(later)
    expect(original).not.toHaveBeenCalledWith('under-window')
    target.setVibrancy('under-window')
    expect(target.material).toBe('under-window')
  })

  it('does not let an older fiber override its replacement or keep HUD alive after both unload', () => {
    const target = new Window()
    getAllWindows.mockReturnValue([target])
    const first = install()
    const second = install()
    const replacement = target.setVibrancy
    first()
    expect(target.setVibrancy).toBe(replacement)
    target.setVibrancy('under-window')
    expect(target.material).toBe('hud')
    second()
    target.setVibrancy('under-window')
    expect(target.material).toBe('under-window')
  })

  it('releases closed hosts and never calls their destroyed native methods', () => {
    const target = new Window()
    const original = target.setVibrancy
    getAllWindows.mockReturnValue([target])
    const dispose = install()
    target.close()
    expect(target.listenerCount('closed')).toBe(0)
    const calls = original.mock.calls.length
    expect(() => { target.setVibrancy('under-window'); dispose() }).not.toThrow()
    expect(original).toHaveBeenCalledTimes(calls)
  })

  it.each([['darwin', undefined], ['darwin', 'renderer'], ['linux', 'browser'], ['win32', 'browser']])(
    'does not load Electron in a %s/%s host', (platform, type) => {
      Object.defineProperty(process, 'platform', { configurable: true, value: platform })
      Object.defineProperty(process, 'type', { configurable: true, value: type })
      install()
      expect(createRequire).not.toHaveBeenCalled()
      expect(requireElectron).not.toHaveBeenCalled()
      expect(app.listenerCount('browser-window-created')).toBe(0)
    },
  )
})
