import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  buildRichReplyDocument,
  RICH_REPLY_CONTENT_SECURITY_POLICY,
} from './rich-replies-document.js'

const MAX_DOCUMENTS = 128
const DOCUMENT_TTL_MS = 60 * 60 * 1_000

interface StoredDocument {
  document: string
  expiresAt: number
}

export class RichReplyDocumentServer {
  private readonly documents = new Map<string, StoredDocument>()
  private server?: Server
  private opening?: Promise<string>
  private active = true

  async render(source: string): Promise<{ url: string; token: string; title: string }> {
    if (!this.active) throw new Error('Rich replies have been unloaded')
    const origin = await (this.opening ??= this.listen())
    if (!this.active) throw new Error('Rich replies have been unloaded')
    const token = randomUUID()
    const path = `/reply/${randomUUID()}`
    const { document, title } = buildRichReplyDocument(source, token)
    this.expireDocuments()
    if (this.documents.size >= MAX_DOCUMENTS) this.documents.delete(this.documents.keys().next().value!)
    this.documents.set(path, { document, expiresAt: Date.now() + DOCUMENT_TTL_MS })
    return { url: `${origin}${path}`, token, title }
  }

  private address(): string {
    const address = this.server?.address()
    return address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : ''
  }

  private async listen(): Promise<string> {
    const server = createServer((request, response) => this.serve(request, response))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    return `http://${this.address()}`
  }

  private expireDocuments(): void {
    const now = Date.now()
    for (const [path, entry] of this.documents) {
      if (entry.expiresAt <= now) this.documents.delete(path)
    }
  }

  private serve(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', `${RICH_REPLY_CONTENT_SECURITY_POLICY}; sandbox allow-scripts`)
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    if (!this.active || request.headers.host !== this.address()) {
      response.writeHead(403).end('Forbidden')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      response.writeHead(405).end('Method not allowed')
      return
    }
    this.expireDocuments()
    const entry = this.documents.get(request.url ?? '')
    if (!entry) {
      response.writeHead(404).end(request.method === 'HEAD' ? undefined : 'Rich reply not found')
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.writeHead(200).end(request.method === 'HEAD' ? undefined : entry.document)
  }

  async dispose(): Promise<void> {
    this.active = false
    this.documents.clear()
    await this.opening?.catch(() => undefined)
    this.server?.closeAllConnections()
    if (this.server?.listening) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    }
  }
}
