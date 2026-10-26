import { describe, expect, it, vi } from 'vitest'
import type { CodexSnapshot } from '../src/server/services/codex-service.js'
import type { JsonValue, PendingServerRequest } from '../src/shared/protocol.js'
import { KeepAwakeController, localAgentsWorking } from '../program/plugins/keep-awake-model.js'

const idle = (): CodexSnapshot => ({ status: 'ready', models: [], activeThreadIds: [], threadStates: {}, threadSettings: {} })
const running = (...ids: string[]): CodexSnapshot => ({ ...idle(), activeThreadIds: ids,
  threadStates: Object.fromEntries(ids.map((id) => [id, { status: { type: 'active' } }])) })
const request = (method: string, threadId: string, agentSessionId?: string): PendingServerRequest => ({
  id: 'question', method, params: { threadId, ...(agentSessionId ? { agentSessionId } : {}) }, receivedAt: '',
})
const acpId = 'acp-00000000-0000-0000-0000-000000000001'
function acp(protocol = 'acp'): Record<string, JsonValue> {
  return {
    'agent-chats': { providers: [{ id: 'provider', protocol, status: 'ready' }] },
    [`agent-chats.${acpId}`]: {
      summary: { id: acpId, providerId: 'provider', providerSessionId: 'root' },
      turn: 'running', requests: [], children: [],
    },
  }
}
const chat = (state: Record<string, JsonValue>): Record<string, JsonValue> => state[`agent-chats.${acpId}`] as Record<string, JsonValue>

describe('local work that prevents idle sleep', () => {
  it('counts work across native chats and releases after the last one ends or disconnects', () => {
    expect(localAgentsWorking(idle(), [], {})).toBe(false)
    expect(localAgentsWorking(running('background', 'selected'), [], {})).toBe(true)
    expect(localAgentsWorking(running('background'), [], {})).toBe(true)
    expect(localAgentsWorking({ ...running('background'), status: 'failed' }, [], {})).toBe(false)
  })

  it('pauses for blocking native questions and approvals without pausing other work', () => {
    for (const flag of ['waitingOnUserInput', 'waitingOnApproval']) {
      const state = running('parent')
      state.threadStates.parent!.status.activeFlags = [flag]
      expect(localAgentsWorking(state, [], {})).toBe(false)
      state.activeThreadIds.push('child')
      expect(localAgentsWorking(state, [], {})).toBe(true)
    }
    for (const method of ['item/tool/requestUserInput', 'item/commandExecution/requestApproval']) {
      expect(localAgentsWorking(running('parent'), [request(method, 'parent')], {})).toBe(false)
    }
    expect(localAgentsWorking(running('parent'), [request('item/tool/call', 'parent')], {})).toBe(true)
  })

  it('counts running native children restored by the monitor, but ignores history and stale monitor state', () => {
    const tasks = [{ threadId: 'child', parentThreadId: 'parent', status: 'working' }]
    expect(localAgentsWorking(idle(), [], { orchestrator: { tasks } })).toBe(true)
    for (const status of ['waiting', 'done', 'failed', 'stopped', 'unknown']) {
      expect(localAgentsWorking(idle(), [], { orchestrator: { tasks: [{ ...tasks[0], status }] } })).toBe(false)
    }
    const completed = { ...idle(), threadStates: { child: { status: { type: 'idle' } } } }
    expect(localAgentsWorking(completed, [], { orchestrator: { tasks } })).toBe(false)
    expect(localAgentsWorking({ ...idle(), status: 'stopped' }, [], { orchestrator: { tasks } })).toBe(false)
  })

  it('counts local ACP turns, while ignoring remote providers and disconnected local providers', () => {
    expect(localAgentsWorking(idle(), [], acp())).toBe(true)
    expect(localAgentsWorking(idle(), [], acp('remote'))).toBe(false)
    const state = acp()
    state['agent-chats'] = { providers: [{ id: 'provider', protocol: 'acp', status: 'failed' }] }
    expect(localAgentsWorking(idle(), [], state)).toBe(false)
    const remote = acp()
    chat(remote).remote = { state: 'connected' }
    expect(localAgentsWorking(idle(), [], remote)).toBe(false)
  })

  it('keeps mixed local and remote work awake only until the local turn finishes', () => {
    expect(localAgentsWorking(running('local'), [], acp('remote'))).toBe(true)
    expect(localAgentsWorking(idle(), [], acp('remote'))).toBe(false)
    const state = acp('remote')
    state.orchestrator = { tasks: [{ parentThreadId: acpId, threadId: acpId + ':child', status: 'working' }] }
    expect(localAgentsWorking(idle(), [], state)).toBe(false)
  })

  it('accounts for local ACP children independently of their parent and pending requests', () => {
    const state = acp()
    chat(state).turn = 'idle'
    chat(state).children = [{ sessionId: 'child', task: { status: 'working' } }]
    expect(localAgentsWorking(idle(), [], state)).toBe(true)
    chat(state).requests = [request('agent/requestApproval', acpId, 'child')] as unknown as JsonValue
    expect(localAgentsWorking(idle(), [], state)).toBe(false)
    chat(state).turn = 'running'
    expect(localAgentsWorking(idle(), [], state)).toBe(true)
    chat(state).requests = [request('agent/requestUserInput', acpId, 'root')] as unknown as JsonValue
    expect(localAgentsWorking(idle(), [], state)).toBe(true)
    chat(state).children = []
    expect(localAgentsWorking(idle(), [], state)).toBe(false)
    chat(state).requests = []
    expect(localAgentsWorking(idle(), [], state)).toBe(true)
  })
})

describe('idle sleep assertion lifetime', () => {
  it('defaults off and holds one system-only assertion until work ends or the setting is disabled', () => {
    const blocker = { start: vi.fn().mockReturnValue(1), stop: vi.fn().mockReturnValue(true) }
    const controller = new KeepAwakeController(blocker)
    expect(controller.update(false, true).active).toBe(false)
    expect(controller.update(true, false).active).toBe(false)
    expect(blocker.start).not.toHaveBeenCalled()
    expect(controller.update(true, true).active).toBe(true)
    controller.update(true, true)
    expect(blocker.start.mock.calls).toEqual([['prevent-app-suspension']])
    expect(controller.update(true, false).active).toBe(false)
    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(1)
    controller.update(true, true)
    controller.update(false, true)
    expect(blocker.stop).toHaveBeenCalledTimes(2)
  })

  it('releases on plugin disposal and cannot acquire another assertion afterward', () => {
    const blocker = { start: vi.fn().mockReturnValue(4), stop: vi.fn().mockReturnValue(true) }
    const controller = new KeepAwakeController(blocker)
    controller.update(true, true)
    controller.dispose()
    controller.dispose()
    expect(controller.update(true, true).active).toBe(false)
    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(4)
    expect(blocker.start).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable desktop support and native failures without claiming to keep the computer awake', () => {
    expect(new KeepAwakeController().update(true, true)).toEqual({ enabled: true, available: false, active: false })
    const controller = new KeepAwakeController({ start: () => { throw new Error('Native failure') }, stop: () => true })
    expect(controller.update(true, true)).toEqual({ enabled: true, available: true, active: false, problem: 'Native failure' })
  })
})
