import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('starts PR watchers from Git context and scopes feedback controls to their chat', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [path.resolve('tests/fixtures/pr-watcher.cjs')], {
    cwd: process.cwd(), env, timeout: 30_000,
  })
  expect(stdout).toContain('PR watcher browser checks passed')
}, 35_000)
