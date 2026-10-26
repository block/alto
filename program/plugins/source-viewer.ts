import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import {
  SOURCE_VIEWER_READ_METHOD,
  type SourceDocument,
} from './source-viewer-api.js'
import { resolveReadableFile } from './workspace-files.js'
import {
  SOURCE_EDIT_APPLY_METHOD,
  SOURCE_EDIT_DISCARD_METHOD,
  SOURCE_EDIT_START_METHOD,
  SOURCE_EDIT_STATUS_METHOD,
} from './source-edit-api.js'
import { containsSourceEditRequest, SourceEdits } from './source-edits.js'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

export async function readSourceDocument(
  filePath: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<SourceDocument> {
  const resolved = await resolveReadableFile(filePath)
  const metadata = await stat(resolved)
  if (!metadata.isFile()) throw new Error('That source path is not a file')
  if (metadata.size > maxBytes) {
    throw new Error(`Source preview is limited to ${Math.floor(maxBytes / 1024 / 1024)} MB`)
  }

  const bytes = await readFile(resolved)
  if (bytes.includes(0)) throw new Error('That file is binary and cannot be shown as source')
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('That file is not valid UTF-8 text')
  }
  return {
    path: resolved,
    name: path.basename(resolved),
    source,
    revision: createHash('sha256').update(bytes).digest('hex'),
    modifiedAt: Math.floor(metadata.mtimeMs),
    lineCount: source ? source.split('\n').length : 1,
  }
}

const sourceViewer: HarnessPlugin<{ maxBytes?: number }> = (ctx, config) => {
  const configuredMax = config?.maxBytes
  const maxBytes = typeof configuredMax === 'number' && Number.isFinite(configuredMax) && configuredMax > 0
    ? Math.floor(configuredMax)
    : DEFAULT_MAX_BYTES

  ctx.clientExtensions.registerMethod(ctx, SOURCE_VIEWER_READ_METHOD, async (payload) => {
    if (!isRecord(payload) || typeof payload.path !== 'string') {
      throw new Error('source-viewer.read needs an absolute path')
    }
    return await readSourceDocument(payload.path, maxBytes) as unknown as JsonValue
  })

  const edits = new SourceEdits({
    maxBytes,
    roots: () => ctx.projects.snapshot().projects.flatMap((project) => project.roots),
    programRoot: ctx.program.programRoot,
    async validateThread(threadId, workspace) {
      const thread = await ctx.codex.threadSummary(threadId)
      const settings = ctx.codex.snapshot().threadSettings[threadId]
      if (!thread || await realpath(settings?.workspace ?? thread.cwd) !== workspace) {
        throw new Error('The linked chat workspace changed. Choose the chat and try again.')
      }
    },
    async cancelRequest(threadId, id) {
      const queued = await ctx.codex.listQueuedSubmissions(threadId)
      await Promise.all(queued.filter((entry) => isRecord(entry) && typeof entry.id === 'string'
        && containsSourceEditRequest(entry.input, id)).map((entry) => (
        ctx.codex.deleteQueuedSubmission(threadId, (entry as { id: string }).id)
      )))
    },
  })
  ctx.effect(() => () => edits.dispose())
  ctx.on('codex/notification', (notification) => edits.notification(notification))
  ctx.tools.register(ctx, {
    namespace: 'source', name: 'propose_edit',
    description: 'Submit a replacement for an Alto Source inline edit request in this conversation. Only creates a review proposal; the human must Accept in Source to apply it. Supply the request id and exactly one of replacement or error. Do not edit the file directly.',
    inputSchema: {
      type: 'object', required: ['id'], additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'The id from the Source edit request.' },
        replacement: { type: 'string', description: 'Complete replacement text for only the selected lines, including line endings. Empty deletes them.' },
        error: { type: 'string', description: 'Why the request cannot be fulfilled within the selected lines.' },
      },
      oneOf: [{ required: ['replacement'] }, { required: ['error'] }],
    },
  }, (call) => edits.propose(call.arguments, { threadId: call.threadId, turnId: call.turnId }))

  const editId = (payload: JsonValue | undefined): string => {
    if (!isRecord(payload) || typeof payload.id !== 'string' || !payload.id || payload.id.length > 100) {
      throw new Error('Source editing needs an edit id')
    }
    return payload.id
  }
  ctx.clientExtensions.registerMethod(ctx, SOURCE_EDIT_START_METHOD, async (payload) => (
    await edits.start(payload) as unknown as JsonValue
  ))
  ctx.clientExtensions.registerMethod(ctx, SOURCE_EDIT_STATUS_METHOD, (payload) => (
    edits.status(editId(payload)) as unknown as JsonValue
  ))
  ctx.clientExtensions.registerMethod(ctx, SOURCE_EDIT_APPLY_METHOD, async (payload) => (
    await edits.apply(editId(payload)) as unknown as JsonValue
  ))
  ctx.clientExtensions.registerMethod(ctx, SOURCE_EDIT_DISCARD_METHOD, async (payload) => (
    await edits.discard(editId(payload)) as unknown as JsonValue
  ))
}

sourceViewer.inject = ['clientExtensions', 'codex', 'projects', 'program', 'tools']

export default sourceViewer
