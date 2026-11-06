import { describe, expect, it } from 'vitest'
import { snapshotJson } from '../src/shared/json-snapshot.js'
import type { JsonValue } from '../src/shared/protocol.js'

describe('JSON state snapshots', () => {
  it('isolates mutable input while sharing equal branches with the previous snapshot', () => {
    const value = { items: [{ text: 'Saved answer' }, { text: 'Stream' }], extra: { count: 2 } }
    const first = snapshotJson(value) as typeof value
    expect(first).toEqual(value)
    expect(first.items).not.toBe(value.items)
    expect(first.items[0]).not.toBe(value.items[0])
    value.items[1]!.text += 'ing'
    const second = snapshotJson(value, first) as typeof value
    expect(second.items[0]).toBe(first.items[0])
    expect(second.extra).toBe(first.extra)
    expect(second.items).not.toBe(first.items)
    expect(second.items[1]).not.toBe(value.items[1])
    expect(first.items[1]!.text).toBe('Stream')
    expect(second.items[1]!.text).toBe('Streaming')
    value.items[0]!.text = 'Changed after snapshot'
    expect(second.items[0]!.text).toBe('Saved answer')
    expect(snapshotJson(second, second)).toBe(second)
  })

  it('keeps additions, deletions, resized arrays, and type changes', () => {
    const cases: Array<[JsonValue, JsonValue]> = [
      [{ a: 1 }, { b: 2 }],
      [{ a: 1, b: 2 }, { a: 1 }],
      [[1, 2, 3], [1]],
      [[1], [1, { text: 'New' }]],
      [null, { a: [true, null] }],
      [{ a: [1] }, { a: { text: 'Replaced' } }],
    ]
    for (const [previous, next] of cases) {
      const before = JSON.stringify(previous)
      expect(snapshotJson(next, previous)).toEqual(next)
      expect(JSON.stringify(previous)).toBe(before)
    }
  })

  it('normalizes optional fields and array gaps the same way as JSON serialization', () => {
    const value = { title: 'Chat', removed: undefined, count: Number.NaN,
      items: [undefined, , { optional: undefined, n: Number.POSITIVE_INFINITY }] }
    const previous = { title: 'Chat', removed: 'Gone', count: 1, items: [] }
    expect(snapshotJson(value as unknown as JsonValue, previous)).toEqual(JSON.parse(JSON.stringify(value)))
  })

  it('retains prototype-like JSON keys as data', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}') as JsonValue
    const first = snapshotJson(value)
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype)
    expect(JSON.stringify(first)).toBe(JSON.stringify(value))
    expect(snapshotJson(value, first)).toBe(first)
    expect(snapshotJson({ safe: true }, first)).toEqual({ safe: true })
    expect(Object.hasOwn({}, 'polluted')).toBe(false)
  })

  it('isolates empty prototype-like keys added to an existing snapshot', () => {
    const previous = snapshotJson({ safe: true })
    const value = JSON.parse('{"safe":true,"__proto__":{},"constructor":{},"toString":{}}') as Record<string, JsonValue>
    const next = snapshotJson(value, previous) as typeof value
    expect(next.__proto__).not.toBe(Object.prototype)
    expect(next.__proto__).not.toBe(value.__proto__)
    expect(next.constructor).not.toBe(Object)
    expect(next.toString).not.toBe(Object.prototype.toString)
    const frozen = JSON.stringify(next)
    let after: string | undefined
    try {
      Object.defineProperty(Object.prototype, '__alto_snapshot_prototype_test__', { value: true, enumerable: true, configurable: true })
      after = JSON.stringify(next)
    } finally {
      Reflect.deleteProperty(Object.prototype, '__alto_snapshot_prototype_test__')
    }
    expect(after).toBe(frozen)
    expect(Object.keys(next.__proto__ as object)).toEqual([])
  })

  it('does not read inherited object fields or reuse inherited array entries', () => {
    const prototype = Object.create(null)
    for (const key of ['__proto__', 'constructor', 'toString']) {
      Object.defineProperty(prototype, key, { get: () => { throw new Error('Inherited field was read') } })
    }
    const previous = Object.assign(Object.create(prototype), { safe: true }) as JsonValue
    const value = JSON.parse('{"safe":true,"__proto__":{},"constructor":{},"toString":{}}') as JsonValue
    expect(snapshotJson(value, previous)).toEqual(value)

    const inherited = { text: 'Inherited' }
    const arrayPrototype = Object.assign(Object.create(Array.prototype), { 0: inherited })
    const array = new Array<JsonValue>(1)
    Object.setPrototypeOf(array, arrayPrototype)
    const copied = snapshotJson([{ text: 'Inherited' }], array) as JsonValue[]
    expect(copied[0]).toEqual(inherited)
    expect(copied[0]).not.toBe(inherited)
    expect(Object.hasOwn(copied, 0)).toBe(true)
  })
})
