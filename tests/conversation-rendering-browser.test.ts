import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('avoids unrelated conversation renders and repeated highlighting while list prose streams', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/conversation-rendering.cjs'),
  ], { cwd: process.cwd(), env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
  expect(stdout).toContain('Conversation rendering browser checks passed')
}, 35_000)
