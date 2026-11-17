import { describe, expect, it, vi } from 'vitest'
import { ThemeController } from '../program/plugins/theme.client.js'
import { parseThemeAppearanceSignature } from '../program/plugins/theme-runtime.js'
import { DEFAULT_THEME, THEME_STORAGE_KEY } from '../program/plugins/theme-api.js'

describe('theme client lifecycle', () => {
  it('parses the resolved appearance shared with plugin-owned renderers', () => {
    expect(parseThemeAppearanceSignature('dark|#2563eb')).toEqual({
      mode: 'dark',
      accent: '#2563eb',
    })
    expect(parseThemeAppearanceSignature('unknown|invalid')).toEqual({
      mode: 'light',
      accent: '#7c3aed',
    })
  })

  it('publishes stable snapshots and removes every override when unloaded', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const properties = new Map<string, string>()
    const listeners = new Set<() => void>()
    const media = {
      matches: false,
      addEventListener: (_name: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener),
    }
    const storage = new Map<string, string>()
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        matchMedia: () => media,
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: root },
    })

    try {
      const controller = new ThemeController()
      expect(controller.snapshot()).toBe(controller.snapshot())
      const changed = vi.fn()
      controller.subscribe(changed)
      const deactivate = controller.activate()

      expect(root.dataset).toEqual({
        altoThemePlugin: 'active',
        altoTheme: 'light',
        altoChromeTheme: 'alto',
        altoCodeTheme: 'alto',
        altoOuterMaterial: 'glass',
        altoOuterTexture: 'none',
      })
      expect(properties.get('--alto-theme-accent')).toBe('#7c3aed')
      expect(properties.has('--alto-outer-background')).toBe(false)
      expect(properties.has('--alto-outer-text')).toBe(false)

      const previous = controller.snapshot()
      controller.setMode('dark')
      controller.setChrome('ink')
      controller.setCode('nord')
      controller.setAccent('#2563eb')
      expect(controller.snapshot()).not.toBe(previous)
      expect(controller.snapshot()).toMatchObject({
        mode: 'dark',
        accent: '#2563eb',
        chrome: 'ink',
        code: 'nord',
      })
      expect(root.dataset.altoTheme).toBe('dark')
      expect(root.dataset.altoChromeTheme).toBe('ink')
      expect(root.dataset.altoCodeTheme).toBe('nord')
      expect(properties.get('--alto-theme-accent')).toBe('#2563eb')
      expect(changed).toHaveBeenCalledTimes(4)

      controller.reset()
      expect(controller.isDefault()).toBe(true)
      controller.setChrome('black')
      expect(controller.snapshot().outerPane).toEqual(DEFAULT_THEME.outerPane)
      expect(root.dataset.altoOuterMaterial).toBe('glass')
      controller.setOuterPane({ material: 'solid' })
      expect(controller.isDefault()).toBe(false)
      expect(controller.snapshot().outerPane).toEqual({ material: 'solid', background: null, text: null, texture: 'auto' })
      expect(root.dataset).toMatchObject({
        altoChromeTheme: 'black', altoOuterMaterial: 'solid', altoOuterBackground: 'custom', altoOuterText: 'custom', altoOuterTexture: 'dots',
      })
      expect(properties.get('--alto-outer-background')).toBe('#000000')
      expect(properties.get('--alto-outer-text')).toBe('#ffffff')
      expect(JSON.parse(storage.get(THEME_STORAGE_KEY)!)).toMatchObject({ outerPane: controller.snapshot().outerPane })
      expect(new ThemeController().snapshot()).toMatchObject({ chrome: 'black', outerPane: controller.snapshot().outerPane })

      const outerSnapshot = controller.snapshot()
      controller.setOuterPane({})
      controller.setOuterPane({ material: 'solid', background: null, text: null })
      controller.setOuterPane({ texture: 'auto' })
      controller.setChrome('black')
      expect(controller.snapshot()).toBe(outerSnapshot)
      expect(changed).toHaveBeenCalledTimes(7)

      controller.setOuterPane({ text: '#CCEEFF' })
      expect(properties.get('--alto-outer-text')).toBe('#cceeff')
      expect(controller.snapshot().outerPane.background).toBeNull()
      controller.setOuterPane({ background: '#ffffff' })
      controller.setChrome('ink')
      expect(controller.snapshot().outerPane).toEqual({ material: 'solid', background: null, text: '#cceeff', texture: 'auto' })
      expect(properties.get('--alto-outer-background')).toBe(properties.get('--alto-outer-default-background'))
      expect(properties.get('--alto-outer-text')).toBe('#cceeff')
      controller.setChrome('black')
      expect(properties.get('--alto-outer-background')).toBe('#000000')
      expect(properties.get('--alto-outer-text')).toBe('#cceeff')
      controller.setOuterPane({ background: '#ffffff', text: null })
      expect(properties.get('--alto-outer-text')).toBe('#000000')
      controller.setOuterPane({ background: null })
      expect(properties.get('--alto-outer-background')).toBe('#000000')
      expect(properties.get('--alto-outer-text')).toBe('#ffffff')
      controller.setChrome('alto')
      expect(properties.get('--alto-outer-background')).toBe('#e4daf9')
      expect(properties.get('--alto-outer-text')).toBe('#000000')
      expect(root.dataset.altoOuterBackground).toBe('custom')
      expect(root.dataset.altoOuterText).toBe('custom')

      controller.reset()
      expect(controller.snapshot()).toMatchObject(DEFAULT_THEME)
      expect(controller.isDefault()).toBe(true)
      const resetSnapshot = controller.snapshot()
      const resetChanges = changed.mock.calls.length
      controller.reset()
      expect(controller.snapshot()).toBe(resetSnapshot)
      expect(changed).toHaveBeenCalledTimes(resetChanges)
      controller.setOuterPane({ texture: 'dots' })
      expect(controller.isDefault()).toBe(false)
      expect(controller.isOuterPaneDefault()).toBe(false)
      expect(root.dataset.altoOuterTexture).toBe('dots')
      expect(new ThemeController().snapshot().outerPane.texture).toBe('dots')
      const textureSnapshot = controller.snapshot()
      const textureChanges = changed.mock.calls.length
      controller.setOuterPane({ texture: 'dots' })
      expect(controller.snapshot()).toBe(textureSnapshot)
      expect(changed).toHaveBeenCalledTimes(textureChanges)
      controller.setOuterPane({ material: 'solid' })
      controller.setOuterPane({ material: 'glass' })
      expect(controller.snapshot().outerPane.texture).toBe('dots')
      expect(root.dataset.altoOuterTexture).toBe('dots')
      controller.resetOuterPane()
      expect(controller.isDefault()).toBe(true)
      expect(controller.snapshot().outerPane.texture).toBe('auto')
      expect(root.dataset.altoOuterTexture).toBe('none')
      controller.setOuterPane({ texture: 'grid' })
      controller.setChrome('black')
      expect(controller.snapshot().outerPane.texture).toBe('grid')
      expect(new ThemeController().snapshot().outerPane.texture).toBe('grid')

      controller.setChrome('alto')
      controller.setAccent('#2563eb')
      controller.setOuterPane({ texture: 'auto' })
      for (const mode of ['light', 'dark'] as const) {
        controller.setMode(mode)
        const glassBackground = properties.get('--alto-outer-default-background')
        expect(glassBackground).toMatch(/^#[0-9a-f]{6}$/)
        for (let toggle = 0; toggle < 3; toggle++) {
          controller.setOuterPane({ material: 'solid' })
          expect(properties.get('--alto-outer-background')).toBe(glassBackground)
          expect(properties.get('--alto-outer-default-background')).toBe(glassBackground)
          expect(controller.snapshot().outerPane.background).toBeNull()
          controller.setOuterPane({ material: 'glass' })
          expect(properties.has('--alto-outer-background')).toBe(false)
          expect(properties.get('--alto-theme-accent')).toBe('#2563eb')
          expect(properties.get('--alto-outer-default-background')).toBe(glassBackground)
        }
      }
      for (const mode of ['light', 'dark'] as const) {
        controller.setMode(mode)
        for (const background of ['#000000', '#ffffff', '#777777', '#0000ff', '#ffff00']) {
          controller.setOuterPane({ material: 'solid', background, text: '#000000' })
          expect(root.dataset.altoOuterTexture).toBe('dots')
          expect(properties.get('--alto-outer-background')).toBe(background)
          expect(properties.get('--alto-theme-accent')).not.toBe('#2563eb')
          expect(properties.get('--alto-outer-accent')).not.toBe(background)
          if (background === '#000000') expect(properties.get('--alto-outer-pattern-color')).toBe('#ffffff')
          if (background === '#ffffff') expect(properties.get('--alto-outer-pattern-color')).toBe('#000000')
        }
      }
      controller.setOuterPane({ material: 'glass' })
      expect(properties.get('--alto-theme-accent')).toBe('#2563eb')
      controller.setOuterPane({ material: 'solid', background: '#000000', text: null })
      expect(JSON.parse(storage.get(THEME_STORAGE_KEY)!))
        .toMatchObject({ accent: '#2563eb', outerPane: { material: 'solid', background: '#000000' } })

      deactivate()
      expect(root.dataset).toEqual({})
      expect(properties.has('--alto-theme-accent')).toBe(false)
      expect(properties.has('--alto-outer-background')).toBe(false)
      expect(properties.has('--alto-outer-text')).toBe(false)
      expect(properties.has('--alto-outer-default-background')).toBe(false)
      expect(properties.has('--alto-outer-accent')).toBe(false)
      expect(properties.has('--alto-outer-pattern-color')).toBe(false)
      expect(listeners.size).toBe(0)

      const restored = new ThemeController()
      const deactivateRestored = restored.activate()
      expect(properties.get('--alto-outer-background')).toBe('#000000')
      expect(properties.get('--alto-outer-pattern-color')).toBe('#ffffff')
      expect(restored.snapshot().outerPane.background).toBe('#000000')
      deactivateRestored()

      storage.clear()
      const configured = new ThemeController({
        defaultOuterPane: { material: 'solid', background: '#000000', text: '#eeeeee', texture: 'dots' },
      })
      configured.setOuterPane({ material: 'glass', background: null, text: null, texture: 'none' })
      expect(configured.isDefault()).toBe(false)
      expect(configured.isOuterPaneDefault()).toBe(false)
      configured.setAccent('#336699')
      configured.resetOuterPane()
      expect(configured.isOuterPaneDefault()).toBe(true)
      expect(configured.snapshot().accent).toBe('#336699')
      expect(configured.isDefault()).toBe(false)
      configured.reset()
      expect(configured.isDefault()).toBe(true)
      expect(configured.snapshot().outerPane).toEqual({ material: 'solid', background: '#000000', text: '#eeeeee', texture: 'dots' })
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete (globalThis as { window?: Window }).window
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else delete (globalThis as { document?: Document }).document
    }
  })
})
