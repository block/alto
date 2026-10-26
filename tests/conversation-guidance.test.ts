import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context, type Plugin } from 'cordis'
import { afterEach, expect, it, vi } from 'vitest'
import historyPlugin, { conversationDiscoveryGuidance } from '../program/plugins/chat-history.js'
import { AgentChats } from '../program/plugins/agent-chats.js'
import { ClientExtensionRegistry } from '../src/server/services/client-extension-registry.js'
import { DynamicToolRegistry } from '../src/server/services/tool-registry.js'
import { TurnProgram } from '../src/server/services/turn-program.js'
import type { AgentProvider, AgentRegistry } from '../src/server/services/agent-registry.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = new Context()
  const tools = new DynamicToolRegistry(root)
  const turns = new TurnProgram(root)
  const services = await root.plugin(((ctx) => {
    ctx.provide('codex', { request: vi.fn() } as unknown as Context['codex'])
    ctx.provide('projects', { classifyThreads: vi.fn() } as unknown as Context['projects'])
    ctx.provide('clientExtensions', new ClientExtensionRegistry(root))
    ctx.provide('agentChats', { refreshHistory: async () => {}, threads: () => [], historyErrors: () => [] } as unknown as Context['agentChats'])
    ctx.provide('tools', tools)
    ctx.provide('turnProgram', turns)
    ctx.provide('workspaceHistory', { conversations: () => [], tabs: () => [] })
    ctx.provide('workspaceCommands', { openPane: vi.fn() } as unknown as Context['workspaceCommands'])
  }) as Plugin)
  cleanup.push(() => services.dispose())
  const fiber = await root.plugin(historyPlugin, {})
  cleanup.push(() => fiber.dispose())
  return { tools, turns, fiber }
}

it('prepares every turn with guidance for the registered tools and removes both on unload', async () => {
  const { turns, tools, fiber } = await fixture()
  const input = {
    threadId: 'chat', input: [],
    additionalContext: { existing: { kind: 'application' as const, value: 'Keep me' } },
  }
  for (let turn = 0; turn < 2; turn++) {
    const prepared = await turns.prepare(input)
    expect(prepared.additionalContext?.existing).toEqual(input.additionalContext.existing)
    const guidance = prepared.additionalContext?.conversation_discovery
    expect(guidance?.kind).toBe('application')
    expect(guidance?.value).toBe(conversationDiscoveryGuidance)
    expect(Buffer.byteLength(guidance!.value)).toBeLessThan(4_000)
    const names = tools.list().map((tool) => `${tool.namespace}/${tool.name}`)
    expect(names).toEqual(['conversation/open', 'conversation/read', 'conversation/search', 'workspace/list_tabs'])
    for (const name of names) expect(guidance?.value).toContain(name)
  }
  expect(input.additionalContext).not.toHaveProperty('conversation_discovery')
  await fiber.dispose()
  expect(tools.list()).toEqual([])
  expect(await turns.prepare(input)).toEqual(input)
})

it('delivers the same guidance to ACP session creation, prompts, and live steering', async () => {
  const { turns } = await fixture()
  const directory = await mkdtemp(path.join(tmpdir(), 'alto-guidance-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const session = { id: 'session', providerId: 'pi', cwd: '/repo', createdAt: new Date().toISOString() }
  const createSession = vi.fn().mockResolvedValue(session)
  const prompt = vi.fn().mockResolvedValue({ id: 'turn' })
  const steer = vi.fn().mockResolvedValue('injected')
  const provider = {
    snapshot: () => ({ id: 'pi', protocol: 'acp', activeSessionIds: ['session'] }),
    createSession, prompt, steer,
  } as unknown as AgentProvider
  const chats = new AgentChats({ provider: () => provider } as unknown as AgentRegistry, directory, vi.fn(), undefined, turns)
  cleanup.push(() => chats.dispose())
  await chats.load()
  const chat = await chats.create('pi', '/repo', 'ask')
  const options = expect.objectContaining({ additionalContext: {
    conversation_discovery: { kind: 'application', value: conversationDiscoveryGuidance },
  } })
  expect(createSession).toHaveBeenCalledWith(options)
  const input = [{ type: 'text' as const, text: 'Find my Japan chat' }]
  await chats.send(chat.summary.id, input, 'ask')
  expect(prompt).toHaveBeenCalledWith('session', input, options)
  await chats.steer(chat.summary.id, input)
  expect(steer).toHaveBeenCalledWith('session', input, options)
})
