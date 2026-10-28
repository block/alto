import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'

const workspaceMaterial: HarnessPlugin = (ctx) => {
  if (process.platform !== 'darwin' || process.type !== 'browser') return
  const { app, BrowserWindow } = createRequire(import.meta.url)('electron') as typeof import('electron')

  ctx.effect(() => {
    let active = true
    const windows = new Map<BrowserWindow, () => void>()
    const attach = (target: BrowserWindow): void => {
      if (!active || target.isDestroyed() || windows.has(target)
        || target.getParentWindow() || target.getTitle() !== app.getName()) return

      const original = target.setVibrancy
      const setVibrancy: BrowserWindow['setVibrancy'] = (type, options) => {
        if (target.isDestroyed()) return
        // The desktop host refreshes its backing surface with under-window.
        // Keep those refreshes while using Zen's HUD material for this fiber.
        original.call(target, active && type === 'under-window' ? 'hud' : type, options)
      }
      const closed = (): void => { windows.delete(target) }
      windows.set(target, () => {
        target.off('closed', closed)
        if (target.isDestroyed() || target.setVibrancy !== setVibrancy) return
        target.setVibrancy = original
        target.setVibrancy('under-window')
      })
      target.once('closed', closed)
      target.setVibrancy = setVibrancy
      target.setVibrancy('hud')
    }
    // Electron emits this before constructor options, including title, settle.
    const created = (_event: Electron.Event, target: BrowserWindow): void => {
      queueMicrotask(() => attach(target))
    }
    const dispose = (): void => {
      if (!active) return
      active = false
      app.off('browser-window-created', created)
      for (const restore of windows.values()) restore()
      windows.clear()
    }

    app.on('browser-window-created', created)
    try {
      for (const target of BrowserWindow.getAllWindows()) attach(target)
    } catch (error) {
      dispose()
      throw error
    }
    return dispose
  }, 'workspaceMaterial.native')
}

export default workspaceMaterial
