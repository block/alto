import { useEffect, useRef, useState } from 'react'
import type { BrowserPlugin, ClientHostService } from '../../src/client/plugin-api.js'
import { clientStyles } from '../../src/client/plugin-api.js'
import type { MarkdownCodeBlockProps } from './markdown-api.js'
import { RICH_REPLY_LIMIT } from './rich-replies-document.js'
import styles from './rich-replies.css'

interface Preview { url: string; token: string; title: string }

function RichReply({ code, host }: MarkdownCodeBlockProps & { host: ClientHostService }) {
  const [source, setSource] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(200)
  const [preview, setPreview] = useState<Preview>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    setPreview(undefined)
    setError(undefined)
    setHeight(200)
    if (code.length > RICH_REPLY_LIMIT) {
      setError('This rich reply is too large to preview. View its HTML source instead.')
      return
    }
    // Wait for a pause in streamed Markdown before executing a new document.
    const timer = window.setTimeout(() => void host.call('rich-replies.render', { html: code }).then((result) => {
      if (!active) return
      const value = result as unknown as Preview
      const url = new URL(value.url)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !value.token || typeof value.title !== 'string') throw new Error('The rich reply preview is unavailable.')
      setPreview(value)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not prepare this rich reply.')
    }), 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [code, host])

  useEffect(() => {
    const iframe = frame.current
    if (!iframe || !preview) return
    let resizeFrame = 0
    let nextHeight = 200
    const updateTheme = () => {
      if (!container.current) return
      const theme = getComputedStyle(container.current)
      const values = {
        '--alto-bg': theme.getPropertyValue('--canvas') || '#f2f3f6',
        '--alto-fg': theme.getPropertyValue('--text-strong') || '#353a4e',
        '--alto-muted': theme.getPropertyValue('--muted') || '#898fa1',
        '--alto-border': theme.getPropertyValue('--border') || '#dcdfe5',
        '--alto-accent': theme.getPropertyValue('--accent') || '#7c3aed',
        '--alto-font': theme.fontFamily,
      }
      iframe.contentWindow?.postMessage({ type: 'alto.rich-reply.theme', token: preview.token, values, scheme: theme.colorScheme }, '*')
    }
    const receive = (event: MessageEvent) => {
      const data = event.data
      if (event.source !== iframe.contentWindow || event.origin !== 'null' || !data || data.type !== 'alto.rich-reply.resize' || data.token !== preview.token) return
      if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      // Replies belong to the conversation's scroll flow. Keep only a generous
      // defensive bound for pathological reports from an executable document.
      nextHeight = Math.min(1_000_000, Math.max(80, Math.ceil(data.height)))
      if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; setHeight(nextHeight) })
    }
    window.addEventListener('message', receive)
    iframe.addEventListener('load', updateTheme)
    updateTheme()
    const themeObserver = new MutationObserver(updateTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-alto-theme'] })
    const shell = container.current?.closest('.shell-kernel')
    if (shell) themeObserver.observe(shell, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => {
      window.removeEventListener('message', receive)
      cancelAnimationFrame(resizeFrame)
      iframe.removeEventListener('load', updateTheme)
      themeObserver.disconnect()
    }
  }, [preview])

  return <div ref={container} className={`rich-reply${source ? ' is-source' : ''}`} role="group" aria-label={preview?.title ?? 'Rich reply'}>
    {error && <p className="rich-reply-error" role="alert">{error}</p>}
    {!error && !preview && !source && <p className="rich-reply-loading" role="status">Preparing reply…</p>}
    {preview && <iframe ref={frame} className="rich-reply-frame" title={preview.title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={preview.url} height={height} hidden={source} />}
    {(source || error) && <pre className="rich-reply-source"><code>{code}</code></pre>}
    <div className="rich-reply-controls">
      <button className={`${clientStyles.button} rich-reply-toggle`} type="button" aria-label={source ? 'Show rich reply' : 'Show HTML source'} aria-pressed={source} onClick={() => setSource(!source)}>{source ? 'Back to reply' : 'HTML'}</button>
    </div>
  </div>
}

const richReplies: BrowserPlugin = (ctx) => {
  const host = ctx.clientHost
  const Renderer = (props: MarkdownCodeBlockProps) => <RichReply {...props} host={host} />
  ctx.clientMarkdown.registerCodeBlock(ctx, {
    id: 'rich-replies.html',
    component: Renderer,
    languages: ['alto-html'],
    priority: 100,
  })
  ctx.clientUi.registerStyle(ctx, 'rich-replies', String(styles))
}

richReplies.inject = ['clientHost', 'clientMarkdown', 'clientUi']
export default richReplies
