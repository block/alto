import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { type JsonValue } from '../../src/shared/protocol.js'
import type {} from './agent-chats.js'
import type {} from './remote-launch-api.js'
import type {} from './workspace-commands-api.js'
import { PR_WATCHER_STATE } from './pr-watcher-api.js'
import { readExistingWatchTarget, readWatchTarget } from './pr-watcher-github.js'
import { PrWatchers, type SavedWatch } from './pr-watcher-model.js'
import { validateProjectWorkspace } from './workspace-files.js'

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const text = z.string().min(1).max(8_192)
const member = z.object({ number: z.number().int().positive(), url: text, title: z.string(), autoAddressFeedback: z.boolean() })
const savedWatch = z.object({
  key: text, cwd: text, enabled: z.boolean(),
  view: z.object({ id: z.uuid(), scope: z.enum(['pr', 'stack']), pullRequestUrl: text, label: text,
    threadId: z.string().regex(/^acp-[a-f0-9-]{36}$/u).optional(),
    status: z.enum(['starting', 'watching', 'working', 'paused', 'blocked', 'done']), message: z.string().optional(), members: z.array(member).max(100), updatedAt: z.number() }),
  observed: z.array(text).max(10_000), handled: z.array(text).max(10_000),
  attempts: z.array(z.object({ number: z.number().int().positive(), head: text, at: z.number() })).max(1_000),
  pending: z.object({ id: z.uuid(), feedback: z.array(text).max(10_000), startedAt: z.number(), sent: z.boolean() }).optional(),
})
const storeSchema = z.object({ version: z.literal(1), watches: z.array(savedWatch).max(100),
  alerts: z.array(z.object({ id: text, threadId: text, title: text, body: z.string() })).max(100) })
const startSchema = z.object({ pullRequestUrl: text, scope: z.enum(['pr', 'stack']), sourceCwd: text, sourceThreadId: text.optional() })
const idSchema = z.object({ id: z.uuid() })

const plugin: HarnessPlugin = async (ctx) => {
  const state = ctx.clientExtensions.registerState(ctx, PR_WATCHER_STATE, { available: false, watches: [], alerts: [] })
  const file = path.join(ctx.program.projectRoot, '.codex-cordis', 'pr-watchers.json')
  const provider = () => ctx.agents.snapshot().find((candidate) => candidate.location?.id === 'blox' && candidate.agentId === 'codex'
    && candidate.protocol === 'remote' && candidate.remoteLaunchTargets && candidate.status === 'ready')
  let active = true
  const watchers = new PrWatchers({
    available: () => Boolean(provider()),
    readTarget: (url, scope, signal, existing) => existing
      ? readExistingWatchTarget(existing, ctx.processRunner, signal)
      : readWatchTarget(url, scope, ctx.processRunner, signal),
    create: async (target, cwd) => {
      const selected = provider()
      if (!selected) throw new Error('Blox needs an updated remote agent plugin to launch the PR branch')
      const initial = target.members.find((member) => member.url === target.pullRequestUrl && member.state === 'OPEN')
        ?? target.members.find((member) => member.state === 'OPEN')
      if (!initial) throw new Error('All PRs in this watcher are closed')
      const chat = await ctx.agentChats.create(selected.id, cwd, 'full', {
        repository: `https://github.com/${initial.headRepository}.git`, branch: initial.branch, key: target.key,
      })
      await ctx.agentChats.rename(chat.summary.id, `Watch · ${target.label}`)
      return chat.summary.id
    },
    chat: async (id) => {
      const chat = await ctx.agentChats.open(id)
      const resultText = chat.activities.filter((item) => item.kind === 'agent').at(-1)?.content
      return { turn: chat.turn, requests: chat.requests,
        ...(chat.problem ? { problem: chat.problem } : {}),
        ...(chat.remote ? { remote: chat.remote } : {}), ...(resultText ? { resultText } : {}) }
    },
    send: async (id, prompt) => {
      await ctx.agentChats.send(id, [{ type: 'text', text: prompt }], 'full')
      const watch = watchers.snapshot().watches.find((candidate) => candidate.threadId === id)
      if (watch) await ctx.agentChats.rename(id, `Watch · ${watch.label}`)
    },
    cancel: (id) => ctx.agentChats.cancel(id),
    open: async (id) => {
      const chat = await ctx.agentChats.read(id)
      await ctx.workspaceCommands.openPane({ kind: 'chat', direction: 'horizontal', thread: chat.summary,
        workspace: chat.summary.cwd, reuseThread: true, newTab: true })
    },
    save: async (watches, alerts) => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      const temporary = `${file}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify({ version: 1, watches, alerts }), { mode: 0o600 })
      await rename(temporary, file)
    },
    changed: (snapshot) => { if (active) state.update(json(snapshot)) },
  })
  ctx.effect(() => () => { active = false; return watchers.dispose() }, 'pr-watcher.lifetime')
  try {
    const saved = storeSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    watchers.restore(saved.watches as SavedWatch[], saved.alerts)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!active) return
  state.update(json(watchers.snapshot()))
  ctx.on('agents/changed', () => { if (active) state.update(json(watchers.snapshot())) })
  ctx.effect(() => {
    // Keep polling outside agent turns: no model tokens spent waiting for GitHub.
    const refresh = () => { void watchers.refreshAll().catch(() => {}) }
    const timer = setInterval(refresh, 60_000)
    refresh()
    return () => clearInterval(timer)
  }, 'pr-watcher.poll')
  ctx.clientExtensions.registerMethod(ctx, 'pr-watcher.start', async (payload) => {
    const input = startSchema.parse(payload)
    const sourceCwd = await validateProjectWorkspace(input.sourceCwd, ctx.projects.snapshot().projects.flatMap((project) => project.roots))
    return json(await watchers.start({ pullRequestUrl: input.pullRequestUrl, scope: input.scope, sourceCwd,
      ...(input.sourceThreadId ? { sourceThreadId: input.sourceThreadId } : {}) }))
  })
  for (const action of ['open', 'pause', 'resume'] as const) {
    ctx.clientExtensions.registerMethod(ctx, `pr-watcher.${action}`, async (payload) => {
      await watchers[action](idSchema.parse(payload).id)
      return null
    })
  }
  ctx.clientExtensions.registerMethod(ctx, 'pr-watcher.feedback', async (payload) => {
    const input = idSchema.extend({ number: z.number().int().positive(), enabled: z.boolean() }).parse(payload)
    await watchers.feedback(input.id, input.number, input.enabled)
    return null
  })
}
plugin.inject = ['agentChats', 'agents', 'clientExtensions', 'processRunner', 'program', 'projects', 'workspaceCommands']
export default plugin
