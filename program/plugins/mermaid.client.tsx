import { Check, Copy, Maximize2, Minus, Plus, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clientStyles, type ClientOverlays } from '../../src/client/plugin-api.js'
import { uiStyles } from './ui/appearance.js'
import type { Mermaid, MermaidConfig, RenderResult } from 'mermaid'
import type { Plugin } from 'cordis'
import type { MarkdownCodeBlockProps } from './markdown-api.js'
import { DEFAULT_THEME, normalizeAccent } from './theme-api.js'
import { useThemeAppearance, type ClientThemeAppearance } from './theme-runtime.js'
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

function mixColor(accent: string, surface: string, amount: number): string {
  return '#' + [1, 3, 5].map((offset) => (
    Math.round(Number.parseInt(accent.slice(offset, offset + 2), 16) * amount
      + Number.parseInt(surface.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16).padStart(2, '0')
  )).join('')
}

export function mermaidConfiguration(
  config: MermaidDiagramConfig,
  appearance: ClientThemeAppearance = { mode: 'light', accent: DEFAULT_THEME.accent },
): MermaidConfig {
  const dark = appearance.mode === 'dark'
  const accent = normalizeAccent(appearance.accent)
  const surface = dark ? '#262931' : '#f7f7fa'
  const text = dark ? '#c8ccd8' : '#42475d'
  // Mermaid derives other colors from these values, so supply concrete hex
  // colors rather than CSS variables. Neutral ink keeps extreme accents legible.
  const primary = mixColor(accent, surface, dark ? 0.18 : 0.08)
  const primaryBorder = mixColor(accent, text, 0.35)
  const border = dark ? '#565c6d' : '#c7cad5'
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: clamp(config.maxSourceCharacters, 30_000, 1_000, 100_000),
    maxEdges: 500,
    theme: 'base',
    look: 'classic',
    themeVariables: {
      darkMode: dark,
      background: surface,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif',
      fontSize: '14px',
      primaryColor: primary,
      primaryBorderColor: primaryBorder,
      primaryTextColor: text,
      secondaryColor: dark ? '#2c3447' : '#edf2ff',
      secondaryBorderColor: dark ? '#5c6a8b' : '#aebce5',
      secondaryTextColor: text,
      tertiaryColor: dark ? '#2b2e37' : '#f2f3f7',
      tertiaryBorderColor: border,
      tertiaryTextColor: text,
      lineColor: dark ? '#989fb2' : '#858ba0',
      textColor: text,
      mainBkg: primary,
      nodeBorder: primaryBorder,
      clusterBkg: dark ? '#23262e' : '#f5f4fa',
      clusterBorder: dark ? border : '#d8d5e2',
      edgeLabelBackground: surface,
      noteBkgColor: dark ? '#403a24' : '#fff8d9',
      noteBorderColor: dark ? '#9e8948' : '#d8c980',
      noteTextColor: dark ? '#e9ddb6' : '#4d4b43',
      actorBkg: primary,
      actorBorder: primaryBorder,
      actorTextColor: text,
      signalColor: dark ? '#989fb2' : '#73798f',
      signalTextColor: text,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: border,
      labelTextColor: text,
    },
  }
}

async function mermaidRuntime(config: MermaidDiagramConfig, appearance: ClientThemeAppearance): Promise<Mermaid> {
  runtimePromise ??= import('mermaid').then((module) => module.default)
  const runtime = await runtimePromise
  const siteConfig = mermaidConfiguration(config, appearance)
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

function MermaidSvg({ render, expanded = false }: { render: MermaidRenderState; expanded?: boolean }): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (render.status === 'ready' && host.current) render.bindFunctions?.(host.current)
  }, [render])
  return <div
    ref={host}
    className={expanded ? 'cordis-mermaid-expanded-svg' : 'cordis-mermaid-svg'}
    role="img"
    aria-label="Mermaid diagram"
    // Mermaid's strict security mode encodes HTML labels and disables diagram actions.
    dangerouslySetInnerHTML={{ __html: render.svg ?? '' }}
  />
}

function ExpandedDiagram({ render, id, overlays, close }: {
  render: MermaidRenderState
  id: string
  overlays: ClientOverlays | undefined
  close(): void
}): ReactNode {
  const dialog = useRef<HTMLElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState({ width: 1, height: 1, availableWidth: 1, availableHeight: 1 })
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const fit = Math.min(size.availableWidth / size.width, size.availableHeight / size.height, 8)
  const scale = zoom === 'fit' ? fit : zoom
  const diagramSize: CSSProperties = { width: size.width * scale, height: size.height * scale }
  const zoomBy = (factor: number): void => setZoom((current) => (
    Math.max(Math.min(fit, 0.1), Math.min(8, (current === 'fit' ? fit : current) * factor))
  ))

  useLayoutEffect(() => {
    const previous = document.activeElement
    const panel = dialog.current
    overlays?.open(id)
    const unsubscribe = overlays?.subscribe(() => { if (overlays.snapshot() !== id) close() })
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      unsubscribe?.()
      const restore = !overlays?.snapshot() || overlays.snapshot() === id
      overlays?.close(id)
      if (restore && previous instanceof HTMLElement && previous.isConnected
        && (document.activeElement === document.body || panel?.contains(document.activeElement))) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [close, id, overlays])

  useLayoutEffect(() => {
    const region = viewport.current
    const svg = region?.querySelector('svg')
    if (!region || !svg) return
    const measure = (): void => {
      const box = svg.viewBox.baseVal
      const width = box.width || svg.width.baseVal.value || 800
      const height = box.height || svg.height.baseVal.value || 600
      const availableWidth = Math.max(1, region.clientWidth)
      const availableHeight = Math.max(1, region.clientHeight)
      setSize((previous) => previous.width === width && previous.height === height
        && previous.availableWidth === availableWidth && previous.availableHeight === availableHeight
        ? previous : { width, height, availableWidth, availableHeight })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(region)
    measure()
    return () => observer.disconnect()
  }, [render.svg])

  useLayoutEffect(() => {
    const region = viewport.current
    if (!region) return
    region.scrollLeft = (region.scrollWidth - region.clientWidth) / 2
    region.scrollTop = (region.scrollHeight - region.clientHeight) / 2
  }, [scale, size.width, size.height])

  return createPortal(
    <div className={`${clientStyles.overlayLayer} cordis-mermaid-overlay`} onPointerDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      <section ref={dialog} className={`${clientStyles.floatingPanel} ${uiStyles.dialog} cordis-mermaid-expanded`}
        role="dialog" aria-modal="true" aria-label="Expanded Mermaid diagram" data-native-overlay={id}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          } else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')]
            const first = stops[0]
            const last = stops.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault(); last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first?.focus()
            }
          }
        }}>
        <header className="cordis-mermaid-expanded-header">
          <span>Diagram</span>
          <div className="cordis-mermaid-expanded-controls">
            <button className={clientStyles.iconButton} type="button" title="Zoom out" aria-label="Zoom out" disabled={scale <= Math.min(fit, 0.1)} onClick={() => zoomBy(1 / 1.25)}><Minus size={16} /></button>
            <output aria-label="Diagram zoom">{Math.round(scale * 100)}%</output>
            <button className={clientStyles.iconButton} type="button" title="Zoom in" aria-label="Zoom in" disabled={scale >= 8} onClick={() => zoomBy(1.25)}><Plus size={16} /></button>
            <button className={`${clientStyles.button} cordis-mermaid-fit`} type="button" aria-label="Fit diagram to window" onClick={() => setZoom('fit')}>Fit</button>
            <button ref={closeButton} className={clientStyles.iconButton} type="button" title="Close diagram (Esc)" aria-label="Close expanded diagram" onClick={close}><X size={16} /></button>
          </div>
        </header>
        <div ref={viewport} className="cordis-mermaid-expanded-viewport" tabIndex={0} role="region" aria-label="Diagram canvas; scroll to pan">
          <div className="cordis-mermaid-expanded-canvas" style={diagramSize}>
            <div style={diagramSize}><MermaidSvg render={render} expanded /></div>
          </div>
        </div>
      </section>
    </div>,
    document.querySelector('.shell-kernel') ?? document.body,
  )
}

export function MermaidDiagram({
  code,
  config,
  overlays,
}: MarkdownCodeBlockProps & { config: MermaidDiagramConfig; overlays?: ClientOverlays }): ReactNode {
  const { mode, accent } = useThemeAppearance()
  const renderId = `alto-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const stageRef = useRef<HTMLDivElement>(null)
  const [expandedHeight, setExpandedHeight] = useState<number>()
  const closeExpanded = useCallback(() => setExpandedHeight(undefined), [])
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
          const runtime = await mermaidRuntime(config, { mode, accent })
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
  }, [code, config, maxSourceCharacters, renderId, mode, accent])

  useEffect(() => { if (!render.svg) closeExpanded() }, [render.svg, closeExpanded])

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
        <div className="cordis-mermaid-actions">
          <button className={uiStyles.iconButton} type="button" title="Expand diagram" aria-label="Expand diagram" disabled={!render.svg}
            onClick={() => setExpandedHeight(stageRef.current?.getBoundingClientRect().height ?? 0)}>
            <Maximize2 size={14} />
          </button>
          {config.showCopyButton !== false && (
            <button
              className={uiStyles.iconButton}
              type="button"
              title={copied ? 'Copied' : 'Copy diagram source'}
              aria-label={copied ? 'Copied' : 'Copy diagram source'}
              onClick={() => void copy()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </div>
      </figcaption>
      {render.status === 'error' ? (
        <div className="cordis-mermaid-error" role="alert">
          <span>Couldn’t render this diagram.</span>
          {errorSource(code)}
        </div>
      ) : (
        <div ref={stageRef} className="cordis-mermaid-stage" style={expandedHeight === undefined ? undefined : { height: expandedHeight }}>
          {expandedHeight !== undefined && <span className="cordis-mermaid-loading">Diagram expanded</span>}
          {!render.svg && <span className="cordis-mermaid-loading">Drawing diagram…</span>}
          {render.svg && expandedHeight === undefined && <MermaidSvg render={render} />}
        </div>
      )}
      {render.svg && expandedHeight !== undefined && <ExpandedDiagram render={render} id={`${renderId}-expanded`} overlays={overlays} close={closeExpanded} />}
    </figure>
  )
}

const mermaidClient: Plugin<MermaidDiagramConfig> = (ctx, config) => {
  const overlays = ctx.clientUi.overlays
  const Renderer = (props: MarkdownCodeBlockProps) => <MermaidDiagram {...props} config={config} overlays={overlays} />
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
