import { parseSourceDocument, type SourceDocument } from './source-viewer-api.js'
import type { JsonValue } from '../../src/shared/protocol.js'

export interface SourceEditDraft {
  document: SourceDocument
  source: string
}

const DRAFT_PREFIX = 'alto.source-edit.v1:'
const activeOwners = new Map<string, number>()

/** A still-open pane keeps its draft even while another pane opens the file. */
export function registerSourceDraftOwner(owner: string): () => void {
  activeOwners.set(owner, (activeOwners.get(owner) ?? 0) + 1)
  let active = true
  return () => {
    if (!active) return
    active = false
    const remaining = (activeOwners.get(owner) ?? 1) - 1
    if (remaining) activeOwners.set(owner, remaining)
    else activeOwners.delete(owner)
  }
}

function draftKey(owner: string, path: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(path)}`
}

function parseDraft(raw: string | null, path: string): (SourceEditDraft & { updatedAt: number }) | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object' || !('document' in value)
      || !('source' in value) || typeof value.source !== 'string') return undefined
    const document = parseSourceDocument(value.document as JsonValue)
    if (document.path !== path || value.source === document.source) return undefined
    const updatedAt = 'updatedAt' in value ? value.updatedAt : 0
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) return undefined
    return { document, source: value.source, updatedAt }
  } catch {
    return undefined
  }
}

/** Keep the original revision with a draft so recovery cannot bypass save conflicts. */
export function readSourceEditDraft(owner: string, path: string): SourceEditDraft | undefined {
  try {
    const ownKey = draftKey(owner, path)
    const own = parseDraft(localStorage.getItem(ownKey), path)
    if (own) return { document: own.document, source: own.source }

    const suffix = `:${encodeURIComponent(path)}`
    let latest: { key: string; draft: SourceEditDraft & { updatedAt: number } } | undefined
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(DRAFT_PREFIX) || !key.endsWith(suffix)) continue
      let previousOwner: string
      try {
        previousOwner = decodeURIComponent(key.slice(DRAFT_PREFIX.length, -suffix.length))
      } catch {
        continue
      }
      if (activeOwners.has(previousOwner)) continue
      const draft = parseDraft(localStorage.getItem(key), path)
      if (draft && (!latest || draft.updatedAt > latest.draft.updatedAt)) latest = { key, draft }
    }
    if (!latest) return undefined
    try {
      // Claim before removing the previous key. If storage is full or disabled,
      // recovery still returns the text and leaves the durable original intact.
      localStorage.setItem(ownKey, JSON.stringify(latest.draft))
      localStorage.removeItem(latest.key)
    } catch { /* The recovered draft remains available in this pane. */ }
    return { document: latest.draft.document, source: latest.draft.source }
  } catch {
    return undefined
  }
}

export function writeSourceEditDraft(owner: string, draft: SourceEditDraft): void {
  const key = draftKey(owner, draft.document.path)
  if (draft.source === draft.document.source) localStorage.removeItem(key)
  else localStorage.setItem(key, JSON.stringify({ document: draft.document, source: draft.source, updatedAt: Date.now() }))
}
