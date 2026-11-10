import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientHostService } from '../src/client/plugin-api.js'
import { MODEL_DEFAULTS_SET, applyModelDefaultsUpdate, type ModelDefaultsPreferences, type ModelDefaultsSaveFence, type ModelDefaultsUpdate } from '../program/plugins/model-defaults-api.js'
import { beginModelChoice, failModelChoice, rememberedModelDefaults, rememberModelChoice, saveModelDefaults } from '../program/plugins/model-defaults-memory.client.js'

const initial: ModelDefaultsPreferences = { providerId: 'claude', choices: {
  codex: { model: 'one', effort: 'low' }, claude: { model: 'opus', effort: 'high' },
} }

function fixture() {
  let preferences = structuredClone(initial), revision = 0
  let publication: ModelDefaultsPreferences & ModelDefaultsSaveFence = { ...preferences, saveEpoch: 'fixture', saveRevision: revision }
  const saves: Array<{ update: ModelDefaultsUpdate; resolve: (value: unknown) => void; reject: (error: Error) => void }> = []
  const call = vi.fn((_method: string, update: ModelDefaultsUpdate) => new Promise((resolve, reject) => { saves.push({ update, resolve, reject }) }))
  const host = { call, snapshot: () => ({ snapshot: { extensions: { 'model-defaults': publication } } }) } as unknown as ClientHostService
  return { host, call, saves, publish: (next: ModelDefaultsPreferences) => { preferences = next; publication = { ...next, saveEpoch: 'fixture', saveRevision: ++revision } },
    publishReceipt: (next: ModelDefaultsPreferences & ModelDefaultsSaveFence) => { publication = next },
    acknowledge: (index: number, publish = true) => {
      const save = saves[index]!
      preferences = applyModelDefaultsUpdate(preferences, save.update)
      const receipt = { ...preferences, saveEpoch: 'fixture', saveRevision: ++revision }
      if (publish) publication = receipt
      save.resolve(receipt)
      return receipt
    },
  }
}

describe('explicit model choice memory', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('exposes immediate choices until acknowledgement without writing on reads or changing the default agent', async () => {
    const f = fixture()
    for (let index = 0; index < 10; index++) expect(rememberedModelDefaults(f.host)).toEqual(initial)
    expect(f.call).not.toHaveBeenCalled()
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'medium' })
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' })
    const expected = { providerId: 'claude', choices: { ...initial.choices, codex: { model: 'two', effort: 'high' } } }
    expect(rememberedModelDefaults(f.host)).toEqual(expected)
    expect(f.call).toHaveBeenNthCalledWith(1, MODEL_DEFAULTS_SET, { providerId: 'codex', model: 'two', effort: 'medium', selectProvider: false })
    f.acknowledge(0)
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)).toEqual(expected)
    f.acknowledge(1)
    await Promise.resolve()
    f.publish(initial)
    expect(rememberedModelDefaults(f.host)).toEqual(initial)
    expect(f.call).toHaveBeenCalledTimes(2)
  })

  it('isolates hosts and avoids saving an unchanged choice', () => {
    const first = fixture(), second = fixture()
    rememberModelChoice(first.host, { providerId: 'codex', model: 'one', effort: 'low' })
    expect(first.call).not.toHaveBeenCalled()
    rememberModelChoice(first.host, { providerId: 'codex', model: 'two', effort: null })
    expect(rememberedModelDefaults(first.host)?.choices.codex).toEqual({ model: 'two' })
    expect(rememberedModelDefaults(second.host)).toEqual(initial)
    expect(second.call).not.toHaveBeenCalled()
  })

  it('keeps the latest choice when switching back before an older save is published', async () => {
    const f = fixture()
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' })
    rememberModelChoice(f.host, { providerId: 'codex', model: 'one', effort: 'low' })
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual(initial.choices.codex)
    f.acknowledge(0)
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual(initial.choices.codex)
    f.acknowledge(1)
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)).toEqual(initial)
  })

  it('keeps a successful choice until its acknowledged publication arrives', async () => {
    const f = fixture()
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' })
    const receipt = f.acknowledge(0, false)
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual({ model: 'two', effort: 'high' })
    f.publishReceipt(receipt)
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual({ model: 'two', effort: 'high' })
    f.publish(initial)
    expect(rememberedModelDefaults(f.host)).toEqual(initial)
  })

  it('does not infer an A to B to A save from the unchanged pre-save A publication', async () => {
    const f = fixture()
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' })
    rememberModelChoice(f.host, { providerId: 'codex', model: 'one', effort: 'low' })
    const older = f.acknowledge(0, false), latest = f.acknowledge(1, false)
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual(initial.choices.codex)
    f.publishReceipt(older)
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual(initial.choices.codex)
    f.publishReceipt(latest)
    expect(rememberedModelDefaults(f.host)).toEqual(initial)
  })

  it('orders successful explicit intent across panes without letting failed later intent suppress success', () => {
    const f = fixture()
    const older = beginModelChoice(f.host, 'codex'), newer = beginModelChoice(f.host, 'codex')
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' }, newer)
    rememberModelChoice(f.host, { providerId: 'codex', model: 'one', effort: 'low' }, older)
    expect(f.call).toHaveBeenCalledTimes(1)
    expect(rememberedModelDefaults(f.host)?.choices.codex?.model).toBe('two')

    const second = fixture()
    const valid = beginModelChoice(second.host, 'codex')
    const failed = beginModelChoice(second.host, 'codex')
    failModelChoice(failed)
    rememberModelChoice(second.host, { providerId: 'codex', model: 'two', effort: 'high' }, valid)
    expect(second.call).toHaveBeenCalledTimes(1)
    expect(rememberedModelDefaults(second.host)?.choices.codex?.model).toBe('two')
  })

  it('defers an older configured choice while a newer Settings save is pending', async () => {
    const f = fixture()
    const old = beginModelChoice(f.host, 'codex')
    const saving = saveModelDefaults(f.host, { providerId: 'codex', model: 'three', effort: 'medium' })
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' }, old)
    expect(f.call).toHaveBeenCalledTimes(1)
    const receipt = f.acknowledge(0, false)
    await saving
    expect(f.call).toHaveBeenCalledTimes(1)
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual({ model: 'three', effort: 'medium' })
    f.publishReceipt(receipt)
    expect(rememberedModelDefaults(f.host)?.choices.codex).toEqual({ model: 'three', effort: 'medium' })
  })

  it('saves the older successful choice if a newer Settings save fails', async () => {
    const f = fixture()
    const old = beginModelChoice(f.host, 'codex')
    const saving = saveModelDefaults(f.host, { providerId: 'codex', model: 'three' })
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'high' }, old)
    expect(f.call).toHaveBeenCalledTimes(1)
    f.saves[0]!.reject(new Error('Disk full'))
    await expect(saving).rejects.toThrow('Disk full')
    expect(f.call).toHaveBeenCalledTimes(2)
    expect(f.saves[1]!.update).toMatchObject({ model: 'two', effort: 'high', selectProvider: false })
    f.acknowledge(1)
    await Promise.resolve()
  })

  it('retires an agent-only receipt without removing an unsent successful model choice', async () => {
    const f = fixture()
    const old = beginModelChoice(f.host, 'claude'), newer = beginModelChoice(f.host, 'claude')
    const expected = { model: 'older-valid', effort: 'high' }
    rememberModelChoice(f.host, { providerId: 'claude', ...expected }, old)
    expect(f.call).not.toHaveBeenCalled()
    expect(rememberedModelDefaults(f.host)?.choices.claude).toEqual(expected)

    const saving = saveModelDefaults(f.host, { providerId: 'claude' })
    f.acknowledge(0)
    await saving
    expect(rememberedModelDefaults(f.host)?.choices.claude).toEqual(expected)
    failModelChoice(newer)
    expect(f.call).toHaveBeenCalledTimes(2)
    expect(rememberedModelDefaults(f.host)?.choices.claude).toEqual(expected)
    f.acknowledge(1)
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)?.choices.claude).toEqual(expected)
  })

  it('drops failed saves without removing a newer pending choice', async () => {
    const f = fixture()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two', effort: 'medium' })
    rememberModelChoice(f.host, { providerId: 'claude', model: 'sonnet', effort: 'low' })
    f.saves[0]!.reject(new Error('Disk full'))
    await Promise.resolve()
    expect(rememberedModelDefaults(f.host)?.choices).toEqual({ codex: initial.choices.codex, claude: { model: 'sonnet', effort: 'low' } })
    expect(warning).toHaveBeenCalledOnce()
    f.acknowledge(1)
    await Promise.resolve()
  })

  it('expires unacknowledged local choices without timers or extra requests', () => {
    const f = fixture()
    rememberModelChoice(f.host, { providerId: 'codex', model: 'two' })
    expect(rememberedModelDefaults(f.host)?.choices.codex?.model).toBe('two')
    vi.advanceTimersByTime(30_001)
    expect(rememberedModelDefaults(f.host)).toEqual(initial)
    expect(vi.getTimerCount()).toBe(0)
    expect(f.call).toHaveBeenCalledTimes(1)
  })

  it('leaves installations without the defaults plugin untouched', () => {
    const call = vi.fn()
    const host = { call, snapshot: () => ({ snapshot: { extensions: {} } }) } as unknown as ClientHostService
    rememberModelChoice(host, { providerId: 'codex', model: 'two' })
    expect(rememberedModelDefaults(host)).toBeUndefined()
    expect(call).not.toHaveBeenCalled()
  })
})
