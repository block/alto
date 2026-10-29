import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MermaidDiagram,
  mermaidConfiguration,
} from '../program/plugins/mermaid.client.js'

describe('Mermaid diagrams', () => {
  it('uses a strict bounded site configuration for untrusted chat content', () => {
    const config = mermaidConfiguration({ maxSourceCharacters: 250_000 })

    expect(config).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 100_000,
      maxEdges: 500,
      theme: 'base',
    })
  })

  it('renders a stable inline placeholder before the lazy renderer resolves', () => {
    const html = renderToStaticMarkup(
      <MermaidDiagram
        code={'flowchart LR\n  A --> B'}
        language="mermaid"
        config={{}}
      />,
    )

    expect(html).toContain('cordis-mermaid is-loading')
    expect(html).toContain('Drawing diagram')
    expect(html).toContain('aria-busy="true"')
  })

  it.each(['light', 'dark'] as const)('uses the selected accent for default %s nodes without recoloring semantic notes', (mode) => {
    const palettes = ['#2563eb', '#16a34a', '#ffffff', '#000000'].map((accent) => (
      mermaidConfiguration({}, { mode, accent }).themeVariables!
    ))
    expect(new Set(palettes.map((palette) => palette.primaryColor)).size).toBe(palettes.length)
    expect(new Set(palettes.map((palette) => palette.primaryBorderColor)).size).toBe(palettes.length)
    for (const palette of palettes) {
      expect(palette.mainBkg).toBe(palette.primaryColor)
      expect(palette.actorBkg).toBe(palette.primaryColor)
      expect(palette.nodeBorder).toBe(palette.primaryBorderColor)
      expect(palette.actorBorder).toBe(palette.primaryBorderColor)
      expect(palette.noteBkgColor).toBe(palettes[0].noteBkgColor)
      expect(palette.noteBkgColor).not.toBe(palette.primaryColor)
    }
  })

  it('keeps diagram labels and node boundaries readable for pale and extreme accents in either mode', () => {
    const luminance = (hex: string): number => [1, 3, 5].reduce((sum, offset, index) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!
    }, 0)
    const contrast = (first: string, second: string): number => {
      const a = luminance(first), b = luminance(second)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    for (const mode of ['light', 'dark'] as const) for (const accent of ['#7c3aed', '#16a34a', '#ea580c', '#fff8d6', '#ffffff', '#000000']) {
      const palette = mermaidConfiguration({}, { mode, accent }).themeVariables!
      expect(contrast(palette.primaryTextColor, palette.primaryColor)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.primaryBorderColor, palette.primaryColor)).toBeGreaterThanOrEqual(3)
      expect(contrast(palette.noteTextColor, palette.noteBkgColor)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
