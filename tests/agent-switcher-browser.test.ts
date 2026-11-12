import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('uses the shared persistent picker from the topbar and keyboard action for the focused pane', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/agent-switcher.cjs'),
  ], { cwd: process.cwd(), env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
  expect(stdout).toContain('Shared agent switcher browser checks passed')
}, 35_000)
