import { Check, Copy } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Mermaid, MermaidConfig, RenderResult } from 'mermaid'
import type { Plugin } from 'cordis'
import type { MarkdownCodeBlockProps } from './markdown-api.js'
import styles from './mermaid.css'

export interface MermaidDiagramConfig {
  showLabel?: boolean
  showCopyButton?: boolean
  maxHeight?: number
  maxSourceCharacters?: number
}

interface MermaidRenderState {
  status: 'loading' | 'updating' | 'ready' | 'error'
  svg?: string
  bindFunctions?: RenderResult['bindFunctions']
}

let runtimePromise: Promise<Mermaid> | undefined
let activeConfiguration = ''
let renderSequence = 0

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value ?? fallback))
}

export function mermaidConfiguration(config: MermaidDiagramConfig): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: clamp(config.maxSourceCharacters, 30_000, 1_000, 100_000),
    maxEdges: 500,
    theme: 'base',
    look: 'classic',
    themeVariables: {
      background: '#f7f7fa',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif',
      fontSize: '14px',
      primaryColor: '#f0edff',
      primaryBorderColor: '#a993f1',
      primaryTextColor: '#42475d',
      secondaryColor: '#edf2ff',
      secondaryBorderColor: '#aebce5',
      secondaryTextColor: '#42475d',
      tertiaryColor: '#f2f3f7',
      tertiaryBorderColor: '#c7cad5',
      tertiaryTextColor: '#42475d',
      lineColor: '#858ba0',
      textColor: '#42475d',
      mainBkg: '#f0edff',
      nodeBorder: '#a993f1',
      clusterBkg: '#f5f4fa',
      clusterBorder: '#d8d5e2',
      edgeLabelBackground: '#f7f7fa',
      noteBkgColor: '#fff8d9',
      noteBorderColor: '#d8c980',
      noteTextColor: '#4d4b43',
      actorBkg: '#f0edff',
      actorBorder: '#a993f1',
      actorTextColor: '#42475d',
      signalColor: '#73798f',
      signalTextColor: '#42475d',
      labelBoxBkgColor: '#f7f7fa',
      labelBoxBorderColor: '#c7cad5',
      labelTextColor: '#42475d',
    },
  }
}

async function mermaidRuntime(config: MermaidDiagramConfig): Promise<Mermaid> {
  runtimePromise ??= import('mermaid').then((module) => module.default)
  const runtime = await runtimePromise
  const siteConfig = mermaidConfiguration(config)
  const signature = JSON.stringify(siteConfig)
  if (signature !== activeConfiguration) {
    runtime.initialize(siteConfig)
    activeConfiguration = signature
  }
  return runtime
}

function errorSource(code: string): ReactNode {
  return (
    <details>
      <summary>View diagram source</summary>
      <pre><code>{code}</code></pre>
    </details>
  )
}

export function MermaidDiagram({
  code,
  config,
}: MarkdownCodeBlockProps & { config: MermaidDiagramConfig }): ReactNode {
  const renderId = `alto-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hostRef = useRef<HTMLDivElement>(null)
  const copiedTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [render, setRender] = useState<MermaidRenderState>({ status: 'loading' })
  const maxSourceCharacters = clamp(config.maxSourceCharacters, 30_000, 1_000, 100_000)
  const style = {
    '--mermaid-max-height': `${clamp(config.maxHeight, 520, 180, 1_200)}px`,
  } as CSSProperties

  useEffect(() => {
    let active = true
    const source = code.trim()
    if (!source || source.length > maxSourceCharacters) {
      setRender({ status: 'error' })
      return () => { active = false }
    }

    setRender((current) => current.svg
      ? { ...current, status: 'updating' }
      : { status: 'loading' })
    const requestId = `${renderId}-${++renderSequence}`
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const runtime = await mermaidRuntime(config)
          const valid = await runtime.parse(source, { suppressErrors: true })
          if (!valid) throw new Error('Invalid Mermaid diagram')
          // Mermaid uses this id while building the SVG. A fresh id avoids
          // colliding with the previous diagram while streamed text rerenders.
          const result = await runtime.render(requestId, source)
          if (active) {
            setRender({
              status: 'ready',
              svg: result.svg,
              ...(result.bindFunctions ? { bindFunctions: result.bindFunctions } : {}),
            })
          }
        } catch {
          if (active) setRender({ status: 'error' })
        }
      })()
    }, 120)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [code, config, maxSourceCharacters, renderId])

  useEffect(() => {
    if (render.status === 'ready' && hostRef.current) {
      render.bindFunctions?.(hostRef.current)
    }
  }, [render])

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
  }, [])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure
      className={`cordis-mermaid is-${render.status}`}
      style={style}
      aria-busy={render.status === 'loading' || render.status === 'updating'}
    >
      <figcaption>
        {config.showLabel !== false ? <span>Diagram</span> : <span />}
        {config.showCopyButton !== false && (
          <button
            type="button"
            title={copied ? 'Copied' : 'Copy diagram source'}
            aria-label={copied ? 'Copied' : 'Copy diagram source'}
            onClick={() => void copy()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </figcaption>
      {render.status === 'error' ? (
        <div className="cordis-mermaid-error" role="alert">
          <span>Couldn’t render this diagram.</span>
          {errorSource(code)}
        </div>
      ) : (
        <div className="cordis-mermaid-stage">
          {!render.svg && <span className="cordis-mermaid-loading">Drawing diagram…</span>}
          {render.svg && (
            <div
              ref={hostRef}
              className="cordis-mermaid-svg"
              role="img"
              aria-label="Mermaid diagram"
              // Mermaid's strict security mode encodes HTML labels and disables diagram actions.
              dangerouslySetInnerHTML={{ __html: render.svg }}
            />
          )}
        </div>
      )}
    </figure>
  )
}

const mermaidClient: Plugin<MermaidDiagramConfig> = (ctx, config) => {
  const Renderer = (props: MarkdownCodeBlockProps) => <MermaidDiagram {...props} config={config} />
  ctx.clientMarkdown.registerCodeBlock(ctx, {
    id: 'default-mermaid-diagram',
    component: Renderer,
    languages: ['mermaid'],
    priority: 100,
  })
  ctx.clientUi.registerStyle(ctx, 'default-mermaid-diagram', String(styles))
}

mermaidClient.inject = ['clientMarkdown', 'clientUi']

export default mermaidClient
