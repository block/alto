export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>
export type ChromeTheme = 'alto' | 'paper' | 'graphite' | 'ink' | 'black'
export type CodeTheme = 'alto' | 'github' | 'nord' | 'muted'
export type OuterPaneMaterial = 'glass' | 'solid'
export type OuterPaneTexture = 'auto' | 'none' | 'dots' | 'grid' | 'lines'

export interface OuterPanePreference {
  material: OuterPaneMaterial
  background: string | null
  text: string | null
  texture: OuterPaneTexture
}

export interface ThemePreference {
  mode: ThemeMode
  accent: string
  chrome: ChromeTheme
  code: CodeTheme
  outerPane: OuterPanePreference
}

export interface ThemeConfig {
  defaultMode?: ThemeMode
  defaultAccent?: string
  defaultChrome?: ChromeTheme
  defaultCode?: CodeTheme
  defaultOuterPane?: Partial<OuterPanePreference>
}

export const THEME_STORAGE_KEY = 'alto.theme.v1'
export const DEFAULT_OUTER_PANE: Readonly<OuterPanePreference> = {
  material: 'glass',
  background: null,
  text: null,
  texture: 'auto',
}
export const DEFAULT_THEME: Readonly<ThemePreference> = {
  mode: 'light',
  accent: '#7c3aed',
  chrome: 'alto',
  code: 'alto',
  outerPane: DEFAULT_OUTER_PANE,
}

const hexColor = /^#[0-9a-f]{6}$/i
const chromeThemes = new Set<ChromeTheme>(['alto', 'paper', 'graphite', 'ink', 'black'])
const codeThemes = new Set<CodeTheme>(['alto', 'github', 'nord', 'muted'])
const outerPaneTextures = new Set<OuterPaneTexture>(['auto', 'none', 'dots', 'grid', 'lines'])

export function resolveOuterPaneTexture(
  preference: Pick<OuterPanePreference, 'material' | 'texture'>,
): Exclude<OuterPaneTexture, 'auto'> {
  if (preference.texture !== 'auto') return preference.texture
  return preference.material === 'glass' ? 'none' : 'dots'
}

function optionalColor(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  return typeof value === 'string' && hexColor.test(value.trim())
    ? value.trim().toLocaleLowerCase()
    : fallback
}

export function parseOuterPanePreference(
  value: unknown,
  defaults: OuterPanePreference = DEFAULT_OUTER_PANE,
): OuterPanePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaults }
  const candidate = value as Partial<OuterPanePreference>
  return {
    material: candidate.material === 'glass' || candidate.material === 'solid'
      ? candidate.material
      : defaults.material,
    background: optionalColor(candidate.background, defaults.background),
    text: optionalColor(candidate.text, defaults.text),
    texture: typeof candidate.texture === 'string' && outerPaneTextures.has(candidate.texture as OuterPaneTexture)
      ? candidate.texture
      : defaults.texture,
  }
}

function luminance(color: string): number {
  const channelLuminance = (offset: number): number => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channelLuminance(1) + 0.7152 * channelLuminance(3) + 0.0722 * channelLuminance(5)
}

function contrast(left: string, right: string): number {
  const a = luminance(left), b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function resolveOuterPaneTextColor(preference: Pick<OuterPanePreference, 'background' | 'text'>): string | null {
  if (preference.text !== null) return preference.text
  const background = preference.background
  if (background === null) return null
  const blackContrast = contrast(background, '#000000')
  const whiteContrast = contrast(background, '#ffffff')
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}

/** Keep the selected hue, moving toward contrasting ink only as far as needed.
 * Outer chrome and content can have different backgrounds, so derive each
 * accent against the surface where it is actually used. */
export function resolveAccentColor(color: string, surface: string): string {
  if (contrast(color, surface) >= 4.5) return color
  const ink = resolveOuterPaneTextColor({ background: surface, text: null })!
  const mix = (amount: number): string => '#' + [1, 3, 5].map(offset => {
    const source = Number.parseInt(color.slice(offset, offset + 2), 16)
    const target = Number.parseInt(ink.slice(offset, offset + 2), 16)
    return Math.round(source + (target - source) * amount).toString(16).padStart(2, '0')
  }).join('')
  let low = 0, high = 1
  for (let step = 0; step < 20; step++) {
    const middle = (low + high) / 2
    if (contrast(mix(middle), surface) >= 4.5) high = middle
    else low = middle
  }
  return mix(high)
}

/** The opaque color of the glass tint, shared by both materials. Use the
 * saved accent rather than a derived solid accent so switching cannot drift. */
export function resolveDefaultOuterPaneBackground(accent: string, mode: ResolvedThemeMode, background: string, canvas: string, panel: string): string {
  const channel = (color: string, offset: number): number => Number.parseInt(color.slice(offset, offset + 2), 16)
  return '#' + [1, 3, 5].map(offset => {
    const neutral = mode === 'dark'
      ? channel(canvas, offset) * 0.55 + channel(background, offset) * 0.45
      : channel(panel, offset)
    // Light glass is 12% accent plus 61.6% panel (73.6% total opacity).
    const wash = mode === 'dark' ? 0.1 : 0.12 / 0.736
    return Math.round(channel(accent, offset) * wash + neutral * (1 - wash)).toString(16).padStart(2, '0')
  }).join('')
}

export function resolveOuterPaneColors(preference: Pick<ThemePreference, 'chrome' | 'outerPane'>, automaticBackground: string | null = null): {
  background: string | null
  text: string | null
} {
  const background = preference.outerPane.background
    ?? (preference.chrome === 'black' ? '#000000' : preference.outerPane.material === 'solid' ? automaticBackground : null)
  return {
    background,
    text: resolveOuterPaneTextColor({ ...preference.outerPane, background }),
  }
}

export function normalizeAccent(value: unknown, fallback = DEFAULT_THEME.accent): string {
  return typeof value === 'string' && hexColor.test(value.trim())
    ? value.trim().toLocaleLowerCase()
    : fallback
}

export function normalizeChromeTheme(
  value: unknown,
  fallback: ChromeTheme = DEFAULT_THEME.chrome,
): ChromeTheme {
  return typeof value === 'string' && chromeThemes.has(value as ChromeTheme)
    ? value as ChromeTheme
    : fallback
}

export function normalizeCodeTheme(
  value: unknown,
  fallback: CodeTheme = DEFAULT_THEME.code,
): CodeTheme {
  return typeof value === 'string' && codeThemes.has(value as CodeTheme)
    ? value as CodeTheme
    : fallback
}

export function themeDefaults(config: ThemeConfig = {}): ThemePreference {
  return {
    mode: config.defaultMode === 'dark' || config.defaultMode === 'system'
      ? config.defaultMode
      : 'light',
    accent: normalizeAccent(config.defaultAccent),
    chrome: normalizeChromeTheme(config.defaultChrome),
    code: normalizeCodeTheme(config.defaultCode),
    outerPane: parseOuterPanePreference(config.defaultOuterPane),
  }
}

export function parseThemePreference(
  value: unknown,
  defaults: ThemePreference = DEFAULT_THEME,
): ThemePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaults, outerPane: { ...defaults.outerPane } }
  }
  const candidate = value as Partial<ThemePreference>
  return {
    mode: candidate.mode === 'light' || candidate.mode === 'dark' || candidate.mode === 'system'
      ? candidate.mode
      : defaults.mode,
    accent: normalizeAccent(candidate.accent, defaults.accent),
    chrome: normalizeChromeTheme(candidate.chrome, defaults.chrome),
    code: normalizeCodeTheme(candidate.code, defaults.code),
    outerPane: parseOuterPanePreference(candidate.outerPane, defaults.outerPane),
  }
}

export function resolveThemeMode(mode: ThemeMode, systemDark: boolean): ResolvedThemeMode {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}
