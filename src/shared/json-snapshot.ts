import type { JsonValue } from './protocol.js'

/**
 * Isolates mutable JSON input without serializing its strings. Equal branches
 * reuse the previous snapshot so streaming one item does not copy every saved
 * message or make socket patching revisit their contents. Optional undefined
 * object fields are omitted, as they are by JSON.stringify.
 */
export function snapshotJson(value: JsonValue, previous?: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value
  }
  if (Array.isArray(value)) {
    const before = Array.isArray(previous) ? previous : undefined
    let next = before?.length === value.length ? undefined : new Array<JsonValue>(value.length)
    for (let index = 0; index < value.length; index += 1) {
      const hadIndex = before !== undefined && Object.hasOwn(before, index)
      const previousItem = hadIndex ? before[index] : undefined
      const item = snapshotJson(value[index] ?? null, previousItem)
      if (!next && (!hadIndex || item !== previousItem)) next = before!.slice()
      if (next) next[index] = item
    }
    return next ?? before!
  }
  const before = previous !== null && typeof previous === 'object' && !Array.isArray(previous)
    ? previous : undefined
  let next: Record<string, JsonValue> | undefined = before ? undefined : {}
  let length = 0
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    length += 1
    const hadKey = before !== undefined && Object.hasOwn(before, key)
    const previousEntry = hadKey ? before[key] : undefined
    const item = snapshotJson(entry, previousEntry)
    if (!next && (!hadKey || item !== previousEntry)) next = { ...before }
    if (next) {
      // JSON keys can include __proto__; retain it as data on a plain object.
      if (key === '__proto__') Object.defineProperty(next, key, { value: item, enumerable: true, writable: true, configurable: true })
      else next[key] = item
    }
  }
  if (before && (next || Object.keys(before).length !== length)) {
    next ??= { ...before }
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) delete next[key]
    }
  }
  return next ?? before!
}
