import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('shares appearance roles across real Settings, search, menus, and controls without remounting them', async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [path.resolve('tests/fixtures/interface-appearance.cjs')], {
    cwd: process.cwd(), env, timeout: 90_000,
  })
  expect(stdout).toContain('Interface appearance browser checks passed')
}, 95_000)
