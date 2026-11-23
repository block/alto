import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AcpProcessProvider } from '../program/plugins/acp-provider.js'
import { bundledPiOptions } from '../program/plugins/pi-provider.js'

const exec = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
let temporaryRoot: string
let relocatedRoot: string
const model = { id: 'test-model', name: 'Test model', provider: 'test', reasoning: false,
  input: ['text'], contextWindow: 8192, maxTokens: 1024 }

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'alto-bundled-pi-'))
  relocatedRoot = path.join(temporaryRoot, 'Relocated Alto.app', 'Contents', 'Resources', 'app')
  const output = path.join(temporaryRoot, 'built')
  await exec(process.execPath, [path.join(projectRoot, 'scripts/build-pi-acp.mjs'), output], { cwd: os.tmpdir() })
  await cp(output, path.join(relocatedRoot, 'dist/node/adapters/pi-acp'), { recursive: true })
}, 30_000)

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

it('launches the bundled adapter relative to Alto using its current runtime', () => {
  const options = bundledPiOptions(relocatedRoot)
  expect(options.command).toBe(process.execPath)
  expect(options.args).toEqual([path.join(relocatedRoot, 'dist/node/adapters/pi-acp/index.js')])
  expect(options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
})

it('ships dependency notices with the relocated bundle', async () => {
  const notices = await readFile(path.join(relocatedRoot, 'dist/node/adapters/pi-acp/THIRD_PARTY_LICENSES.txt'), 'utf8')
  expect(notices).toContain('pi-acp@0.0.35')
  expect(notices).toContain('Copyright (c) 2025 Sergii Kozak')
  expect(notices).toContain('@agentclientprotocol/sdk@')
  expect(notices).toContain('cross-spawn@')
})

it('fails the build when upstream content no longer matches the reviewed patch', async () => {
  const fixture = path.join(temporaryRoot, 'changed-upstream')
  await mkdir(path.join(fixture, 'scripts'), { recursive: true })
  await cp(path.join(projectRoot, 'scripts/build-pi-acp.mjs'), path.join(fixture, 'scripts/build-pi-acp.mjs'))
  await cp(path.join(projectRoot, 'vendor'), path.join(fixture, 'vendor'), { recursive: true })
  await symlink(path.join(projectRoot, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
  await writeFile(path.join(fixture, 'vendor/pi-acp/upstream.json'), JSON.stringify({ version: '0.0.35', sha256: 'changed' }))
  await expect(exec(process.execPath, [path.join(fixture, 'scripts/build-pi-acp.mjs')]))
    .rejects.toThrow('pi-acp upstream changed')
})

describe.skipIf(process.platform === 'win32')('bundled ACP session forwarding', () => {
  it('loads the extension for new and resumed sessions with fresh per-session credentials', async () => {
    const home = path.join(temporaryRoot, 'home')
    await mkdir(home)
    const capture = path.join(home, 'calls.jsonl')
    const sessionFile = path.join(home, 'session.jsonl')
    const fakePi = path.join(home, 'pi.mjs')
    await writeFile(sessionFile, '')
    await writeFile(fakePi, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const extension = args[args.indexOf('--extension') + 1];
const registrations = [];
if (args.includes('--extension')) {
  const mod = await import(pathToFileURL(extension).href);
  mod.default({ registerMcpServer: (name, config) => registrations.push({name, config}) });
}
appendFileSync(${JSON.stringify(capture)}, JSON.stringify({args, registrations, token: process.env.PI_ACP_MCP_VALUE_0}) + '\\n');
const state = { sessionId: 'test-session', sessionFile: ${JSON.stringify(sessionFile)}, model: ${JSON.stringify(model)}, thinkingLevel: 'off' };
createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  const data = request.type === 'get_state' ? state : request.type === 'get_available_models'
    ? {models: [state.model]} : request.type === 'get_available_thinking_levels' ? {levels: ['off']}
    : request.type === 'get_messages' ? {messages: []} : {};
  process.stdout.write(JSON.stringify({type: 'response', command: request.type, id: request.id, success: true, data}) + '\\n');
});
`)
    await chmod(fakePi, 0o755)
    const options = bundledPiOptions(relocatedRoot, { env: { HOME: home, PI_ACP_PI_COMMAND: fakePi,
      PI_ACP_MCP_SERVERS: 'must-not-be-inherited' } })
    const servers = (token: string) => [{ type: 'http' as const, name: 'alto', url: 'http://127.0.0.1:12345/mcp',
      headers: { Authorization: token } }]
    for (const phase of ['new', 'restore', 'empty']) {
      const provider = new AcpProcessProvider(options)
      try {
        const request = { cwd: home, permissionMode: 'ask' as const, mcpServers: phase === 'empty' ? [] : servers(phase) }
        if (phase === 'restore') await provider.loadSession('test-session', request)
        else await provider.createSession(request)
        expect(provider.snapshot().capabilities.mcpServers).toBe(true)
        expect(provider.snapshot().version).toBe('0.0.35-alto.1')
      } finally { await provider.stop() }
    }
    const calls = (await readFile(capture, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(calls).toHaveLength(3)
    expect(calls[0].token).toBe('new')
    expect(calls[1].token).toBe('restore')
    expect(calls[1].args).toContain('--session')
    expect(calls[1].args).toContain(sessionFile)
    for (const call of calls.slice(0, 2)) {
      expect(call.registrations).toEqual([{ name: 'alto', config: { exposure: 'direct',
        url: 'http://127.0.0.1:12345/mcp', headers: { Authorization: '${PI_ACP_MCP_VALUE_0}' } } }])
    }
    expect(calls[2].registrations).toEqual([])
    expect(calls[2].args).not.toContain('--extension')
    expect(calls[2].token).toBeUndefined()
  })
})
