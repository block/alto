import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import sourceViewer from '../program/plugins/source-viewer.js'
import type { ClientExtensionHandler, DynamicToolHandler, HarnessContext } from '../src/server/plugin-api.js'
import type { JsonValue, RpcNotification } from '../src/shared/protocol.js'
import type { SourceEditRequest, SourceEditStatus } from '../program/plugins/source-edit-api.js'
import { SourceEdits, containsSourceEditRequest, parseSourceEditReplacement, sourceEditMarker, type SourceEditsOptions } from '../program/plugins/source-edits.js'

const directories: string[] = []
const services: SourceEdits[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function setup(source: string, options: Partial<SourceEditsOptions> & { program?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'alto-source-edit-')))
  directories.push(directory)
  const programRoot = path.join(directory, 'program')
  if (options.program) await mkdir(programRoot)
  const file = path.join(options.program ? programRoot : directory, 'sample.ts')
  await writeFile(file, source)
  const edits = new SourceEdits({
    roots: () => [directory], ...options,
    ...(options.program ? { programRoot } : {}),
  })
  services.push(edits)
  const request: SourceEditRequest = {
    path: file, workspace: directory,
    revision: createHash('sha256').update(source).digest('hex'),
    start: 2, end: 2, instruction: 'Update the selected statement', threadId: 'chat-one',
  }
  return { edits, file, directory, request }
}

function bind(edits: SourceEdits, id: string, threadId = 'chat-one', turnId = 'edit-turn'): void {
  edits.notification({ method: 'item/started', params: { threadId, turnId,
    item: { type: 'userMessage', content: [{ type: 'text', text: sourceEditMarker(id) }] },
  } })
}

function finish(edits: SourceEdits, threadId = 'chat-one', turnId = 'edit-turn', status = 'completed'): void {
  edits.notification({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status } } })
}

async function ready(edits: SourceEdits, request: SourceEditRequest, replacement = 'updated'): Promise<{ id: string; state: SourceEditStatus; prompt: string }> {
  const { id, prompt } = await edits.start(request)
  bind(edits, id, request.threadId)
  await edits.propose({ id, replacement }, { threadId: request.threadId, turnId: 'edit-turn' })
  const state = edits.status(id)
  expect(state.status).toBe('ready')
  return { id, state, prompt }
}

describe('inline source edits', () => {
  it('asks the existing chat for a scoped proposal, then applies only the selected lines once', async () => {
    const source = 'before\nselected\nafter\n'
    const validateThread = vi.fn(async () => {})
    const { edits, file, request } = await setup(source, { validateThread })
    await chmod(file, 0o751)
    const { id, state, prompt } = await ready(edits, request, 'one\ntwo')
    expect(validateThread).toHaveBeenCalledWith(request.threadId, request.workspace)
    expect(await readFile(file, 'utf8')).toBe(source)
    expect(state).toMatchObject({ status: 'ready', proposal: {
      id, path: file, revision: request.revision, start: 2, end: 2,
      original: 'selected\n', replacement: 'one\ntwo\n',
    } })
    expect(prompt).toContain('context already present in this conversation')
    expect(prompt).toContain('Do not edit files')
    expect(prompt).toContain('source/propose_edit')
    expect(prompt).toContain('Only the human clicking Accept')
    expect(prompt).toContain('"selection":"selected\\n"')
    expect(containsSourceEditRequest([{ type: 'text', text: prompt }], id)).toBe(true)

    const [first, second] = await Promise.all([edits.apply(id), edits.apply(id)])
    expect(second).toEqual(first)
    expect(await edits.apply(id)).toEqual(first)
    expect(await readFile(file, 'utf8')).toBe('before\none\ntwo\nafter\n')
    expect((await stat(file)).mode & 0o777).toBe(0o751)
    expect(first.revision).toBe(createHash('sha256').update('before\none\ntwo\nafter\n').digest('hex'))
  })

  it.each([
    ['first\r\nselected\r\nlast\r\n', 'changed\nagain', 'first\r\nchanged\r\nagain\r\nlast\r\n'],
    ['first\nselected', 'changed\n', 'first\nchanged'],
    ['first\nselected\nlast\n', '', 'first\nlast\n'],
    ['\uFEFFfirst\nselected\nlast\n', 'changed', '\uFEFFfirst\nchanged\nlast\n'],
  ])('preserves separators and untouched bytes in %j', async (source, replacement, expected) => {
    const { edits, file, request } = await setup(source)
    const { id } = await ready(edits, request, replacement)
    await edits.apply(id)
    expect(await readFile(file, 'utf8')).toBe(expected)
  })

  it('rejects stale viewer contents before returning a chat prompt', async () => {
    const { edits, file, request } = await setup('first\nselected\n')
    await writeFile(file, 'first\nnewer\n')
    await expect(edits.start(request)).rejects.toThrow('changed since it was opened')
  })

  it('reports changes made while the chat is working', async () => {
    const { edits, file, request } = await setup('first\nselected\n')
    const { id } = await edits.start(request)
    bind(edits, id)
    await writeFile(file, 'first\nnewer\n')
    await expect(edits.propose({ id, replacement: 'updated' }, { threadId: request.threadId, turnId: 'edit-turn' })).rejects.toThrow('file changed')
    expect(edits.status(id)).toMatchObject({ status: 'failed', problem: expect.stringContaining('file changed') })
    expect(await readFile(file, 'utf8')).toBe('first\nnewer\n')
  })

  it('keeps a conflicted proposal available without overwriting external changes', async () => {
    const { edits, file, request } = await setup('first\nselected\n')
    const { id } = await ready(edits, request)
    await writeFile(file, 'external\nselected\n')
    await expect(edits.apply(id)).rejects.toThrow('file changed')
    expect(edits.status(id).status).toBe('ready')
    expect(await readFile(file, 'utf8')).toBe('external\nselected\n')
    await expect(edits.discard(id)).resolves.toEqual({ discarded: true })
    await expect(edits.apply(id)).rejects.toThrow('expired')
  })

  it('serializes concurrent proposals for one file so the later acceptance conflicts', async () => {
    const { edits, file, request } = await setup('first\nselected\nlast\n')
    const first = await ready(edits, request)
    const second = await ready(edits, { ...request, start: 3, end: 3 })
    const outcomes = await Promise.allSettled([edits.apply(first.id), edits.apply(second.id)])
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected'])
    expect(await readFile(file, 'utf8')).toBe('first\nupdated\nlast\n')
    expect(edits.status(second.id).status).toBe('ready')
  })

  it('rejects files outside the selected workspace, including symlink escapes', async () => {
    const inside = await setup('first\nselected\n')
    const outside = await setup('first\nselected\n')
    await expect(inside.edits.start({ ...inside.request, path: outside.file })).rejects.toThrow('outside')
    const linked = path.join(inside.directory, 'linked.ts')
    await symlink(outside.file, linked)
    await expect(inside.edits.start({ ...inside.request, path: linked })).rejects.toThrow('outside')
    await expect(inside.edits.start({ ...outside.request })).rejects.toThrow('outside Alto projects')
  })

  it.each(['symlink', 'replacement'])('rejects a %s path swap even when the content is identical', async (kind) => {
    const { edits, file, request, directory } = await setup('first\nselected\n')
    const { id } = await ready(edits, request)
    const other = path.join(directory, 'other.ts')
    await writeFile(other, 'first\nselected\n')
    if (kind === 'symlink') {
      await unlink(file)
      await symlink(other, file)
    } else await rename(other, file)
    await expect(edits.apply(id)).rejects.toThrow('path changed')
    expect(await readFile(file, 'utf8')).toBe('first\nselected\n')
  })

  it('rejects running Alto program files before preparing a request', async () => {
    const { edits, file, request } = await setup('first\nselected\n', { program: true })
    await expect(edits.start(request)).rejects.toThrow('through the linked chat')
    expect(await readFile(file, 'utf8')).toBe('first\nselected\n')
  })

  it.each([
    { start: 0 }, { end: 501 }, { end: 40 }, { instruction: '' },
    { threadId: '' }, { threadId: null }, { revision: 'stale' }, { path: 'relative.ts' },
  ])('rejects invalid source edit requests: %j', async (invalid) => {
    const { edits, request } = await setup('first\nselected\n')
    await expect(edits.start({ ...request, ...invalid })).rejects.toThrow()
  })

  it('rejects a nonexistent or mismatched linked chat', async () => {
    const validateThread = vi.fn(async () => { throw new Error('The linked chat workspace changed') })
    const { edits, request } = await setup('first\nselected\n', { validateThread })
    await expect(edits.start(request)).rejects.toThrow('chat workspace changed')
  })

  it('allows proposals only from the actual receiving chat turn', async () => {
    const { edits, request, file } = await setup('first\nselected\n')
    const { id } = await edits.start(request)
    const proposal = { id, replacement: 'updated' }
    await expect(edits.propose(proposal, { threadId: request.threadId, turnId: 'edit-turn' })).rejects.toThrow('chat turn')
    bind(edits, id, 'other-chat')
    await expect(edits.propose(proposal, { threadId: 'other-chat', turnId: 'edit-turn' })).rejects.toThrow('chat turn')
    bind(edits, id)
    await expect(edits.propose(proposal, { threadId: request.threadId, turnId: 'other-turn' })).rejects.toThrow('chat turn')
    await expect(edits.propose(proposal, { threadId: request.threadId, turnId: 'edit-turn' })).resolves.toMatchObject({ ready: true })
    await expect(edits.propose(proposal, { threadId: request.threadId, turnId: 'edit-turn' })).rejects.toThrow('no longer waiting')
    expect(await readFile(file, 'utf8')).toBe('first\nselected\n')
  })

  it('ignores unrelated completed turns while the request is queued', async () => {
    const { edits, request } = await setup('first\nselected\n')
    const { id } = await edits.start(request)
    finish(edits, request.threadId, 'older-turn')
    bind(edits, id)
    finish(edits, 'other-chat')
    finish(edits, request.threadId, 'older-turn')
    expect(edits.status(id)).toEqual({ status: 'pending' })
    finish(edits)
    expect(edits.status(id)).toMatchObject({ status: 'failed', problem: expect.stringContaining('without submitting') })
  })

  it.each(['completed', 'interrupted', 'failed'])('closes a %s chat turn without a proposal', async (status) => {
    const { edits, request } = await setup('first\nselected\n')
    const { id, prompt } = await edits.start(request)
    edits.notification({ method: 'turn/completed', params: { threadId: request.threadId,
      turn: { id: 'edit-turn', status, items: [{ type: 'userMessage', content: [{ type: 'text', text: prompt }] }] },
    } })
    expect(edits.status(id).status).toBe('failed')
  })

  it('does not bind markers from model output, quoted markers, or other inputs', async () => {
    const { edits, request } = await setup('first\nselected\n')
    const { id } = await edits.start(request)
    edits.notification({ method: 'item/started', params: { threadId: request.threadId, turnId: 'edit-turn',
      item: { type: 'agentMessage', content: [{ type: 'text', text: sourceEditMarker(id) }] },
    } })
    expect(containsSourceEditRequest([{ type: 'text', text: 'Quoted ' + sourceEditMarker(id) }], id)).toBe(false)
    expect(containsSourceEditRequest([{ type: 'image', text: sourceEditMarker(id) }], id)).toBe(false)
    finish(edits)
    expect(edits.status(id).status).toBe('pending')
  })

  it('retains a ready proposal when its chat turn completes', async () => {
    const { edits, request } = await setup('first\nselected\n')
    const { id } = await ready(edits, request)
    finish(edits)
    expect(edits.status(id).status).toBe('ready')
  })

  it('keeps invalid tool output retryable and shows an explicit scoped refusal', async () => {
    const { edits, request } = await setup('first\nselected\n')
    const { id } = await edits.start(request)
    bind(edits, id)
    const caller = { threadId: request.threadId, turnId: 'edit-turn' }
    await expect(edits.propose({ id, replacement: 'new', path: 'elsewhere' }, caller)).rejects.toThrow('invalid')
    expect(edits.status(id).status).toBe('pending')
    await expect(edits.propose({ id, error: 'Needs an import outside the selection' }, caller)).resolves.toMatchObject({ ready: false })
    expect(edits.status(id)).toEqual({ status: 'failed', problem: 'Needs an import outside the selection' })
  })

  it('discards pending requests, removes queued input, and rejects every late proposal', async () => {
    const cancelRequest = vi.fn(async () => {})
    const { edits, request, file } = await setup('first\nselected\n', { cancelRequest })
    const { id } = await edits.start(request)
    bind(edits, id)
    await edits.discard(id)
    expect(cancelRequest).toHaveBeenCalledWith(request.threadId, id)
    await expect(edits.propose({ id, replacement: 'changed' }, { threadId: request.threadId, turnId: 'edit-turn' })).rejects.toThrow('expired')
    finish(edits)
    expect(() => edits.status(id)).toThrow('expired')
    expect(await readFile(file, 'utf8')).toBe('first\nselected\n')
  })

  it('retries queued cancellation if queue/add completes after discard', async () => {
    const cancelRequest = vi.fn(async () => {})
    const { edits, request } = await setup('first\nselected\n', { cancelRequest })
    const { id } = await edits.start(request)
    await edits.discard(id)
    edits.notification({ method: 'thread/queue/changed', params: { threadId: 'other-chat' } })
    expect(cancelRequest).toHaveBeenCalledTimes(1)
    edits.notification({ method: 'thread/queue/changed', params: { threadId: request.threadId } })
    expect(cancelRequest).toHaveBeenCalledTimes(2)
  })

  it('coalesces queue changes that arrive during the cancellation scan', async () => {
    let finishScan!: () => void
    const firstScan = new Promise<void>((resolve) => { finishScan = resolve })
    const cancelRequest = vi.fn(async () => {}).mockImplementationOnce(async () => firstScan)
    const { edits, request } = await setup('first\nselected\n', { cancelRequest })
    const { id } = await edits.start(request)
    const discarding = edits.discard(id)
    edits.notification({ method: 'thread/queue/changed', params: { threadId: request.threadId } })
    expect(cancelRequest).toHaveBeenCalledTimes(1)
    finishScan()
    await discarding
    expect(cancelRequest).toHaveBeenCalledTimes(2)
  })

  it('does not resurrect discarded requests when queue cancellation fails', async () => {
    const cancelRequest = vi.fn(async () => { throw new Error('queue disconnected') })
    const { edits, request } = await setup('first\nselected\n', { cancelRequest })
    const { id } = await edits.start(request)
    await expect(edits.discard(id)).resolves.toEqual({ discarded: true })
    expect(() => edits.status(id)).toThrow('expired')
  })

  it('expires retained proposals and prevents their use', async () => {
    const { edits, request } = await setup('first\nselected\n')
    const { id } = await ready(edits, request)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000)
    expect(() => edits.status(id)).toThrow('expired')
    await expect(edits.apply(id)).rejects.toThrow('expired')
  })

  it('does not return an orphaned request after disposal during source validation', async () => {
    const { request, directory } = await setup('first\nselected\n')
    const edits = new SourceEdits({ roots() { edits.dispose(); return [directory] } })
    services.push(edits)
    await expect(edits.start(request)).rejects.toThrow('restarted')
  })

  it('does not let completed proposals block an ongoing editing session', async () => {
    const { edits, request, file } = await setup('first\nselected\n')
    let revision = request.revision
    for (let index = 0; index < 18; index += 1) {
      const { id } = await ready(edits, { ...request, revision }, `change ${index}`)
      revision = (await edits.apply(id)).revision
    }
    expect(await readFile(file, 'utf8')).toBe('first\nchange 17\n')
  })
})

describe('Source edit plugin wiring', () => {
  it('uses trusted tool identity, observes native queue input, and removes only its cancelled submission', async () => {
    const { directory, request, file } = await setup('first\nselected\n')
    const methods = new Map<string, ClientExtensionHandler>()
    const notifications = new Map<string, (notification: RpcNotification) => void>()
    const tools = new Map<string, DynamicToolHandler>()
    const disposers: Array<() => void> = []
    const listQueuedSubmissions = vi.fn(async (): Promise<unknown[]> => [])
    const deleteQueuedSubmission = vi.fn(async () => {})
    const ctx = {
      effect: (effect: () => () => void) => disposers.push(effect()),
      on: (name: string, listener: (notification: RpcNotification) => void) => notifications.set(name, listener),
      codex: {
        threadSummary: vi.fn(async (id: string) => id === request.threadId ? { id, cwd: directory } : undefined),
        snapshot: () => ({ threadSettings: {} }), listQueuedSubmissions, deleteQueuedSubmission,
      },
      projects: { snapshot: () => ({ projects: [{ roots: [directory] }] }) },
      program: { programRoot: path.join(process.cwd(), 'program') },
      clientExtensions: { registerMethod: (_owner: unknown, name: string, handler: ClientExtensionHandler) => methods.set(name, handler) },
      tools: { register: (_owner: unknown, spec: { namespace: string; name: string }, handler: DynamicToolHandler) => tools.set(`${spec.namespace}/${spec.name}`, handler) },
    }
    ;(sourceViewer as (ctx: HarnessContext, options: unknown) => void)(ctx as unknown as HarnessContext, {})
    const call = async (method: string, payload: unknown) => methods.get(method)!(payload as JsonValue)
    try {
      await expect(call('source-edit.start', { ...request, threadId: 'missing-chat' })).rejects.toThrow('chat workspace changed')
      const { id, prompt } = await call('source-edit.start', request) as { id: string; prompt: string }
      notifications.get('codex/notification')!({ method: 'item/completed', params: {
        threadId: request.threadId, turnId: 'native-queued-turn',
        item: { type: 'userMessage', content: [{ type: 'text', text: prompt }] },
      } })
      const propose = tools.get('source/propose_edit')!
      const toolCall = { callId: 'proposal-call', tool: 'propose_edit', namespace: 'source',
        threadId: request.threadId, turnId: 'native-queued-turn', arguments: { id, replacement: 'new' } }
      await expect(propose({ ...toolCall, threadId: 'other-chat' })).rejects.toThrow('chat turn')
      await expect(propose(toolCall)).resolves.toMatchObject({ ready: true })
      await expect(call('source-edit.status', { id })).resolves.toMatchObject({ status: 'ready' })
      expect(await readFile(file, 'utf8')).toBe('first\nselected\n')

      const cancelled = await call('source-edit.start', request) as { id: string; prompt: string }
      listQueuedSubmissions.mockResolvedValue([
        { id: 'keep', input: [{ type: 'text', text: 'Normal chat prompt' }] },
        { id: 'remove', input: [{ type: 'text', text: cancelled.prompt }] },
        { id: 'also-keep', input: [{ type: 'text', text: `Quoted ${sourceEditMarker(cancelled.id)}` }] },
      ])
      await call('source-edit.discard', { id: cancelled.id })
      expect(listQueuedSubmissions).toHaveBeenCalledWith(request.threadId)
      expect(deleteQueuedSubmission).toHaveBeenCalledExactlyOnceWith(request.threadId, 'remove')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })
})

describe('model edit output', () => {
  it.each([
    'not JSON', '```json\n{"replacement":"new"}\n```', '[]',
    '{"replacement":42}', '{"replacement":"new","path":"elsewhere"}',
    '{"replacement":"\\u0000"}', '{"replacement":"\\ud800"}',
    '{"replacement":"same\\n"}',
  ])('rejects malformed or unusable output: %s', (output) => {
    expect(() => parseSourceEditReplacement(output, 'same\n', 'same\n')).toThrow()
  })

  it('preserves a scoped refusal as an actionable error', () => {
    expect(() => parseSourceEditReplacement(
      '{"error":"This needs an import outside the selected lines"}', 'same\n', 'same\n',
    )).toThrow('outside the selected lines')
  })
})
