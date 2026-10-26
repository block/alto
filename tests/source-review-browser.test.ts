import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('routes Source comments to their linked chat and reviews inline edit proposals', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/source-review.cjs'),
  ], { cwd: process.cwd(), env, timeout: 35_000 })
  expect(stdout).toContain('Source review browser checks passed')
}, 40_000)
