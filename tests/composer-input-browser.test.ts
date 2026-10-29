import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'darwin')('keeps native typing, rich-text selections, undo, IME, and autosizing intact while replies stream', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron') as string,
    [path.resolve('tests/fixtures/composer-input.cjs')], { cwd: process.cwd(), env, timeout: 25_000 })
  expect(stdout).toContain('Composer input browser checks passed')
}, 30_000)
