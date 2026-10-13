import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('supports Vim keyboard and mouse navigation, visual yanks, search, review comments, and retained source panes', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/source-vim.cjs'),
  ], { cwd: process.cwd(), env, timeout: 35_000 })
  expect(stdout).toContain('Source Vim browser checks passed')
}, 40_000)
