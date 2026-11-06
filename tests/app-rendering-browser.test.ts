import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it.skipIf(process.platform !== 'darwin')('isolates application features from background host updates while preserving live UI, registrations, recovery, and native drafts', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(createRequire(import.meta.url)('electron') as string,
    [path.resolve('tests/fixtures/app-rendering.cjs')], { cwd: process.cwd(), env, timeout: 20_000 })
  expect(stdout).toContain('App rendering browser checks passed')
}, 25_000)
