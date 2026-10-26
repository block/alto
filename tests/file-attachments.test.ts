import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  attachedFileContext,
  storeFileAttachment,
} from '../program/plugins/file-attachments.js'
import { DEFAULT_MAX_ATTACHMENT_BYTES } from '../program/plugins/file-attachments-api.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('file attachments', () => {
  it('stores bytes under an isolated directory and sanitizes the display name', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    const attachment = await storeFileAttachment(root, {
      name: '../notes.md',
      mediaType: 'text/markdown',
      data: Buffer.from('# Notes').toString('base64'),
    })

    expect(attachment).toMatchObject({
      name: 'notes.md',
      mediaType: 'text/markdown',
      size: 7,
    })
    expect(path.relative(root, attachment.path).startsWith('..')).toBe(false)
    expect(await readFile(attachment.path, 'utf8')).toBe('# Notes')
    expect((await stat(attachment.path)).isFile()).toBe(true)
  })

  it('rejects invalid or oversized payloads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    await expect(storeFileAttachment(root, {
      name: 'bad.bin',
      mediaType: 'application/octet-stream',
      data: 'not base64!',
    })).rejects.toThrow('valid base64')
    await expect(storeFileAttachment(root, {
      name: 'large.bin',
      mediaType: 'application/octet-stream',
      data: Buffer.from('too large').toString('base64'),
    }, 2)).rejects.toThrow('limited')
  })

  it.each([8 * 1024 * 1024, DEFAULT_MAX_ATTACHMENT_BYTES])('stores a %i-byte PDF attachment without overflowing the validator stack', async (size) => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    const bytes = Buffer.alloc(size, 0xa5)
    bytes.write('%PDF-1.7\n')
    const attachment = await storeFileAttachment(root, {
      name: 'large.pdf',
      mediaType: 'application/pdf',
      data: bytes.toString('base64'),
    })

    expect(attachment.size).toBe(bytes.length)
    expect(attachment.mediaType).toBe('application/pdf')
    expect((await readFile(attachment.path)).equals(bytes)).toBe(true)
  })

  it.each(['', 'f', 'fo', 'foo', 'foob'])('preserves valid base64 padding for %j', async (text) => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    const attachment = await storeFileAttachment(root, {
      name: 'padding.txt', mediaType: 'text/plain', data: Buffer.from(text).toString('base64'),
    }, text.length)
    expect(await readFile(attachment.path, 'utf8')).toBe(text)
  })

  it.each(['Zg', 'Zg=', '=Zg=', 'Z===', '====', 'Zm=v', 'Zg==\n', 'Zm9v\n', 'Zm9v ', 'Zm-v', 'Zm_v'])('rejects malformed base64 %j without writing a file', async (data) => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    await expect(storeFileAttachment(root, {
      name: 'bad.pdf', mediaType: 'application/pdf', data,
    })).rejects.toThrow('valid base64')
    expect(await readdir(root)).toEqual([])
  })

  it('rejects large oversized attachments with the size error, not a stack overflow', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    await expect(storeFileAttachment(root, {
      name: 'large.pdf', mediaType: 'application/pdf',
      data: Buffer.alloc(8 * 1024 * 1024).toString('base64'),
    }, 1024 * 1024)).rejects.toThrow('Files are limited to 1 MB')
    expect(await readdir(root)).toEqual([])
  })

  it.each([1, 2])('enforces a %i-byte limit within a single base64 quartet', async (maxBytes) => {
    const root = await mkdtemp(path.join(tmpdir(), 'alto-attachments-'))
    roots.push(root)
    await expect(storeFileAttachment(root, {
      name: 'large.bin', mediaType: 'application/octet-stream', data: 'YWJj',
    }, maxBytes)).rejects.toThrow('Files are limited')
    expect(await readdir(root)).toEqual([])
  })

  it('makes attached filenames and staged paths explicit to Codex', () => {
    expect(attachedFileContext([{
      type: 'text',
      text: 'Compare the attached notes.',
    }, {
      type: 'mention',
      name: 'architecture-notes.md',
      path: '/Users/test/.codex/attachments/alto/one/architecture-notes.md',
    }, {
      type: 'mention',
      name: 'design-analysis.md',
      path: '/Users/test/.codex/attachments/alto/two/design-analysis.md',
    }])).toBe([
      'The user attached local files to this turn. When they refer to an attached file, use these exact staged paths:',
      '- "architecture-notes.md": "/Users/test/.codex/attachments/alto/one/architecture-notes.md"',
      '- "design-analysis.md": "/Users/test/.codex/attachments/alto/two/design-analysis.md"',
    ].join('\n'))
  })

  it('does not add attachment context to ordinary turns', () => {
    expect(attachedFileContext([{ type: 'text', text: 'Hello' }])).toBeUndefined()
  })
})
