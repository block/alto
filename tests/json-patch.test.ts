import { describe, expect, it } from 'vitest'
import { applyJsonPatch, diffJson } from '../src/shared/json-patch.js'
import type { JsonValue } from '../src/shared/protocol.js'

function roundTrip(previous: JsonValue, next: JsonValue): JsonValue | undefined {
  const patch = diffJson(previous, next)
  return patch ? applyJsonPatch(previous, patch) : previous
}

describe('json patch', () => {
  it('returns no patch for equal values', () => {
    expect(diffJson({ a: [1, 'x', { b: null }] }, { a: [1, 'x', { b: null }] })).toBeUndefined()
  })

  it('sends a streamed string as an appended suffix', () => {
    const previous = { items: [{ id: 'a', text: 'Hello' }] }
    const next = { items: [{ id: 'a', text: 'Hello, world' }] }
    expect(diffJson(previous, next)).toEqual({ o: { items: { a: 1, i: [[0, { o: { text: { s: ', world' } } }]] } } })
    expect(roundTrip(previous, next)).toEqual(next)
  })

  it('round-trips additions, deletions, truncation, and type changes', () => {
    const cases: Array<[JsonValue, JsonValue]> = [
      [{ a: 1, b: 2 }, { a: 1, c: 3 }],
      [[1, 2, 3], [1]],
      [[1], [1, { x: 'y' }]],
      ['abc', 'xbc'],
      [{ a: [1] }, { a: { b: 1 } }],
      [null, { a: 1 }],
      [{ a: 'text' }, { a: 7 }],
    ]
    for (const [previous, next] of cases) expect(roundTrip(previous, next)).toEqual(next)
  })

  it('preserves unchanged branches and does not mutate the input', () => {
    const untouched = { id: 'a', text: 'done' }
    const previous = { items: [untouched, { id: 'b', text: 'stre' }] }
    const frozen = JSON.stringify(previous)
    const next = applyJsonPatch(previous, diffJson(previous, { items: [untouched, { id: 'b', text: 'streaming' }] })!) as typeof previous
    expect(next.items[0]).toBe(untouched)
    expect(JSON.stringify(previous)).toBe(frozen)
  })

  it('rejects a patch that does not match the current value', () => {
    expect(() => applyJsonPatch(7, { s: 'x' })).toThrow()
    expect(() => applyJsonPatch({}, { a: 1, i: [] })).toThrow()
    expect(() => applyJsonPatch([], { a: 2, i: [[0, { r: 1 }]] })).toThrow()
  })
})
