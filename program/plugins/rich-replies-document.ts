export const RICH_REPLY_LIMIT = 60_000

// This policy applies to the separate document origin, never to Alto itself.
// The iframe and response header also sandbox the document without same-origin.
export const RICH_REPLY_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function replyTitle(source: string): string {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)?.[1] ?? 'Rich reply'
  return raw.replace(/&(?:amp|lt|gt|quot|apos|#39);/gi, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" })[entity.toLowerCase()]!).replace(/\s+/g, ' ').trim().slice(0, 160) || 'Rich reply'
}

export function buildRichReplyDocument(source: string, token: string): { document: string; title: string } {
  if (source.length > RICH_REPLY_LIMIT) throw new Error('This rich reply is too large to preview. View its HTML source instead.')
  const title = replyTitle(source)
  // Only palette updates enter this frame. Resize reports have no host actions.
  const serializedToken = JSON.stringify(token).replace(/</g, '\\u003c')
  const bootstrap = `(() => {
    const token = ${serializedToken};
    const report = () => {
      if (!document.body) return;
      const height = Math.ceil(document.body.getBoundingClientRect().height);
      parent.postMessage({ type: 'alto.rich-reply.resize', token, height }, '*');
    };
    addEventListener('message', event => {
      const data = event.data;
      if (event.source !== parent || !data || data.type !== 'alto.rich-reply.theme' || data.token !== token) return;
      for (const key of ['--alto-bg', '--alto-fg', '--alto-muted', '--alto-border', '--alto-accent', '--alto-font']) {
        if (typeof data.values?.[key] === 'string') document.documentElement.style.setProperty(key, data.values[key]);
      }
      if (data.scheme === 'light' || data.scheme === 'dark') document.documentElement.style.colorScheme = data.scheme;
      report();
    });
    addEventListener('DOMContentLoaded', () => {
      new ResizeObserver(report).observe(document.body);
      report();
    });
  })();`
  return {
    title,
    document: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${RICH_REPLY_CONTENT_SECURITY_POLICY}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(title)}</title><style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      html { overflow-x: hidden; background: transparent; }
      body { margin: 0; padding: 0; background: transparent; color: var(--alto-fg, #353a4e); font: 14px/1.55 var(--alto-font, system-ui, sans-serif); overflow-wrap: anywhere; }
      img, svg { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; }
      table { max-width: 100%; border-collapse: collapse; }
      th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--alto-border, #dcdfe5); }
      button, input, select, textarea { max-width: 100%; font: inherit; accent-color: var(--alto-accent, #7c3aed); }
      button, summary { cursor: pointer; }
      :focus-visible { outline: 2px solid var(--alto-accent, #7c3aed); outline-offset: 3px; }
      h1, h2, h3, p { margin: 0 0 12px; }
      body > :last-child { margin-bottom: 0; }
    </style><script>${bootstrap}</script></head><body>${source}</body></html>`,
  }
}
