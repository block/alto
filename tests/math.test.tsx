import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DefaultMath,
  bundledMathStyles,
  mathMarkup,
  normalizeLatexDelimiters,
} from '../program/plugins/math.client.js'

describe('KaTeX math renderer', () => {
  it('emits accessible HTML and MathML without trusting TeX commands', () => {
    const html = mathMarkup(String.raw`R(f(x,y)) = R(x) \cap R(y)`, false)

    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-mathml"')
    expect(html).toContain('<math')
  })

  it('renders centered display math with fiber-owned styling', () => {
    const html = renderToStaticMarkup(
      <DefaultMath formula={String.raw`U \cap \{Alice\}`} display config={{}} />,
    )

    expect(html).toContain('cordis-math-display')
    expect(html).toContain('katex-display')
    expect(bundledMathStyles()).toContain('KaTeX_Main')
  })

  it('accepts ChatGPT-style LaTeX delimiters without rewriting code', () => {
    const source = [
      String.raw`Inline \(R(x) \cap R(y)\).`,
      '',
      String.raw`\[`,
      String.raw`R(x) \cap R(y)`,
      String.raw`\]`,
      '',
      'Keep `\\(literal\\)` inside inline code.',
      '',
      '```text',
      String.raw`\[also literal\]`,
      '```',
    ].join('\n')

    expect(normalizeLatexDelimiters(source)).toBe([
      String.raw`Inline $R(x) \cap R(y)$.`,
      '',
      '$$',
      String.raw`R(x) \cap R(y)`,
      '$$',
      '',
      'Keep `\\(literal\\)` inside inline code.',
      '',
      '```text',
      String.raw`\[also literal\]`,
      '```',
    ].join('\n'))
  })
})
