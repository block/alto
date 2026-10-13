import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceDocument } from '../program/plugins/source-viewer-api.js'
import {
  readSourceEditDraft,
  registerSourceDraftOwner,
  writeSourceEditDraft,
} from '../program/plugins/source-editor-drafts.js'

const sourcePath = '/tmp/source with spaces.ts'
const document: SourceDocument = {
  path: sourcePath,
  name: 'source with spaces.ts',
  source: 'original\n',
  revision: 'original-revision',
  modifiedAt: 100,
  lineCount: 2,
}
const releases: Array<() => void> = []
let values: Map<string, string>
let storage: Storage

function key(owner: string, path = sourcePath): string {
  return `alto.source-edit.v1:${encodeURIComponent(owner)}:${encodeURIComponent(path)}`
}

function register(owner: string): () => void {
  const release = registerSourceDraftOwner(owner)
  releases.push(release)
  return release
}

beforeEach(() => {
  values = new Map()
  storage = {
    get length() { return values.size },
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => { values.set(name, value) },
    removeItem: (name) => { values.delete(name) },
    clear: () => { values.clear() },
    key: (index) => [...values.keys()][index] ?? null,
  }
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  releases.splice(0).forEach((release) => release())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Source editor drafts', () => {
  it('retains a pane draft and its original save revision across remounts', () => {
    register('pane-one')
    writeSourceEditDraft('pane-one', { document, source: 'my changes\n' })

    expect(readSourceEditDraft('pane-one', sourcePath)).toEqual({ document, source: 'my changes\n' })
    expect(JSON.parse(values.get(key('pane-one'))!).updatedAt).toEqual(expect.any(Number))
  })

  it('recovers a closed pane draft into a new owner before removing the old key', () => {
    const close = register('closed-pane')
    writeSourceEditDraft('closed-pane', { document, source: 'unsaved changes\n' })
    close()
    register('new-pane')

    expect(readSourceEditDraft('new-pane', sourcePath)).toEqual({ document, source: 'unsaved changes\n' })
    expect(values.has(key('closed-pane'))).toBe(false)
    expect(JSON.parse(values.get(key('new-pane'))!).document.revision).toBe('original-revision')
  })

  it('does not recover a draft belonging to a still-open sibling pane', () => {
    register('open-pane')
    register('new-pane')
    writeSourceEditDraft('open-pane', { document, source: 'sibling changes\n' })

    expect(readSourceEditDraft('new-pane', sourcePath)).toBeUndefined()
    expect(values.has(key('open-pane'))).toBe(true)
    expect(values.has(key('new-pane'))).toBe(false)
  })

  it('keeps an owner active until its last registration releases and release is idempotent', () => {
    const releaseFirst = register('shared-owner')
    const releaseLast = register('shared-owner')
    writeSourceEditDraft('shared-owner', { document, source: 'unsaved\n' })
    releaseFirst()
    releaseFirst()
    expect(readSourceEditDraft('new-pane', sourcePath)).toBeUndefined()

    releaseLast()
    expect(readSourceEditDraft('new-pane', sourcePath)?.source).toBe('unsaved\n')
  })

  it('prefers its own draft even when another orphan is newer', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200)
    writeSourceEditDraft('own-pane', { document, source: 'own changes\n' })
    writeSourceEditDraft('closed-pane', { document, source: 'newer changes\n' })

    expect(readSourceEditDraft('own-pane', sourcePath)?.source).toBe('own changes\n')
    expect(values.has(key('closed-pane'))).toBe(true)
  })

  it('chooses the newest orphan for the exact canonical file, ignoring active owners', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(300).mockReturnValueOnce(200)
    writeSourceEditDraft('old-closed', { document, source: 'older\n' })
    writeSourceEditDraft('active-pane', { document, source: 'active\n' })
    writeSourceEditDraft('new-closed', { document, source: 'newer\n' })
    register('active-pane')
    values.set(key('unrelated', '/tmp/other.ts'), JSON.stringify({ document, source: 'wrong key', updatedAt: 500 }))
    values.set(key('wrong-path'), JSON.stringify({ document: { ...document, path: '/tmp/other.ts' }, source: 'wrong document', updatedAt: 500 }))

    expect(readSourceEditDraft('new-pane', sourcePath)?.source).toBe('newer\n')
    expect(values.has(key('old-closed'))).toBe(true)
    expect(values.has(key('active-pane'))).toBe(true)
    expect(values.has(key('new-closed'))).toBe(false)
  })

  it('skips corrupt draft data and malformed keys without hiding valid recovery', () => {
    values.set(key('bad-json'), '{broken')
    values.set(key('missing-document'), JSON.stringify({ source: 'bad' }))
    values.set(key('invalid-source'), JSON.stringify({ document, source: 42 }))
    values.set(key('invalid-time'), JSON.stringify({ document, source: 'bad', updatedAt: 'tomorrow' }))
    values.set(key('clean-draft'), JSON.stringify({ document, source: document.source, updatedAt: 500 }))
    values.set(`alto.source-edit.v1:%E0%A4%A:${encodeURIComponent(sourcePath)}`, JSON.stringify({ document, source: 'bad key', updatedAt: 500 }))
    values.set(key('legacy-owner'), JSON.stringify({ document, source: 'legacy unsaved changes\n' }))

    expect(readSourceEditDraft('new-pane', sourcePath)?.source).toBe('legacy unsaved changes\n')
  })

  it('returns recoverable text and retains the original if claiming hits a quota', () => {
    writeSourceEditDraft('closed-pane', { document, source: 'valuable changes\n' })
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })

    expect(readSourceEditDraft('new-pane', sourcePath)).toEqual({ document, source: 'valuable changes\n' })
    expect(values.has(key('closed-pane'))).toBe(true)
    expect(values.has(key('new-pane'))).toBe(false)
  })

  it('keeps the newly claimed copy if removing the old copy fails', () => {
    writeSourceEditDraft('closed-pane', { document, source: 'valuable changes\n' })
    vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new Error('Storage unavailable') })

    expect(readSourceEditDraft('new-pane', sourcePath)?.source).toBe('valuable changes\n')
    expect(values.has(key('closed-pane'))).toBe(true)
    expect(values.has(key('new-pane'))).toBe(true)
  })

  it('removes only its own draft once its source is saved or discarded', () => {
    writeSourceEditDraft('own-pane', { document, source: 'my changes\n' })
    writeSourceEditDraft('other-pane', { document, source: 'other changes\n' })
    writeSourceEditDraft('own-pane', { document, source: document.source })

    expect(values.has(key('own-pane'))).toBe(false)
    expect(values.has(key('other-pane'))).toBe(true)
  })

  it('gracefully skips recovery when browser storage cannot be read', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('Storage disabled') })

    expect(readSourceEditDraft('new-pane', sourcePath)).toBeUndefined()
    expect(() => writeSourceEditDraft('new-pane', { document, source: 'unsaved\n' })).not.toThrow()
  })
})
