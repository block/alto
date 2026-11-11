import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  normalizeAccent,
  normalizeChromeTheme,
  normalizeCodeTheme,
  parseOuterPanePreference,
  parseThemePreference,
  resolveOuterPaneColors,
  resolveOuterPaneTexture,
  resolveOuterPaneTextColor,
  resolveThemeMode,
  themeDefaults,
} from '../program/plugins/theme-api.js'

describe('theme preferences', () => {
  it('keeps Alto\'s existing light palette as the default', () => {
    expect(DEFAULT_THEME).toEqual({
      mode: 'light',
      accent: '#7c3aed',
      chrome: 'alto',
      code: 'alto',
      outerPane: { material: 'glass', background: null, text: null, texture: 'auto' },
    })
    expect(themeDefaults()).toEqual(DEFAULT_THEME)
  })

  it('validates stored modes and six-digit accent colors', () => {
    expect(parseThemePreference({ mode: 'dark', accent: '#AABBCC' })).toEqual({
      mode: 'dark',
      accent: '#aabbcc',
      chrome: 'alto',
      code: 'alto',
      outerPane: { material: 'glass', background: null, text: null, texture: 'auto' },
    })
    expect(parseThemePreference({ mode: 'sepia', accent: 'purple' })).toEqual(DEFAULT_THEME)
    expect(normalizeAccent('#123456')).toBe('#123456')
    expect(normalizeAccent('#123')).toBe(DEFAULT_THEME.accent)
    expect(normalizeChromeTheme('paper')).toBe('paper')
    expect(normalizeChromeTheme('graphite')).toBe('graphite')
    expect(normalizeChromeTheme('black')).toBe('black')
    expect(normalizeChromeTheme('blue')).toBe('alto')
    expect(normalizeCodeTheme('github')).toBe('github')
    expect(normalizeCodeTheme('nord')).toBe('nord')
    expect(normalizeCodeTheme('dracula')).toBe('alto')
  })

  it('keeps stored mode and accent preferences while adding palette defaults', () => {
    expect(parseThemePreference({
      mode: 'system',
      accent: '#336699',
      chrome: 'ink',
      code: 'muted',
    })).toEqual({
      mode: 'system',
      accent: '#336699',
      chrome: 'ink',
      code: 'muted',
      outerPane: { material: 'glass', background: null, text: null, texture: 'auto' },
    })
  })

  it('validates independent outer pane colors while retaining automatic choices', () => {
    expect(parseOuterPanePreference({ material: 'solid', background: ' #ABCDEF ', text: '#CCDDEE' }))
      .toEqual({ material: 'solid', background: '#abcdef', text: '#ccddee', texture: 'auto' })
    for (const value of [undefined, null, [], 'black', {
      material: 'opaque', background: '#000', text: 'url(https://example.com)',
    }]) expect(parseOuterPanePreference(value)).toEqual(DEFAULT_THEME.outerPane)
    expect(parseOuterPanePreference({ material: 'solid', background: null, text: '#ffffff' }))
      .toEqual({ material: 'solid', background: null, text: '#ffffff', texture: 'auto' })
  })

  it('restores saved outer colors and respects configured defaults for older preferences', () => {
    const defaults = themeDefaults({
      defaultOuterPane: { material: 'solid', background: '#000000', text: null },
    })
    expect(defaults.outerPane).toEqual({ material: 'solid', background: '#000000', text: null, texture: 'auto' })
    expect(parseThemePreference({ mode: 'dark', accent: '#336699' }, defaults))
      .toMatchObject({ mode: 'dark', accent: '#336699', outerPane: defaults.outerPane })
    expect(parseThemePreference({
      outerPane: { material: 'solid', background: '#123456', text: '#FEDCBA' },
    }).outerPane).toEqual({ material: 'solid', background: '#123456', text: '#fedcba', texture: 'auto' })
    expect(parseThemePreference({
      outerPane: { material: 'glass', background: null, text: null },
    }, defaults).outerPane).toEqual(DEFAULT_THEME.outerPane)
    expect(parseThemePreference({ chrome: 'black' }))
      .toEqual({ ...DEFAULT_THEME, chrome: 'black' })
  })

  it('restores textures independently and migrates missing choices from the configured default', () => {
    for (const texture of ['auto', 'none', 'dots', 'grid', 'lines']) {
      expect(parseOuterPanePreference({ texture })).toEqual({ ...DEFAULT_THEME.outerPane, texture })
    }
    for (const texture of ['noise', '', true, 1, null, {}]) {
      expect(parseOuterPanePreference({ texture })).toEqual(DEFAULT_THEME.outerPane)
    }
    const defaults = themeDefaults({ defaultOuterPane: { texture: 'dots' } })
    expect(defaults.outerPane).toEqual({ ...DEFAULT_THEME.outerPane, texture: 'dots' })
    expect(parseThemePreference({ mode: 'dark', outerPane: { material: 'solid' } }, defaults))
      .toMatchObject({ mode: 'dark', outerPane: { ...DEFAULT_THEME.outerPane, material: 'solid', texture: 'dots' } })
    expect(parseThemePreference({ outerPane: { texture: 'none' } }, defaults).outerPane.texture).toBe('none')
    expect(parseThemePreference({ outerPane: { texture: 'invalid' } }, defaults).outerPane.texture).toBe('dots')
    expect(resolveOuterPaneTexture({ material: 'glass', texture: 'auto' })).toBe('none')
    expect(resolveOuterPaneTexture({ material: 'solid', texture: 'auto' })).toBe('dots')
    for (const material of ['glass', 'solid'] as const) {
      for (const texture of ['none', 'dots', 'grid', 'lines'] as const) {
        expect(resolveOuterPaneTexture({ material, texture })).toBe(texture)
      }
    }
  })

  it('chooses readable automatic outer text without changing the saved preference', () => {
    const outer = { material: 'solid' as const, background: '#000000', text: null, texture: 'none' as const }
    expect(resolveOuterPaneTextColor(outer)).toBe('#ffffff')
    expect(resolveOuterPaneTextColor({ ...outer, background: '#ffffff' })).toBe('#000000')
    expect(resolveOuterPaneTextColor({ ...outer, text: '#cceeff' })).toBe('#cceeff')
    expect(resolveOuterPaneTextColor(DEFAULT_THEME.outerPane)).toBeNull()
    expect(resolveOuterPaneColors({ chrome: 'black', outerPane: DEFAULT_THEME.outerPane }))
      .toEqual({ background: '#000000', text: '#ffffff' })
    expect(resolveOuterPaneColors({ chrome: 'black', outerPane: { ...outer, background: '#ffffff' } }))
      .toEqual({ background: '#ffffff', text: '#000000' })
    expect(resolveOuterPaneColors({ chrome: 'black', outerPane: { ...outer, background: null, text: '#cceeff' } }))
      .toEqual({ background: '#000000', text: '#cceeff' })
    expect(resolveOuterPaneColors({ chrome: 'ink', outerPane: DEFAULT_THEME.outerPane }))
      .toEqual({ background: null, text: null })
    expect(outer.text).toBeNull()
  })

  it('resolves system mode without changing explicit choices', () => {
    expect(resolveThemeMode('system', true)).toBe('dark')
    expect(resolveThemeMode('system', false)).toBe('light')
    expect(resolveThemeMode('light', true)).toBe('light')
    expect(resolveThemeMode('dark', false)).toBe('dark')
  })
})
