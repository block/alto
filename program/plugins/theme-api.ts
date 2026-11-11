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

export function resolveOuterPaneTextColor(preference: Pick<OuterPanePreference, 'background' | 'text'>): string | null {
  if (preference.text !== null) return preference.text
  const background = preference.background
  if (background === null) return null
  const channelLuminance = (offset: number): number => {
    const channel = Number.parseInt(background.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channelLuminance(1) + 0.7152 * channelLuminance(3) + 0.0722 * channelLuminance(5)
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}

export function resolveOuterPaneColors(preference: Pick<ThemePreference, 'chrome' | 'outerPane'>): {
  background: string | null
  text: string | null
} {
  const background = preference.outerPane.background ?? (preference.chrome === 'black' ? '#000000' : null)
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
