import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'darwin')('preserves native tab rename editing and pane drafts across metadata and streaming updates', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron') as string,
    [path.resolve('tests/fixtures/workspace-rename.cjs')], { cwd: process.cwd(), env, timeout: 25_000 })
  expect(stdout).toContain('Workspace rename browser checks passed')
}, 30_000)
