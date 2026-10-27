import type { JsonValue } from './protocol.js'

/**
 * A structural difference between two JSON values. Client extension states,
 * such as an agent chat transcript, are republished whole after each change.
 * Sending only their differences keeps a streaming reply from resending the
 * entire conversation for every few characters.
 *
 * - `r` replaces the value.
 * - `s` appends a suffix to a string.
 * - `o` patches object keys and deletes the keys listed in `d`.
 * - `a` resizes an array to length `a` and patches the listed indices.
 */
export type JsonPatch =
  | { r: JsonValue }
  | { s: string }
  | { o: Record<string, JsonPatch>; d?: string[] }
  | { a: number; i: Array<[number, JsonPatch]> }

type JsonObject = { [key: string]: JsonValue }

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns undefined when the values are structurally equal. */
export function diffJson(previous: JsonValue | undefined, next: JsonValue): JsonPatch | undefined {
  if (previous === next) return undefined
  if (typeof previous === 'string' && typeof next === 'string') {
    return next.length > previous.length && next.startsWith(previous)
      ? { s: next.slice(previous.length) }
      : { r: next }
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    const patches: Array<[number, JsonPatch]> = []
    for (let index = 0; index < next.length; index += 1) {
      const patch = index < previous.length
        ? diffJson(previous[index], next[index]!)
        : { r: next[index]! }
      if (patch) patches.push([index, patch])
    }
    return patches.length || previous.length !== next.length
      ? { a: next.length, i: patches }
      : undefined
  }
  if (isJsonObject(previous) && isJsonObject(next)) {
    const patches: Record<string, JsonPatch> = {}
    let changed = false
    for (const [key, value] of Object.entries(next)) {
      const patch = Object.hasOwn(previous, key) ? diffJson(previous[key], value) : { r: value }
      if (!patch) continue
      patches[key] = patch
      changed = true
    }
    const deleted = Object.keys(previous).filter((key) => !Object.hasOwn(next, key))
    if (!changed && !deleted.length) return undefined
    return deleted.length ? { o: patches, d: deleted } : { o: patches }
  }
  return { r: next }
}

/**
 * Applies a patch without mutating the current value. Unchanged branches keep
 * their identity, so memoized views of untouched items need not re-render.
 */
export function applyJsonPatch(current: JsonValue | undefined, patch: JsonPatch): JsonValue {
  if ('r' in patch) return patch.r
  if ('s' in patch) {
    if (typeof current !== 'string') throw new Error('string patch applied to a non-string value')
    return current + patch.s
  }
  if ('o' in patch) {
    if (!isJsonObject(current)) throw new Error('object patch applied to a non-object value')
    const next: JsonObject = { ...current }
    for (const [key, value] of Object.entries(patch.o)) next[key] = applyJsonPatch(current[key], value)
    for (const key of patch.d ?? []) delete next[key]
    return next
  }
  if (!Array.isArray(current)) throw new Error('array patch applied to a non-array value')
  const next = current.slice(0, patch.a)
  for (const [index, value] of patch.i) {
    if (index >= patch.a) throw new Error('array patch index is outside the array')
    next[index] = applyJsonPatch(current[index], value)
  }
  if (next.length !== patch.a) throw new Error('array patch left a gap')
  return next
}
