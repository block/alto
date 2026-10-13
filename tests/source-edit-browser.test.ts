import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('edits Source with Vim and mouse input, safely saves revisions, and retains drafts across files and tabs', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/source-edit.cjs'),
  ], { cwd: process.cwd(), env, timeout: 45_000 })
  expect(stdout).toContain('Source editing browser checks passed')
}, 50_000)
