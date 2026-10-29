/**
 * Diagnostic only: no real agent, socket, UI rendering, or timing threshold.
 * From the repository root:
 *   node --import tsx scripts/benchmark-agent-session.ts
 *   node --import tsx scripts/benchmark-agent-session.ts --ref <baseline-commit>
 * --ref changes only AgentSessionService; shared helpers use the checkout.
 */
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { AgentSessionService } from '../program/plugins/agent-session.client.js'
import { applyAgentChatEvent } from '../program/plugins/agent-chat-events.js'

let SessionClass = AgentSessionService
const chatId = (index: number) => `acp-11111111-1111-4111-8111-${(index + 1).toString(16).padStart(12, '0')}`
const summary = (index: number) => ({ id: chatId(index), providerId: 'claude', providerSessionId: `session-${index}`, cwd: `/work/project-${index % 12}`, title: `Conversation ${index}`, preview: 'Saved conversation', createdAt: index, updatedAt: index })
const makeChat = (index: number) => ({ summary: summary(index), permissionMode: 'ask', turn: 'running', turnId: 'turn', configOptions: [], configurationRevision: 1,
  activities: Array.from({ length: 200 }, (_, row) => ({ id: `message-${row}`, kind: 'agent', title: 'Assistant', content: `Saved message ${row}`, timestamp: '', status: 'completed' })), requests: [] })

async function sessions(catalogEvery: number) {
  const catalogBoundaryMs: number[] = []
  const nativeListeners = new Set<() => void>(), hostListeners = new Set<() => void>()
  const chats = Array.from({ length: 24 }, (_, index) => makeChat(index))
  let extensions: any = { 'agent-chats': { providers: [{ id: 'claude', label: 'Claude', protocol: 'acp', capabilities: { images: true, steering: true } }], threads: Array.from({ length: 1000 }, (_, index) => summary(index)) } }
  for (const chat of chats) extensions[`agent-chats.${chat.summary.id}`] = chat
  let harness: any = { codex: { status: 'ready', models: [] }, extensions, pendingRequests: [] }
  let hostState: any = { revision: 0, connected: true, snapshot: harness }
  let nativeState: any = { revision: 0, connected: true, harness, session: { workspace: '/work/project-0', permissionMode: 'ask' }, turn: { tag: 'idle' },
    agentStatus: { state: 'idle', label: 'Ready' }, activities: [], history: { tag: 'ready', entries: [] }, threads: [],
    projects: Array.from({ length: 12 }, (_, index) => ({ id: `p-${index}`, name: `Project ${index}`, roots: [`/work/project-${index}`] })), skills: [] }
  const native: any = { snapshot: () => nativeState, subscribe: (listener: () => void) => { nativeListeners.add(listener); return () => nativeListeners.delete(listener) } }
  const host: any = { snapshot: () => hostState, subscribe: (listener: () => void) => { hostListeners.add(listener); return () => hostListeners.delete(listener) },
    call: async (_method: string, payload: any) => ({ summary: chats.find(chat => chat.summary.id === payload.id)!.summary, permissionMode: 'ask' }) }
  const mounted = Array.from({ length: 24 }, () => new SessionClass(native, host))
  for (let index = 0; index < mounted.length; index++) await mounted[index]!.openThread(chats[index]!.summary as any)
  let notifications = 0, historyChanges = 0, activityChanges = 0
  for (const session of mounted) session.subscribe(() => notifications++)
  const times: number[] = []
  const start = performance.now()
  for (let index = 0; index < 80; index++) {
    const previous = mounted.map(session => session.snapshot())
    const chat = chats[0]!
    const activities = [...chat.activities, { id: `chunk-${index}`, kind: 'agent', title: 'Assistant', content: `Chunk ${index}`, timestamp: '', status: 'streaming' }]
    chats[0] = { ...chat, activities }
    extensions = { ...extensions, [`agent-chats.${chat.summary.id}`]: chats[0] }
    const metadataChanged = catalogEvery > 0 && index > 0 && index % catalogEvery === 0
    if (metadataChanged) {
      const catalog = extensions['agent-chats']
      const threads = [...catalog.threads]
      threads[0] = { ...threads[0], updatedAt: 2000 + index }
      extensions = { ...extensions, 'agent-chats': { ...catalog, threads } }
    }
    harness = { ...harness, extensions }
    hostState = { ...hostState, revision: hostState.revision + 1, snapshot: harness }
    nativeState = { ...nativeState, revision: nativeState.revision + 1, harness }
    const before = performance.now()
    for (const listener of nativeListeners) listener()
    for (const listener of hostListeners) listener()
    const elapsed = performance.now() - before
    times.push(elapsed)
    if (metadataChanged) catalogBoundaryMs.push(elapsed)
    for (let pane = 0; pane < mounted.length; pane++) {
      historyChanges += Number(previous[pane]!.threads !== mounted[pane]!.snapshot().threads)
      activityChanges += Number(previous[pane]!.activities !== mounted[pane]!.snapshot().activities)
    }
  }
  const elapsedMs = performance.now() - start
  const sorted = times.toSorted((a, b) => a - b)
  const result = { scenario: '24 mounted ACP panes, 1000 saved summaries, 12 projects, 80 updates to one pane, native+host delivery', catalogEvery, elapsedMs, p50Ms: sorted[40], p95Ms: sorted[76], maxMs: sorted.at(-1), catalogBoundaryMs, notifications, historyChanges, activityChanges, finalItems: mounted[0]!.snapshot().activities.length }
  mounted.forEach(session => session.dispose())
  return result
}

function transcript() {
  const chat: any = { ...makeChat(0), activities: Array.from({ length: 2000 }, (_, index) => ({ id: `old-${index}`, kind: 'agent', title: 'Assistant', content: `Past answer ${index}`, status: 'completed', timestamp: '' })) }
  const event: any = { type: 'message.delta', providerId: 'claude', sessionId: 'session-0', turnId: 'turn', occurredAt: '2026-10-29T20:00:00Z', role: 'agent', content: { type: 'text', text: 'word ' } }
  const start = performance.now()
  for (let index = 0; index < 1500; index++) applyAgentChatEvent(chat, event)
  return { scenario: '2000 saved activities, 1500 ACP text deltas', elapsedMs: performance.now() - start, finalLength: chat.activities.at(-1).content.length }
}

async function main() {
  const refIndex = process.argv.indexOf('--ref')
  const reference = refIndex < 0 ? undefined : process.argv[refIndex + 1]
  if (refIndex >= 0 && !reference) throw new Error('--ref requires a git reference')
  let temporary: string | undefined
  try {
    if (reference) {
      const contents = execFileSync('git', ['show', reference + ':program/plugins/agent-session.client.ts'], { encoding: 'utf8' })
      const bundle = await build({ stdin: { contents, sourcefile: 'agent-session.client.ts',
        resolveDir: fileURLToPath(new URL('../program/plugins/', import.meta.url)), loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', write: false })
      temporary = mkdtempSync(tmpdir() + '/alto-acp-benchmark-')
      const filename = temporary + '/agent-session.cjs'
      writeFileSync(filename, bundle.outputFiles[0]!.text)
      SessionClass = createRequire(import.meta.url)(filename).AgentSessionService
    }
    const result = { node: process.version, implementation: reference ?? 'working tree',
      steady: await sessions(0), mixed: await sessions(31), transcript: transcript() }
    const output = JSON.stringify(result, null, 2)
    if (process.env.ALTO_ACP_PERF_OUTPUT) writeFileSync(process.env.ALTO_ACP_PERF_OUTPUT, output + '\n')
    console.log(output)
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
