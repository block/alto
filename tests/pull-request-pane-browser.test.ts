import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('reads one continuous PR page, preserves inline diff reviews, and owns pane links and renderers', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/pull-request-pane.cjs'),
  ], { cwd: process.cwd(), env, timeout: 35_000, maxBuffer: 2 * 1024 * 1024 })
  expect(stdout).toContain('Pull request pane browser checks passed')
}, 40_000)
