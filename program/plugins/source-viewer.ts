import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { open, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import {
  SOURCE_VIEWER_READ_METHOD,
  SOURCE_VIEWER_SAVE_METHOD,
  type SourceDocument,
} from './source-viewer-api.js'
import { resolveReadableFile } from './workspace-files.js'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const pendingSaves = new Map<string, Promise<SourceDocument>>()
const CONFLICT_MESSAGE = 'This file changed on disk. Reload it before saving; your edits have not been written.'

interface SourceSnapshot {
  bytes: Buffer
  metadata: Stats
  document: SourceDocument
}

function sizeError(maxBytes: number): Error {
  return new Error(`Source files are limited to ${Math.floor(maxBytes / 1024 / 1024)} MB`)
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameVersion(left: Stats, right: Stats): boolean {
  return sameFile(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
}

function sourceDocument(resolved: string, bytes: Buffer, metadata: Stats): SourceDocument {
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

async function readSnapshot(resolved: string, maxBytes: number, writable = false): Promise<SourceSnapshot> {
  // realpath resolves deliberately selected symlinks; NOFOLLOW prevents a later
  // replacement of the canonical final component from silently redirecting I/O.
  const file = await open(resolved, (writable ? constants.O_RDWR : constants.O_RDONLY)
    | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile()) throw new Error('That source path is not a file')
    if (metadata.size > maxBytes) throw sizeError(maxBytes)
    // Keep the read bounded even if another process grows the file after stat.
    const buffer = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, size)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > maxBytes) throw sizeError(maxBytes)
    if (!sameVersion(metadata, await file.stat())) throw new Error(CONFLICT_MESSAGE)
    const bytes = buffer.subarray(0, size)
    return { bytes, metadata, document: sourceDocument(resolved, bytes, metadata) }
  } finally {
    await file.close()
  }
}

export async function readSourceDocument(
  filePath: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<SourceDocument> {
  return (await readSnapshot(await resolveReadableFile(filePath), maxBytes)).document
}

function sourceBytes(source: string, original: SourceSnapshot, maxBytes: number): Buffer {
  if (source.length > maxBytes) throw sizeError(maxBytes)
  if (source.includes('\0')) throw new Error('Source cannot contain binary NUL characters')
  // In Unicode mode, this range matches unpaired UTF-16 surrogates only.
  if (/[\uD800-\uDFFF]/u.test(source)) throw new Error('Source must contain valid Unicode text')
  // Browser editors use LF internally. Retain consistently CRLF files, while
  // leaving mixed line endings and the presence/absence of a final newline intact.
  const previous = original.document.source
  const text = previous.includes('\r\n') && !/(?<!\r)\n/u.test(previous)
    ? source.replace(/\r?\n/gu, '\r\n')
    : source
  const bom = original.bytes.subarray(0, 3).equals(UTF8_BOM) ? UTF8_BOM : Buffer.alloc(0)
  if (Buffer.byteLength(text, 'utf8') + bom.length > maxBytes) throw sizeError(maxBytes)
  return Buffer.concat([bom, Buffer.from(text, 'utf8')])
}

async function writeSourceDocument(
  filePath: string,
  resolved: string,
  source: string,
  expectedRevision: string,
  maxBytes: number,
): Promise<SourceDocument> {
  if (await realpath(filePath) !== resolved) throw new Error(CONFLICT_MESSAGE)
  const original = await readSnapshot(resolved, maxBytes, true)
  if (original.document.revision !== expectedRevision) throw new Error(CONFLICT_MESSAGE)
  const bytes = sourceBytes(source, original, maxBytes)
  const directory = path.dirname(resolved)
  const directoryMetadata = await stat(directory)
  const temporary = path.join(directory, `.alto-${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    let writtenMetadata: Stats
    try {
      await file.writeFile(bytes)
      // Atomic replacement must retain ordinary executable and access bits.
      // Do not carry setuid/setgid bits onto newly edited contents.
      const temporaryMetadata = await file.stat()
      if (temporaryMetadata.uid !== original.metadata.uid || temporaryMetadata.gid !== original.metadata.gid) {
        await file.chown(original.metadata.uid, original.metadata.gid)
      }
      await file.chmod(original.metadata.mode & 0o777)
      await file.sync()
      writtenMetadata = await file.stat()
    } finally {
      await file.close()
    }

    // Check again after the potentially slow write, directly before replacement.
    // Alto saves are serialized; external writers are detected by both content
    // and inode metadata. Node has no portable conditional-rename operation.
    const latest = await readSnapshot(resolved, maxBytes, true)
    if (latest.document.revision !== expectedRevision
      || !sameVersion(original.metadata, latest.metadata)
      || await realpath(filePath) !== resolved
      || !sameFile(directoryMetadata, await stat(directory))) {
      throw new Error(CONFLICT_MESSAGE)
    }
    await rename(temporary, resolved)
    return sourceDocument(resolved, bytes, writtenMetadata)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export async function saveSourceDocument(
  filePath: string,
  source: string,
  expectedRevision: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<SourceDocument> {
  if (!/^[a-f0-9]{64}$/u.test(expectedRevision)) throw new Error('Saving source needs its current revision')
  const resolved = await resolveReadableFile(filePath)
  const previous = pendingSaves.get(resolved)
  const saving = (previous ?? Promise.resolve()).catch(() => undefined).then(() => (
    writeSourceDocument(filePath, resolved, source, expectedRevision, maxBytes)
  ))
  pendingSaves.set(resolved, saving)
  try {
    return await saving
  } finally {
    if (pendingSaves.get(resolved) === saving) pendingSaves.delete(resolved)
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
  ctx.clientExtensions.registerMethod(ctx, SOURCE_VIEWER_SAVE_METHOD, async (payload) => {
    if (!isRecord(payload) || typeof payload.path !== 'string'
      || typeof payload.source !== 'string' || typeof payload.expectedRevision !== 'string') {
      throw new Error('source-viewer.save needs a path, source, and expectedRevision')
    }
    return await saveSourceDocument(payload.path, payload.source, payload.expectedRevision, maxBytes) as unknown as JsonValue
  })
}

sourceViewer.inject = ['clientExtensions']

export default sourceViewer
