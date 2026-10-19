import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { isRecord } from '../../src/shared/protocol.js'
import { RICH_REPLY_LIMIT } from './rich-replies-document.js'
import { RichReplyDocumentServer } from './rich-replies-server.js'

export const MAX_REPLY_HTML_CHARACTERS = RICH_REPLY_LIMIT
const MAX_TITLE_CHARACTERS = 160

export const richReplyGuidance = `Rich replies are available in every chat:
- Never use rich UI merely to display or restyle text. If the answer works as normal text or Markdown, use that instead. Rich UI must add a useful visualization or meaningful interaction that Markdown cannot provide; changing fonts, colors, columns, or decoration alone does not count. Keep rich replies compact and follow the user's requested format.
- Make the HTML the answer itself, flowing with the conversation. Compose it with typography, whitespace, diagrams, and inline controls. Omit a generic enclosing card, box, background panel, or title bar. Do not repeat the answer in a plain-text introduction followed by an embedded widget; surrounding prose should add necessary context that the HTML does not already contain.
- To prepare a rich reply, call the Cordis reply/html tool with { html, title? }. Then copy its markdown field verbatim into your visible assistant reply. Calling the tool alone does not display anything. Only an alto-html fence renders rich content; ordinary html fences remain source examples.
- Supply self-contained HTML with inline CSS and optional inline JavaScript. Use small local interactions when useful. Scripts run in a separate sandbox without access to Alto, the parent document, files, or host tools. External scripts, styles, images, fetch, and WebSocket connections are blocked; do not use external libraries, forms, popups, storage, or privileged host calls. Navigation is unsupported. Controls may only change content inside the reply. Do not imply that they run commands or save changes.
- Use semantic HTML, readable contrast, visible keyboard focus, labels for controls, and reduced-motion support when animating. Use natural content height so the conversation scrolls the answer. Avoid fixed/max-height scrolling sections and viewport-height layouts (vh); let tables and expanded details grow. Keep max-width:100% and wrap text. Prefer a small native control to elaborate custom UI.
- Alto supplies a readable, transparent body with margin:0 and padding:0. Theme variables are --alto-bg, --alto-fg, --alto-muted, --alto-border, --alto-accent, and --alto-font. Inherit these defaults; --alto-bg is the conversation background for intentional colored areas, not a required wrapper fill. A borderless semantic answer can use: <section aria-label="Comparison"><h2>Two approaches</h2><p>...</p><details><summary>Show assumptions</summary><p style="color:var(--alto-muted)">...</p></details></section>. The optional title is an accessible name only; do not repeat it as a visible frame header. Keep HTML below 60,000 characters.`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function htmlArgument(value: unknown, withTitle: boolean): { html: string; title?: string } {
  const allowed = withTitle ? ['html', 'title'] : ['html']
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(withTitle
      ? 'reply/html expects an object containing html and an optional title'
      : 'rich-replies.render expects an object containing html')
  }
  if (typeof value.html !== 'string' || !value.html.trim()) {
    throw new Error('html must be a non-empty string')
  }
  if (value.html.length > MAX_REPLY_HTML_CHARACTERS) {
    throw new Error(`html must contain at most ${MAX_REPLY_HTML_CHARACTERS} characters`)
  }
  if (value.title !== undefined && (
    typeof value.title !== 'string'
    || !value.title.trim()
    || value.title.length > MAX_TITLE_CHARACTERS
  )) {
    throw new Error(`title must be a non-empty string of at most ${MAX_TITLE_CHARACTERS} characters`)
  }
  return { html: value.html, ...(typeof value.title === 'string' ? { title: value.title } : {}) }
}

function replyMarkdown(value: unknown): string {
  const { html, title } = htmlArgument(value, true)
  const source = title === undefined ? html : `<title>${escapeHtml(title)}</title>\n${html}`
  if (source.length > MAX_REPLY_HTML_CHARACTERS) {
    throw new Error(`html including its title must contain at most ${MAX_REPLY_HTML_CHARACTERS} characters`)
  }
  let fenceLength = 3
  for (const run of source.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, run[0].length + 1)
  const fence = '`'.repeat(fenceLength)
  return `${fence}alto-html\n${source}\n${fence}`
}

const richReplies: HarnessPlugin = (ctx) => {
  let documentServer: RichReplyDocumentServer | undefined
  ctx.effect(() => {
    const server = new RichReplyDocumentServer()
    documentServer = server
    return () => {
      documentServer = undefined
      return server.dispose()
    }
  }, 'rich-replies.documentServer')
  ctx.clientExtensions.registerMethod(ctx, 'rich-replies.render', async (payload) => {
    const { html } = htmlArgument(payload, false)
    if (!documentServer) throw new Error('Rich replies have been unloaded')
    return documentServer.render(html)
  })
  ctx.tools.register(ctx, {
    namespace: 'reply',
    name: 'html',
    description: 'Prepare a compact rich HTML reply only when a useful visualization or meaningful interaction adds value beyond normal text or Markdown. Never use it merely to display or restyle text. Returns a markdown field to copy verbatim into your visible assistant response; the tool does not display content itself. HTML runs in an isolated sandbox without external resources or host access.',
    inputSchema: {
      type: 'object',
      required: ['html'],
      properties: {
        html: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_REPLY_HTML_CHARACTERS,
          description: 'Responsive HTML with inline CSS and optional local inline JavaScript. No external resources, network, forms, popups, navigation, storage, or host calls.',
        },
        title: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_TITLE_CHARACTERS,
          description: 'A short accessible name for this reply.',
        },
      },
      additionalProperties: false,
    },
  }, (call) => ({ markdown: replyMarkdown(call.arguments) }))

  ctx.on('codex/turn/prepare', async (_draft, next) => {
    const prepared = await next()
    return {
      ...prepared,
      additionalContext: {
        ...prepared.additionalContext,
        rich_replies: { kind: 'application', value: richReplyGuidance },
      },
    }
  })
}

richReplies.inject = ['clientExtensions', 'tools', 'turnProgram']

export default richReplies
