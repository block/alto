import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseSourceViewerResource,
  sourceViewerResource,
} from '../program/plugins/source-viewer-api.js'
import { readSourceDocument, saveSourceDocument } from '../program/plugins/source-viewer.js'

const faults = vi.hoisted(() => ({
  failWrite: false,
  failRename: false,
  beforeSync: undefined as (() => Promise<void>) | undefined,
}))

vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (faults.failRename) throw new Error('Simulated replacement failure')
      return actual.rename(...args)
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args)
      if (String(args[0]).includes('.alto-')) {
        const write = file.writeFile.bind(file)
        file.writeFile = async (...writeArgs: Parameters<typeof file.writeFile>) => {
          if (faults.failWrite) {
            await write('partial data')
            throw new Error('Simulated write failure')
          }
          return write(...writeArgs)
        }
        const sync = file.sync.bind(file)
        file.sync = async () => {
          const beforeSync = faults.beforeSync
          faults.beforeSync = undefined
          await beforeSync?.()
          await sync()
        }
      }
      return file
    },
  }
})

const temporaryDirectories: string[] = []

afterEach(async () => {
  faults.failWrite = false
  faults.failRename = false
  faults.beforeSync = undefined
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

describe('source viewer', () => {
  it('round-trips exact source locations through opaque pane resources', () => {
    const location = {
      path: '/tmp/source with spaces.tsx',
      line: 42,
      endLine: 47,
      column: 9,
    }

    expect(parseSourceViewerResource(sourceViewerResource(location))).toEqual(location)
    expect(parseSourceViewerResource('source:%E0%A4%A')).toBeUndefined()
  })

  it('reads UTF-8 source below an allowed workspace root', async () => {
    const root = await temporaryDirectory('alto-source-root-')
    const sourceDirectory = path.join(root, 'src')
    const file = path.join(sourceDirectory, 'main.ts')
    await mkdir(sourceDirectory)
    await writeFile(file, 'export const answer = 42\n')

    await expect(readSourceDocument(file)).resolves.toMatchObject({
      path: await realpath(file),
      name: 'main.ts',
      source: 'export const answer = 42\n',
      lineCount: 2,
    })
  })

  it('reads files outside workspaces while rejecting binary and oversized files', async () => {
    const root = await temporaryDirectory('alto-source-root-')
    const outside = await temporaryDirectory('alto-source-outside-')
    const privateFile = path.join(outside, 'private.ts')
    const binaryFile = path.join(root, 'binary.dat')
    const largeFile = path.join(root, 'large.ts')
    await writeFile(privateFile, 'private\n')
    await writeFile(binaryFile, Buffer.from([0x61, 0x00, 0x62]))
    await writeFile(largeFile, '12345')

    await expect(readSourceDocument(privateFile)).resolves.toMatchObject({
      path: await realpath(privateFile),
      source: 'private\n',
    })
    await expect(readSourceDocument(binaryFile))
      .rejects.toThrow('binary')
    await expect(readSourceDocument(largeFile, 4))
      .rejects.toThrow('limited')
  })

  it('saves UTF-8 contents atomically and returns the new document revision', async () => {
    const root = await temporaryDirectory('alto-source-save-')
    const file = path.join(root, 'script.ts')
    await writeFile(file, 'const before = true\n', { mode: 0o751 })
    const original = await readSourceDocument(file)

    const saved = await saveSourceDocument(file, 'const after = "🌿"', original.revision)

    expect(await readFile(file, 'utf8')).toBe('const after = "🌿"')
    expect(saved).toEqual(await readSourceDocument(file))
    expect(saved.revision).not.toBe(original.revision)
    expect((await stat(file)).mode & 0o777).toBe(0o751)
    expect(await readdir(root)).toEqual(['script.ts'])
  })

  it('preserves a UTF-8 BOM and CRLF lines when saving editor text', async () => {
    const root = await temporaryDirectory('alto-source-encoding-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, '\ufeffone\r\ntwo\r\n')
    const original = await readSourceDocument(file)
    expect(original.source).toBe('one\r\ntwo\r\n')

    const saved = await saveSourceDocument(file, 'one\nupdated\n', original.revision)

    expect(await readFile(file, 'utf8')).toBe('\ufeffone\r\nupdated\r\n')
    expect(saved.source).toBe('one\r\nupdated\r\n')
    expect(saved).toEqual(await readSourceDocument(file))
  })

  it('retains exact mixed newlines and supports an empty file', async () => {
    const root = await temporaryDirectory('alto-source-newlines-')
    const file = path.join(root, 'mixed.txt')
    await writeFile(file, 'one\ntwo\r\n')
    const original = await readSourceDocument(file)
    const mixed = await saveSourceDocument(file, 'three\r\nfour\n', original.revision)
    expect(await readFile(file, 'utf8')).toBe('three\r\nfour\n')
    const empty = await saveSourceDocument(file, '', mixed.revision)
    expect(empty).toMatchObject({ source: '', lineCount: 1 })
    expect(await readFile(file, 'utf8')).toBe('')
  })

  it('rejects stale revisions without overwriting another editor', async () => {
    const root = await temporaryDirectory('alto-source-conflict-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'original\n')
    const original = await readSourceDocument(file)
    await writeFile(file, 'external edit\n')

    await expect(saveSourceDocument(file, 'local edit\n', original.revision)).rejects.toThrow('changed on disk')
    expect(await readFile(file, 'utf8')).toBe('external edit\n')
    expect(await readdir(root)).toEqual(['main.ts'])
  })

  it('serializes concurrent saves so only one edit of a revision succeeds', async () => {
    const root = await temporaryDirectory('alto-source-concurrent-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'original\n')
    const original = await readSourceDocument(file)

    const results = await Promise.allSettled([
      saveSourceDocument(file, 'first edit\n', original.revision),
      saveSourceDocument(file, 'second edit\n', original.revision),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(['first edit\n', 'second edit\n']).toContain(await readFile(file, 'utf8'))
  })

  it('rejects files changed while preparing an atomic save', async () => {
    const root = await temporaryDirectory('alto-source-racing-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'original\n')
    const original = await readSourceDocument(file)
    faults.beforeSync = async () => { await writeFile(file, 'external edit\n') }

    await expect(saveSourceDocument(file, 'local edit\n', original.revision)).rejects.toThrow('changed on disk')
    expect(await readFile(file, 'utf8')).toBe('external edit\n')
    expect(await readdir(root)).toEqual(['main.ts'])
  })

  it('leaves the original file and no temporary files after a failed replacement', async () => {
    const root = await temporaryDirectory('alto-source-failure-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'original\n')
    const original = await readSourceDocument(file)
    faults.failRename = true

    await expect(saveSourceDocument(file, 'local edit\n', original.revision)).rejects.toThrow('replacement failure')
    expect(await readFile(file, 'utf8')).toBe('original\n')
    expect(await readdir(root)).toEqual(['main.ts'])
  })

  it('does not truncate the original when a temporary write partially fails', async () => {
    const root = await temporaryDirectory('alto-source-partial-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'original\n')
    const original = await readSourceDocument(file)
    faults.failWrite = true

    await expect(saveSourceDocument(file, 'local edit\n', original.revision)).rejects.toThrow('write failure')
    expect(await readFile(file, 'utf8')).toBe('original\n')
    expect(await readdir(root)).toEqual(['main.ts'])
  })

  it('saves through deliberately selected symlinks without replacing the link', async () => {
    const root = await temporaryDirectory('alto-source-symlink-')
    const file = path.join(root, 'main.ts')
    const link = path.join(root, 'linked.ts')
    await writeFile(file, 'original\n')
    await symlink(file, link)
    const original = await readSourceDocument(link)

    const saved = await saveSourceDocument(link, 'edited\n', original.revision)

    expect(saved.path).toBe(await realpath(file))
    expect(await realpath(link)).toBe(await realpath(file))
    expect(await readFile(link, 'utf8')).toBe('edited\n')
  })

  it('refuses to follow a symlink swapped into the canonical path during a save', async () => {
    const root = await temporaryDirectory('alto-source-swapped-link-')
    const file = path.join(root, 'main.ts')
    const otherFile = path.join(root, 'other.ts')
    await writeFile(file, 'original\n')
    await writeFile(otherFile, 'other content\n')
    const original = await readSourceDocument(file)
    faults.beforeSync = async () => {
      await rm(file)
      await symlink(otherFile, file)
    }

    await expect(saveSourceDocument(file, 'local edit\n', original.revision)).rejects.toThrow()
    expect(await readFile(otherFile, 'utf8')).toBe('other content\n')
    expect(await realpath(file)).toBe(await realpath(otherFile))
    expect(await readdir(root)).toEqual(['main.ts', 'other.ts'])
  })

  it('refuses binary, malformed Unicode, oversized UTF-8, and relative-path saves', async () => {
    const root = await temporaryDirectory('alto-source-invalid-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'ok')
    const original = await readSourceDocument(file)

    await expect(saveSourceDocument(file, 'a\0b', original.revision)).rejects.toThrow('NUL')
    await expect(saveSourceDocument(file, '\ud800', original.revision)).rejects.toThrow('Unicode')
    await expect(saveSourceDocument(file, '🌿🌿', original.revision, 5)).rejects.toThrow('limited')
    await expect(saveSourceDocument('main.ts', 'changed', original.revision)).rejects.toThrow('absolute')
    expect(await readFile(file, 'utf8')).toBe('ok')
    expect(await readdir(root)).toEqual(['main.ts'])
  })

  it('includes a retained BOM in the save byte limit', async () => {
    const root = await temporaryDirectory('alto-source-bom-limit-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, '\ufeffok')
    const original = await readSourceDocument(file, 5)

    await expect(saveSourceDocument(file, '🌿', original.revision, 5)).rejects.toThrow('limited')
    expect(await readFile(file, 'utf8')).toBe('\ufeffok')
  })

  it('honors read-only file permissions even when its directory is writable', async () => {
    // The superuser bypasses the file's ordinary access bits.
    if (process.getuid?.() === 0) return
    const root = await temporaryDirectory('alto-source-readonly-')
    const file = path.join(root, 'main.ts')
    await writeFile(file, 'original\n')
    const original = await readSourceDocument(file)
    await chmod(file, 0o444)

    await expect(saveSourceDocument(file, 'local edit\n', original.revision)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('original\n')
  })
})
