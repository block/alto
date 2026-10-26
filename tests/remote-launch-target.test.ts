import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentChats } from '../program/plugins/agent-chats.js'
import { RemoteAgentProvider } from '../program/plugins/remote-agent-provider.js'
import { remoteLaunchTarget, type RemoteLaunchTarget } from '../program/plugins/remote-launch-api.js'
import type { AgentProvider, AgentRegistry, AgentSessionOptions } from '../src/server/services/agent-registry.js'
import type { RemoteAgentBackend } from '../src/server/services/remote-agent-api.js'

const target: RemoteLaunchTarget = { repository: 'https://github.com/example/repo.git', branch: 'review/branch', key: 'github.com/example/repo:pr:42' }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

describe('explicit remote chat checkouts', () => {
  it('passes the requested repository, branch, and watch identity through chat creation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'alto-launch-target-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const createSession = vi.fn(async (options: AgentSessionOptions) => ({ id: 'session', providerId: 'blox-codex', cwd: options.cwd, createdAt: new Date().toISOString() }))
    const provider = {
      snapshot: () => ({ id: 'blox-codex', label: 'Codex', protocol: 'remote', remoteLaunchTargets: true, capabilities: { durableSession: true } }),
      createSession, closeSession: vi.fn(async () => {}),
    } as unknown as AgentProvider
    const chats = new AgentChats({ provider: () => provider } as unknown as AgentRegistry, directory, () => {})
    cleanup.push(() => chats.dispose())
    await chats.load()
    const chat = await chats.create('blox-codex', '/local/association-only', 'full', target)
    expect(createSession).toHaveBeenCalledWith({ cwd: '/local/association-only', permissionMode: 'full', remoteTarget: target, mcpServers: [] })
    expect(chat.summary.cwd).toBe('/local/association-only')
    expect(chat.remote).toBeDefined()
  })

  it('rejects unsupported providers before they can start a process in the wrong checkout', async () => {
    const createSession = vi.fn()
    const provider = { snapshot: () => ({ protocol: 'remote' }), createSession } as unknown as AgentProvider
    const chats = new AgentChats({ provider: () => provider } as unknown as AgentRegistry, '/unused', () => {})
    await expect(chats.create('old-backend', '/local/repo', 'full', target)).rejects.toThrow('does not support an explicit remote checkout')
    expect(createSession).not.toHaveBeenCalled()
  })

  it('advertises target support and forwards the target only when requested', async () => {
    const create = vi.fn().mockRejectedValue(new Error('captured before starting a process'))
    const backend = { id: 'blox', label: 'Blox', supportsLaunchTarget: true, create } as unknown as RemoteAgentBackend
    const provider = new RemoteAgentProvider(backend, { id: 'codex', label: 'Codex', protocol: 'codex-app-server' }, '/unused')
    expect(provider.snapshot().remoteLaunchTargets).toBe(true)
    await expect(provider.createSession({ cwd: '/local/repo', permissionMode: 'full', remoteTarget: target })).rejects.toThrow('captured')
    expect(create).toHaveBeenLastCalledWith('codex', '/local/repo', expect.any(AbortSignal), target)
    await expect(provider.createSession({ cwd: '/local/repo', permissionMode: 'ask' })).rejects.toThrow('captured')
    expect(create).toHaveBeenLastCalledWith('codex', '/local/repo', expect.any(AbortSignal))
  })

  it('also rejects unsupported targets at the provider boundary', async () => {
    const create = vi.fn()
    const backend = { id: 'blox', label: 'Blox', create } as unknown as RemoteAgentBackend
    const provider = new RemoteAgentProvider(backend, { id: 'codex', label: 'Codex', protocol: 'codex-app-server' }, '/unused')
    expect(provider.snapshot().remoteLaunchTargets).toBeUndefined()
    await expect(provider.createSession({ cwd: '/local/repo', permissionMode: 'full', remoteTarget: target })).rejects.toThrow('does not support an explicit checkout')
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects incomplete and control-character target inputs', () => {
    expect(() => remoteLaunchTarget({ ...target, key: '' })).toThrow('key')
    expect(() => remoteLaunchTarget({ ...target, branch: 'branch\nmain' })).toThrow('branch')
    expect(() => remoteLaunchTarget({ branch: 'main', key: 'watch' })).toThrow('repository')
    expect(remoteLaunchTarget({ ...target, ignored: 'value' })).toEqual(target)
  })
})
