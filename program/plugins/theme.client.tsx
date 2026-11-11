import {
  Check,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sun,
} from 'lucide-react'
import {
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type {
  BrowserPlugin,
  ClientSettingsIconProps,
} from '../../src/client/plugin-api.js'
import { SettingsRow } from './ui/settings.js'
import { uiStyles } from './ui/appearance.js'
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  normalizeAccent,
  parseOuterPanePreference,
  parseThemePreference,
  resolveOuterPaneColors,
  resolveOuterPaneTexture,
  resolveThemeMode,
  themeDefaults,
  type ChromeTheme,
  type CodeTheme,
  type OuterPanePreference,
  type OuterPaneTexture,
  type ResolvedThemeMode,
  type ThemeConfig,
  type ThemeMode,
  type ThemePreference,
} from './theme-api.js'
import styles from './theme.css'

interface ThemeSnapshot extends ThemePreference {
  revision: number
  resolved: ResolvedThemeMode
}

const modes: ReadonlyArray<Readonly<{
  id: ThemeMode
  label: string
  icon: typeof Sun
}>> = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]

const chromeThemes: ReadonlyArray<Readonly<{
  id: ChromeTheme
  label: string
}>> = [
  { id: 'alto', label: 'Alto gray' },
  { id: 'paper', label: 'Paper' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'ink', label: 'Ink' },
  { id: 'black', label: 'Black' },
]

const codeThemes: ReadonlyArray<Readonly<{
  id: CodeTheme
  label: string
}>> = [
  { id: 'alto', label: 'Alto' },
  { id: 'github', label: 'GitHub light/dark' },
  { id: 'nord', label: 'Nord' },
  { id: 'muted', label: 'Muted' },
]

const outerPaneTextures: ReadonlyArray<Readonly<{ id: OuterPaneTexture; label: string }>> = [
  { id: 'auto', label: 'Automatic' },
  { id: 'none', label: 'None' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Grid' },
  { id: 'lines', label: 'Diagonal lines' },
]

const accentPresets = [
  { id: 'purple', label: 'Purple', value: '#7c3aed' },
  { id: 'blue', label: 'Blue', value: '#2563eb' },
  { id: 'cyan', label: 'Cyan', value: '#0891b2' },
  { id: 'green', label: 'Green', value: '#16a34a' },
  { id: 'orange', label: 'Orange', value: '#ea580c' },
  { id: 'rose', label: 'Rose', value: '#e11d48' },
  { id: 'graphite', label: 'Graphite', value: '#525252' },
] as const

function sameOuterPane(left: OuterPanePreference, right: OuterPanePreference): boolean {
  return left.material === right.material
    && left.background === right.background
    && left.text === right.text
    && left.texture === right.texture
}

export class ThemeController {
  private readonly listeners = new Set<() => void>()
  private readonly defaults: ThemePreference
  private readonly media: MediaQueryList
  private preference: ThemePreference
  private state: ThemeSnapshot
  private active = false
  private readonly onSystemThemeChanged = (): void => {
    if (this.preference.mode !== 'system') return
    this.apply()
    this.emit()
  }

  constructor(config: ThemeConfig = {}) {
    this.defaults = themeDefaults(config)
    this.media = window.matchMedia('(prefers-color-scheme: dark)')
    this.preference = this.read()
    this.state = this.nextSnapshot(0)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot = (): ThemeSnapshot => this.state

  activate(): () => void {
    this.active = true
    this.media.addEventListener('change', this.onSystemThemeChanged)
    this.apply()
    return () => {
      this.active = false
      this.media.removeEventListener('change', this.onSystemThemeChanged)
      const root = document.documentElement
      delete root.dataset.altoThemePlugin
      delete root.dataset.altoTheme
      delete root.dataset.altoChromeTheme
      delete root.dataset.altoCodeTheme
      delete root.dataset.altoOuterMaterial
      delete root.dataset.altoOuterBackground
      delete root.dataset.altoOuterText
      delete root.dataset.altoOuterTexture
      root.style.removeProperty('--alto-theme-accent')
      root.style.removeProperty('--alto-outer-background')
      root.style.removeProperty('--alto-outer-text')
    }
  }

  setMode(mode: ThemeMode): void {
    if (this.preference.mode === mode) return
    this.preference = { ...this.preference, mode }
    this.changed()
  }

  setChrome(chrome: ChromeTheme): void {
    if (this.preference.chrome === chrome && this.preference.outerPane.background === null) return
    this.preference = {
      ...this.preference,
      chrome,
      outerPane: { ...this.preference.outerPane, background: null },
    }
    this.changed()
  }

  setCode(code: CodeTheme): void {
    if (this.preference.code === code) return
    this.preference = { ...this.preference, code }
    this.changed()
  }

  setAccent(value: string): void {
    const accent = normalizeAccent(value, this.preference.accent)
    if (accent === this.preference.accent) return
    this.preference = { ...this.preference, accent }
    this.changed()
  }

  setOuterPane(update: Partial<OuterPanePreference>): void {
    const outerPane = parseOuterPanePreference({ ...this.preference.outerPane, ...update }, this.preference.outerPane)
    if (sameOuterPane(outerPane, this.preference.outerPane)) return
    this.preference = { ...this.preference, outerPane }
    this.changed()
  }

  resetOuterPane(): void {
    this.setOuterPane(this.defaults.outerPane)
  }

  isOuterPaneDefault(): boolean {
    return sameOuterPane(this.preference.outerPane, this.defaults.outerPane)
  }

  reset(): void {
    if (this.isDefault()) return
    this.preference = { ...this.defaults, outerPane: { ...this.defaults.outerPane } }
    this.changed()
  }

  isDefault(): boolean {
    return this.preference.mode === this.defaults.mode
      && this.preference.accent === this.defaults.accent
      && this.preference.chrome === this.defaults.chrome
      && this.preference.code === this.defaults.code
      && this.isOuterPaneDefault()
  }

  private changed(): void {
    this.write()
    this.apply()
    this.emit()
  }

  private apply(): void {
    if (!this.active) return
    const root = document.documentElement
    root.dataset.altoThemePlugin = 'active'
    root.dataset.altoTheme = resolveThemeMode(this.preference.mode, this.media.matches)
    root.dataset.altoChromeTheme = this.preference.chrome
    root.dataset.altoCodeTheme = this.preference.code
    root.style.setProperty('--alto-theme-accent', this.preference.accent)
    const { outerPane } = this.preference
    const { background, text } = resolveOuterPaneColors(this.preference)
    root.dataset.altoOuterMaterial = outerPane.material
    root.dataset.altoOuterTexture = resolveOuterPaneTexture(outerPane)
    if (background !== null) {
      root.dataset.altoOuterBackground = 'custom'
      root.style.setProperty('--alto-outer-background', background)
    } else {
      delete root.dataset.altoOuterBackground
      root.style.removeProperty('--alto-outer-background')
    }
    if (text !== null) {
      root.dataset.altoOuterText = 'custom'
      root.style.setProperty('--alto-outer-text', text)
    } else {
      delete root.dataset.altoOuterText
      root.style.removeProperty('--alto-outer-text')
    }
  }

  private emit(): void {
    this.state = this.nextSnapshot(this.state.revision + 1)
    for (const listener of this.listeners) listener()
  }

  private nextSnapshot(revision: number): ThemeSnapshot {
    return {
      ...this.preference,
      revision,
      resolved: resolveThemeMode(this.preference.mode, this.media.matches),
    }
  }

  private read(): ThemePreference {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
      return parseThemePreference(stored ? JSON.parse(stored) : undefined, this.defaults)
    } catch {
      return parseThemePreference(undefined, this.defaults)
    }
  }

  private write(): void {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(this.preference))
    } catch {
      // Appearance still changes for this window when persistence is unavailable.
    }
  }
}

function ThemeIcon({ size }: ClientSettingsIconProps): ReactNode {
  return <Palette size={size ?? 15} />
}

function PalettePreview({ kind }: { kind: 'chrome' | 'code' }): ReactNode {
  return (
    <span className={'theme-palette-preview is-' + kind} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

function ThemeColorPicker({
  label,
  value,
  onChange,
  selected = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  selected?: boolean
}): ReactNode {
  return (
    <label className="theme-color-picker" title={label}>
      <input type="color" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} />
      <span className="theme-color-swatch" style={{ backgroundColor: value }} aria-hidden="true">
        {selected && <Check size={12} />}
      </span>
      <code>{value.toLocaleUpperCase()}</code>
    </label>
  )
}

function ThemeSettings({ controller }: { controller: ThemeController }): ReactNode {
  const theme = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const outerColors = resolveOuterPaneColors(theme)
  return (
    <div className="settings-page theme-settings-page">
      <section className="settings-section">
        <h2>Appearance</h2>
        <div className="settings-card theme-settings-card">
          <SettingsRow label="Mode" description="Choose a fixed appearance or follow macOS.">
            <div className="theme-mode-picker" role="radiogroup" aria-label="Appearance mode">
              {modes.map((mode) => {
                const Icon = mode.icon
                const selected = theme.mode === mode.id
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? 'active' : ''}
                    onClick={() => controller.setMode(mode.id)}
                    key={mode.id}
                  >
                    <Icon size={14} />
                    <span>{mode.label}</span>
                  </button>
                )
              })}
            </div>
          </SettingsRow>

          <SettingsRow
            label="Theme"
            description="Choose Alto's color palette."
          >
            <span className="theme-palette-control">
              <PalettePreview kind="chrome" />
              <select
                value={theme.chrome}
                aria-label="Theme palette"
                onChange={(event) => controller.setChrome(event.target.value as ChromeTheme)}
              >
                {chromeThemes.map((palette) => (
                  <option value={palette.id} key={palette.id}>{palette.label}</option>
                ))}
              </select>
            </span>
          </SettingsRow>

          <SettingsRow
            label="Code"
            description="Use one syntax palette for chat code blocks, source files, and diffs."
          >
            <span className="theme-palette-control">
              <PalettePreview kind="code" />
              <select
                value={theme.code}
                aria-label="Code palette"
                onChange={(event) => controller.setCode(event.target.value as CodeTheme)}
              >
                {codeThemes.map((palette) => (
                  <option value={palette.id} key={palette.id}>{palette.label}</option>
                ))}
              </select>
            </span>
          </SettingsRow>

          <SettingsRow label="Accent" description="Used for links, selections, focus, and active controls.">
            <div className="theme-accent-control">
              <div className="theme-accent-presets" role="radiogroup" aria-label="Accent presets">
                {accentPresets.map((preset) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={theme.accent === preset.value}
                    aria-label={preset.label + ' accent'}
                    title={preset.label}
                    className={'theme-accent-preset is-' + preset.id}
                    onClick={() => controller.setAccent(preset.value)}
                    key={preset.value}
                  />
                ))}
              </div>
              <ThemeColorPicker label="Custom accent color" value={theme.accent} onChange={(value) => controller.setAccent(value)} selected />
            </div>
          </SettingsRow>

          <SettingsRow
            label="Reset appearance"
            description="Restore Alto's default mode and color palettes."
            disabled={controller.isDefault()}
            onClick={() => controller.reset()}
          >
            <span className="theme-reset-action">
              <RotateCcw size={13} />
              Reset
            </span>
          </SettingsRow>
        </div>
      </section>

      <section className="settings-section">
        <h2>Outer pane</h2>
        <div className="settings-card theme-settings-card theme-outer-pane-card">
          <SettingsRow label="Surface" description="Sidebar, tabs, and title bar. Composer glass stays independent.">
            <div className="theme-mode-picker theme-outer-material-picker" role="radiogroup" aria-label="Outer pane surface">
              {(['glass', 'solid'] as const).map((material) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={theme.outerPane.material === material}
                  className={theme.outerPane.material === material ? 'active' : ''}
                  onClick={() => controller.setOuterPane({ material })}
                  key={material}
                >
                  {material === 'glass' ? 'Glass' : 'Solid'}
                </button>
              ))}
            </div>
          </SettingsRow>
          <SettingsRow label="Texture" description="Automatic keeps glass clear and adds dots to solid surfaces.">
            <span className="theme-palette-control">
              <select
                value={theme.outerPane.texture}
                aria-label="Outer pane texture"
                onChange={(event) => controller.setOuterPane({ texture: event.target.value as OuterPaneTexture })}
              >
                {outerPaneTextures.map((texture) => <option value={texture.id} key={texture.id}>{texture.label}</option>)}
              </select>
            </span>
          </SettingsRow>
          <SettingsRow label="Background" description="Customize the theme's window color.">
            <div className="theme-outer-color-control">
              <ThemeColorPicker
                label="Outer pane background color"
                value={outerColors.background ?? (theme.resolved === 'dark' ? '#181a20' : '#eef0f3')}
                onChange={(background) => controller.setOuterPane({ background })}
              />
              <button
                type="button"
                className={uiStyles.iconButton}
                aria-label="Reset outer pane background"
                title="Restore the theme's background"
                disabled={theme.outerPane.background === null}
                onClick={() => controller.setOuterPane({ background: null })}
              ><RotateCcw size={14} /></button>
            </div>
          </SettingsRow>
          <SettingsRow label="Text color" description="Automatic chooses light or dark text for your background.">
            <div className="theme-outer-color-control">
              <button
                type="button"
                className={uiStyles.button}
                aria-label="Automatic outer pane text color"
                aria-pressed={theme.outerPane.text === null}
                onClick={() => controller.setOuterPane({ text: null })}
              >Automatic</button>
              <ThemeColorPicker
                label="Outer pane text color"
                value={outerColors.text ?? (theme.resolved === 'dark' ? '#c8ccd8' : '#353a4e')}
                onChange={(text) => controller.setOuterPane({ text })}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            label="Reset outer pane"
            description="Restore the theme's outer appearance."
            disabled={controller.isOuterPaneDefault()}
            onClick={() => controller.resetOuterPane()}
          >
            <span className="theme-reset-action"><RotateCcw size={13} />Reset</span>
          </SettingsRow>
        </div>
      </section>
    </div>
  )
}

const themeClient: BrowserPlugin<ThemeConfig> = (ctx, config) => {
  const controller = new ThemeController(config)
  const Settings = () => <ThemeSettings controller={controller} />

  ctx.effect(() => controller.activate(), 'theme.activate')
  ctx.clientUi.registerStyle(ctx, 'theme', String(styles))
  ctx.clientUi.registerSettingsPage(ctx, {
    id: 'theme',
    label: 'Appearance',
    group: 'Personal',
    keywords: [
      'appearance',
      'theme',
      'dark',
      'light',
      'system',
      'color',
      'accent',
      'chrome',
      'code',
      'syntax',
      'diff',
      'outer',
      'background',
      'black',
      'glass',
      'solid',
      'transparency',
      'text',
      'font',
      'texture',
      'dots',
      'grid',
      'pattern',
    ],
    order: 30,
    icon: ThemeIcon,
    renderer: Settings,
  })
}

themeClient.inject = ['clientUi']

export default themeClient
