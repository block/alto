import { Context, type Plugin } from 'cordis'
import { request } from 'node:http'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import richReplies, {
  MAX_REPLY_HTML_CHARACTERS,
  richReplyGuidance,
} from '../program/plugins/rich-replies.js'
import type { DynamicToolResult } from '../src/server/plugin-api.js'
import { clientExtensionRegistryPlugin } from '../src/server/services/client-extension-registry.js'
import { toolRegistryPlugin } from '../src/server/services/tool-registry.js'
import { turnProgramPlugin } from '../src/server/services/turn-program.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

async function fixture() {
  const ctx = new Context()
  for (const plugin of [clientExtensionRegistryPlugin, toolRegistryPlugin, turnProgramPlugin]) {
    const fiber = await ctx.plugin(plugin)
    cleanup.push(() => fiber.dispose())
  }
  const fiber = await ctx.plugin(richReplies)
  cleanup.push(() => fiber.dispose())
  const invoke = (args: unknown) => ctx.tools.execute({
    callId: 'reply-call', threadId: 'thread', turnId: 'turn',
    tool: 'cordis', arguments: { operation: 'invoke', tool: 'reply/html', arguments: args },
  })
  return { ctx, fiber, invoke }
}

function markdown(result: DynamicToolResult): string {
  expect(result.success).toBe(true)
  return (JSON.parse(result.contentItems[0]!.text!) as { markdown: string }).markdown
}

describe('rich reply tools and guidance', () => {
  it('advertises its limits and prepares a visible reply without changing chat state', async () => {
    const { ctx, invoke } = await fixture()
    expect(ctx.tools.list()).toMatchObject([{
      namespace: 'reply', name: 'html', inputSchema: {
        required: ['html'], additionalProperties: false,
        properties: { html: { maxLength: MAX_REPLY_HTML_CHARACTERS }, title: { maxLength: 160 } },
      },
    }])
    const html = '<section><h2>Comparison</h2><p>A compact explanation.</p></section>'
    expect(markdown(await invoke({ html }))).toBe(`\`\`\`alto-html\n${html}\n\`\`\``)
    expect(markdown(await invoke({ html, title: 'A < B & "C"' })))
      .toContain('<title>A &lt; B &amp; &quot;C&quot;</title>')
    expect(markdown(await invoke({ html: 'x'.repeat(MAX_REPLY_HTML_CHARACTERS) }))).toContain('alto-html')
  })

  it.each([
    null, [], { html: 4 }, {}, { html: '' }, { html: ' \n\t' },
    { html: 'x'.repeat(MAX_REPLY_HTML_CHARACTERS + 1) },
    { html: '<p>Hello</p>', title: 1 }, { html: '<p>Hello</p>', title: '' },
    { html: '<p>Hello</p>', title: ' ' }, { html: '<p>Hello</p>', title: 'x'.repeat(161) },
    { html: '<p>Hello</p>', external: true },
  ])('rejects invalid input %# at execution as well as in the schema', async (args) => {
    const { invoke } = await fixture()
    const result = await invoke(args)
    expect(result.success).toBe(false)
    expect(result.contentItems[0]?.text).toMatch(/html|title/)
  })

  it('keeps embedded backtick fences and title markup inside one literal code block', async () => {
    const { invoke } = await fixture()
    const html = '<pre>```\n# outside?\n`````\n<script>const s = `hello`</script></pre>'
    const prepared = markdown(await invoke({ html, title: '</title><script>escape()</script> ``````' }))
    expect(prepared.startsWith('```````alto-html\n')).toBe(true)
    const rendered = renderToStaticMarkup(createElement(ReactMarkdown, { children: prepared }))
    expect(rendered.match(/<pre>/g)).toHaveLength(1)
    expect(rendered).toContain('class="language-alto-html"')
    expect(rendered).not.toMatch(/<h1>|<script>/)
    expect(rendered).toContain('&lt;script&gt;const s = `hello`&lt;/script&gt;')
  })

  it('keeps titled replies within the document size bound', async () => {
    const { invoke } = await fixture()
    expect((await invoke({ html: 'x'.repeat(MAX_REPLY_HTML_CHARACTERS), title: 'Title' })).success).toBe(false)
  })

  it('adds bounded application guidance on every turn while preserving other middleware', async () => {
    const { ctx } = await fixture()
    const other: Plugin = (owner) => {
      owner.on('codex/turn/prepare', async (_draft, next) => {
        const prepared = await next()
        return { ...prepared, model: 'kept-model', additionalContext: {
          ...prepared.additionalContext, other: { kind: 'application', value: 'Other instructions.' },
        } }
      })
    }
    const otherFiber = await ctx.plugin(other)
    cleanup.push(() => otherFiber.dispose())
    expect(Buffer.byteLength(richReplyGuidance, 'utf8')).toBeLessThan(4_000)
    for (const threadId of ['codex-thread', 'acp-thread', 'codex-thread']) {
      const input = [{ type: 'text' as const, text: 'Continue.' }]
      const prepared = await ctx.turnProgram.prepare({ threadId, input, additionalContext: {
        attachment: { kind: 'untrusted', value: 'Keep attached data.' },
      } })
      expect(prepared).toEqual({ threadId, input, model: 'kept-model', additionalContext: {
        attachment: { kind: 'untrusted', value: 'Keep attached data.' },
        other: { kind: 'application', value: 'Other instructions.' },
        rich_replies: { kind: 'application', value: richReplyGuidance },
      } })
    }
  })

  it('removes its tool and turn guidance when its fiber is disposed', async () => {
    const { ctx, fiber, invoke } = await fixture()
    await fiber.dispose()
    expect(ctx.tools.list()).toEqual([])
    expect((await invoke({ html: '<p>Hello</p>' })).success).toBe(false)
    expect(await ctx.turnProgram.prepare({ threadId: 'thread', input: [] }))
      .toEqual({ threadId: 'thread', input: [] })
  })

  it('serves inline scripts from a separate loopback origin under an opaque sandbox policy', async () => {
    const { ctx } = await fixture()
    const html = '<title>Interactive reply</title><button id="count">0</button><script>count.onclick=()=>count.textContent++</script>'
    const rendered = await ctx.clientExtensions.call('rich-replies.render', { html }) as { url: string; title: string; token: string }
    expect(rendered).toMatchObject({ title: 'Interactive reply', token: expect.any(String) })
    expect(rendered.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/reply\/[a-f\d-]+$/)
    const response = await fetch(rendered.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const policy = response.headers.get('Content-Security-Policy')!
    expect(policy).toContain("script-src 'unsafe-inline'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-src 'none'")
    expect(policy).toContain('sandbox allow-scripts')
    expect(policy).not.toContain('allow-same-origin')
    const document = await response.text()
    expect(document).toContain(html)
    expect(document).toContain(rendered.token)
    expect((await fetch(rendered.url, { method: 'HEAD' })).status).toBe(200)
    const rejected = await fetch(rendered.url, { method: 'POST', body: 'ignored' })
    expect(rejected.status).toBe(405)
    expect(rejected.headers.get('Allow')).toBe('GET, HEAD')
    expect((await fetch(`${rendered.url}/unknown`)).status).toBe(404)
    const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
      request(rendered.url, { headers: { Host: 'attacker.test' } }, (reply) => {
        reply.resume()
        reply.on('end', () => resolve(reply.statusCode))
      }).on('error', reject).end()
    })
    expect(forgedHost).toBe(403)
  })

  it.each([null, {}, { html: '' }, { html: ' ' }, { html: 1 },
    { html: 'x'.repeat(MAX_REPLY_HTML_CHARACTERS + 1) }, { html: '<p>Hi</p>', title: 'Unexpected' },
  ])('validates document extension input %#', async (payload) => {
    const { ctx } = await fixture()
    await expect(ctx.clientExtensions.call('rich-replies.render', payload)).rejects.toThrow(/html/)
  })

  it('bounds the document cache and expires retained URLs after an hour', async () => {
    const { ctx } = await fixture()
    const render = async () => await ctx.clientExtensions.call('rich-replies.render', { html: '<p>Hello</p>' }) as { url: string }
    const first = await render()
    let latest = first
    for (let index = 0; index < 128; index++) latest = await render()
    expect((await fetch(first.url)).status).toBe(404)
    expect((await fetch(latest.url)).status).toBe(200)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60 * 1_000 + 1)
    expect((await fetch(latest.url)).status).toBe(404)
  })

  it('closes the document server and removes its extension when the fiber unloads', async () => {
    const { ctx, fiber } = await fixture()
    const { url } = await ctx.clientExtensions.call('rich-replies.render', { html: '<p>Hello</p>' }) as { url: string }
    expect((await fetch(url)).status).toBe(200)
    await fiber.dispose()
    await expect(ctx.clientExtensions.call('rich-replies.render', { html: '<p>Hello</p>' })).rejects.toThrow('unknown client extension')
    await expect(fetch(url)).rejects.toThrow()
  })

  it('does not retain a server or publish a document after disposal races startup', async () => {
    const { ctx, fiber } = await fixture()
    const pending = ctx.clientExtensions.call('rich-replies.render', { html: '<p>Hello</p>' })
    const rejected = expect(pending).rejects.toThrow('unloaded')
    await fiber.dispose()
    await rejected
  })
})
