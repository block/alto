import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { WEB_SECURITY_HEADERS } from '../src/server/services/web-gateway.js'

const require = createRequire(import.meta.url)

it.skipIf(process.platform !== 'darwin')('renders isolated rich replies under the application CSP at normal and narrow chat widths', async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ALTO_TEST_WEB_SECURITY_HEADERS: JSON.stringify(WEB_SECURITY_HEADERS),
  }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(require('electron') as string, [
    path.resolve('tests/fixtures/rich-replies.cjs'),
  ], { cwd: process.cwd(), env, timeout: 35_000 })
  expect(stdout).toContain('Rich reply browser checks passed')
}, 40_000)
