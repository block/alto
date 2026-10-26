import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Context } from 'cordis'
import { expect, it } from 'vitest'
import { CodexService, type CodexModelRoute } from '../src/server/services/codex-service.js'

class MockProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  kill(): boolean { queueMicrotask(() => this.emit('exit', 0, null)); return true }
}

const route: CodexModelRoute = {
  modelProvider: 'configured',
  model: { id: 'custom-model', displayName: 'Custom model', defaultReasoningEffort: 'high' },
  config: {
    model: 'custom-model', model_provider: 'configured', model_reasoning_effort: 'high', model_catalog_json: '/tmp/custom-models.json', web_search: 'disabled',
    model_providers: { configured: { base_url: 'https://example.invalid/v1', wire_api: 'responses',
      auth: { command: '/tmp/token-helper' } } },
  },
}

async function fixture() {
  const child = new MockProcess()
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const threads = new Map<string, Record<string, unknown>>()
  let serial = 0
  let buffer = ''
  child.stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const request = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      if (request.id === undefined) continue
      requests.push(request)
      const reply = (result: unknown) => child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`)
      const params = request.params ?? {}
      if (request.method === 'initialize') reply({})
      else if (request.method === 'model/list') reply({ data: [{ id: 'native-model', displayName: 'Native', isDefault: true }] })
      else if (request.method === 'config/read') reply({ config: { model: 'native-model' } })
      else if (request.method === 'project/list') reply({ data: [] })
      else if (request.method === 'thread/start') {
        const thread = { id: `thread-${++serial}`, cwd: '/tmp/project', createdAt: 1, updatedAt: 1,
          modelProvider: params.modelProvider ?? 'openai' }
        threads.set(thread.id, thread)
        reply({ thread, cwd: thread.cwd, modelProvider: thread.modelProvider, model: params.model,
          approvalPolicy: params.approvalPolicy, sandbox: { type: 'dangerFullAccess' } })
      } else if (request.method === 'thread/read') reply({ thread: threads.get(params.threadId) })
      else if (request.method === 'thread/resume') {
        const thread = threads.get(params.threadId)!
        reply({ thread, cwd: thread.cwd, modelProvider: thread.modelProvider,
          model: thread.modelProvider === 'openai' ? 'native-model' : 'custom-model',
          approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, initialTurnsPage: { data: [] } })
      } else if (request.method === 'turn/start') reply({ turn: { id: `turn-${++serial}` } })
      else reply({})
    }
  })
  const ctx = { root: new EventEmitter(), tools: { toAppServerSpecs: () => [] },
    projects: { importProjects: async () => {}, classifyThreads: async (items: unknown) => items },
    turnProgram: { prepare: async (draft: unknown) => draft } } as unknown as Context
  const service = new CodexService(ctx, { projectRoot: '/tmp/project', createProcess: () => child })
  await service.start()
  const unregister = service.registerModelRoute(route)
  return { service, requests, threads, unregister, close: () => service.stop() }
}

it('adds a removable native choice without replacing the catalog, defaults, or exposing auth configuration', async () => {
  const f = await fixture()
  try {
    const snapshot = f.service.snapshot()
    expect(snapshot.defaults?.model).toBe('native-model')
    expect(snapshot.models.map((model) => model.id)).toEqual(['native-model', 'custom-model'])
    expect(snapshot.models[1]).toMatchObject({ modelProvider: 'configured', isDefault: false })
    expect(JSON.stringify(snapshot)).not.toContain('token-helper')
    f.unregister()
    expect(f.service.snapshot().models.map((model) => model.id)).toEqual(['native-model'])
  } finally { await f.close() }
})

it('routes selected custom threads through native configuration while ordinary starts retain their request shape', async () => {
  const f = await fixture()
  try {
    const normal = await f.service.startThread({ workspace: '/tmp/project', permissionMode: 'full', model: 'native-model' })
    const custom = await f.service.startThread({ workspace: '/tmp/project', permissionMode: 'full', model: 'custom-model' })
    const starts = f.requests.filter((request) => request.method === 'thread/start')
    expect(starts[0]?.params).not.toHaveProperty('config')
    expect(starts[0]?.params).not.toHaveProperty('modelProvider')
    expect(starts[1]?.params).toMatchObject({ model: 'custom-model', modelProvider: 'configured', config: route.config })
    expect(f.service.snapshot().threadSettings[custom.thread!.id!]?.modelProvider).toBe('configured')
    expect(f.service.snapshot().threadSettings[normal.thread!.id!]?.modelProvider).toBe('openai')
  } finally { await f.close() }
})

it('uses authoritative saved provider on resume, ignoring a contradictory browser draft in both directions', async () => {
  const f = await fixture()
  try {
    f.threads.set('saved-custom', { id: 'saved-custom', cwd: '/tmp/project', createdAt: 1, updatedAt: 1, modelProvider: 'configured' })
    f.threads.set('saved-native', { id: 'saved-native', cwd: '/tmp/project', createdAt: 1, updatedAt: 1, modelProvider: 'openai' })
    const custom = await f.service.openThread('saved-custom', { workspace: '/tmp/stale', permissionMode: 'ask', model: 'native-model', modelProvider: 'openai' })
    const native = await f.service.openThread('saved-native', { workspace: '/tmp/stale', permissionMode: 'ask', model: 'custom-model', modelProvider: 'configured' })
    const resumes = f.requests.filter((request) => request.method === 'thread/resume')
    expect(resumes[0]?.params).toMatchObject({ threadId: 'saved-custom', config: { model_catalog_json: '/tmp/custom-models.json', model_providers: route.config.model_providers } })
    expect(resumes[0]?.params).not.toHaveProperty('modelProvider')
    expect(resumes[0]?.params.config).not.toHaveProperty('model')
    expect(resumes[0]?.params.config).not.toHaveProperty('model_provider')
    expect(resumes[0]?.params.config).not.toHaveProperty('model_reasoning_effort')
    expect(resumes[1]?.params).not.toHaveProperty('config')
    expect(resumes[1]?.params).not.toHaveProperty('modelProvider')
    expect(resumes.every((request) => !('model' in request.params) && !('cwd' in request.params))).toBe(true)
    expect(custom.session?.modelProvider).toBe('configured')
    expect(native.session?.modelProvider).toBe('openai')
  } finally { await f.close() }
})

it('rejects provider changes before an outbound turn and still permits inherited custom turns', async () => {
  const f = await fixture()
  try {
    const custom = await f.service.startThread({ workspace: '/tmp/project', permissionMode: 'full', model: 'custom-model' })
    const threadId = custom.thread!.id!
    await expect(f.service.startTurn(threadId, [{ type: 'text', text: 'wrong route' }], {
      workspace: '/tmp/project', permissionMode: 'full', model: 'native-model', modelProvider: 'openai',
    })).rejects.toThrow('different Codex model provider')
    await expect(f.service.startTurn(threadId, [{ type: 'text', text: 'contradictory route' }], {
      workspace: '/tmp/project', permissionMode: 'full', model: 'native-model', modelProvider: 'configured',
    })).rejects.toThrow('different Codex provider')
    expect(f.requests.filter((request) => request.method === 'turn/start')).toHaveLength(0)
    await f.service.startTurn(threadId, [{ type: 'text', text: 'same provider' }], {
      workspace: '/tmp/project', permissionMode: 'full', model: 'custom-model',
    })
    await f.service.startTurn(threadId, [{ type: 'text', text: 'inherit' }], {
      workspace: '/tmp/project', permissionMode: 'full',
    })
    expect(f.requests.filter((request) => request.method === 'turn/start')).toHaveLength(2)
  } finally { await f.close() }
})
