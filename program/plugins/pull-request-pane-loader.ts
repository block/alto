import type { ClientHostService } from '../../src/client/plugin-api.js'
import type { JsonValue } from '../../src/shared/protocol.js'
import { parseDiffReviewDocument, type DiffReviewDocument } from './diff-viewer-api.js'
import { PULL_REQUEST_DIFF_METHOD, PULL_REQUEST_READ_METHOD, parsePullRequestDetails, parsePullRequestReference, type PullRequestDetails } from './pull-request-pane-api.js'

/** Restored panes can mount before the browser acknowledges a new program. */
export async function callPullRequestRead(host: Pick<ClientHostService, 'call'>, method: string, payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
  const delays = [100, 200, 400, 800, 1600, 3200]
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try {
      const value = await host.call(method, payload)
      signal.throwIfAborted()
      return value
    } catch (error) {
      signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      const delay = delays[attempt]
      if (delay === undefined || !/^browser program revision (?:unknown|\d+) is incompatible with server revision \d+$/u.test(message)) throw error
      await new Promise<void>((resolve, reject) => {
        const cancel = (): void => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, delay)
        signal.addEventListener('abort', cancel, { once: true })
      })
    }
  }
}

export function pullRequestRevision(details: Pick<PullRequestDetails, 'headSha' | 'baseSha' | 'baseBranch'>): string {
  return JSON.stringify([details.headSha, details.baseSha, details.baseBranch])
}

interface Patch {
  resource: string
  workspace: string
  revision: string | undefined
  provisional: boolean
  invalidated: boolean
  users: number
  complete: boolean
  failed: boolean
  document: DiffReviewDocument | undefined
  startedAt: number
  fetchedAt: number
  promise: Promise<Patch>
}

interface ActiveResource {
  users: number
  details: PullRequestDetails | undefined
  revisions: Set<string>
  patches: Map<string, Patch>
}

type CachedValue =
  | { kind: 'details'; resource: string; value: PullRequestDetails; fetchedAt: number; bytes: number }
  | { kind: 'diff'; resource: string; value: Patch; bytes: number }

export interface PullRequestCachedView {
  details?: PullRequestDetails | undefined
  diff?: DiffReviewDocument | undefined
  diffRevision?: string | undefined
}

export type PullRequestLoadMode = 'open' | 'metadata' | 'refresh' | 'diff'

export interface PullRequestLoadedDiff {
  document: DiffReviewDocument
  revision: string | undefined
  details: PullRequestDetails | undefined
}

/** One plugin installation owns this cache and its pending revision retries. */
export class PullRequestPaneLoader {
  private readonly values = new Map<string, CachedValue>()
  private readonly reads = new Map<string, Promise<PullRequestDetails>>()
  private readonly diffs = new Map<string, Patch>()
  private readonly active = new Map<string, ActiveResource>()
  private readonly controller = new AbortController()
  private patchBytes = 0
  private readonly now: () => number
  private readonly freshFor: number
  private readonly maxEntries: number
  private readonly maxPatchBytes: number

  constructor(private readonly host: Pick<ClientHostService, 'call'>, options: {
    now?: () => number
    freshFor?: number
    maxEntries?: number
    maxPatchBytes?: number
  } = {}) {
    this.now = options.now ?? (() => Date.now())
    this.freshFor = options.freshFor ?? 15_000
    this.maxEntries = options.maxEntries ?? 24
    this.maxPatchBytes = options.maxPatchBytes ?? 24 * 1024 * 1024
  }

  peek(resource: string, workspace = ''): PullRequestCachedView {
    const url = parsePullRequestReference(resource).url
    const details = this.get(`details:${url}`)
    const patch = this.get(this.diffKey(url, workspace))
    return {
      details: details?.kind === 'details' ? details.value : undefined,
      diff: patch?.kind === 'diff' && !patch.value.invalidated ? patch.value.document : undefined,
      diffRevision: patch?.kind === 'diff' ? patch.value.revision : undefined,
    }
  }

  load(resource: string, workspace = '', mode: PullRequestLoadMode = 'open', knownDetails?: PullRequestDetails): {
    details: Promise<PullRequestDetails | undefined>
    diff: Promise<PullRequestLoadedDiff>
  } {
    this.controller.signal.throwIfAborted()
    const url = parsePullRequestReference(resource).url
    const cached = this.peek(url, workspace)
    const previous = cached.details ?? (knownDetails?.url === url ? knownDetails : undefined)
    const active = this.active.get(url) ?? { users: 0, details: undefined, revisions: new Set<string>(), patches: new Map<string, Patch>() }
    this.active.set(url, active)
    active.users++
    if (previous) {
      const revision = pullRequestRevision(previous)
      // A later consumer can advance the shared observation, but an older
      // consumer must not switch it back while its obsolete request settles.
      if (!active.revisions.has(revision)) { active.details = previous; active.revisions.add(revision) }
    }
    const details = mode === 'diff' ? Promise.resolve(active.details) : this.read(url, mode !== 'open')
    const held = new Set<Patch>()
    const retain = (patch: Patch): Patch => {
      if (!held.has(patch)) { held.add(patch); patch.users++ }
      return patch
    }
    // Start both network requests now; metadata must not delay the patch download.
    const firstPatch = retain(this.patch(url, workspace, mode === 'refresh' || mode === 'diff', active.details))
    const outcome = firstPatch.promise.then(value => ({ value }), error => ({ error }))
    const diff = details.catch(() => previous).then(async latest => {
      let request = firstPatch
      for (;;) {
        this.controller.signal.throwIfAborted()
        const current = active.details ?? this.peek(url, workspace).details ?? latest
        const revision = current ? pullRequestRevision(current) : undefined
        if (request.invalidated || (revision !== undefined && request.revision !== revision)) {
          // The endpoint is unversioned. A patch started before a known revision
          // change cannot be relabeled with the new head/base, even if it is ready.
          const selected = active.patches.get(workspace)
          request = retain(selected && !selected.invalidated && selected.revision === revision
            ? selected : this.patch(url, workspace, true, current))
          latest = current
        }
        const result = request === firstPatch ? await outcome : await request.promise.then(value => ({ value }), error => ({ error }))
        const observed = active.details ?? this.peek(url, workspace).details ?? latest
        if (request.invalidated || (observed && request.revision !== pullRequestRevision(observed))) continue
        if ('error' in result) throw result.error
        return { document: result.value.document!, revision: request.revision, details: observed }
      }
    }).finally(() => {
      for (const patch of held) { patch.users--; this.release(patch) }
      active.users--
      if (active.users === 0 && this.active.get(url) === active) this.active.delete(url)
    })
    return { details, diff }
  }

  dispose(): void {
    this.controller.abort()
    this.values.clear()
    this.reads.clear()
    this.diffs.clear()
    this.active.clear()
    this.patchBytes = 0
  }

  private read(resource: string, force: boolean): Promise<PullRequestDetails> {
    const pending = this.reads.get(resource)
    if (pending) return pending
    const cached = this.get(`details:${resource}`)
    if (!force && cached?.kind === 'details' && this.now() - cached.fetchedAt < this.freshFor) return Promise.resolve(cached.value)
    const request = callPullRequestRead(this.host, PULL_REQUEST_READ_METHOD, { resource }, this.controller.signal).then(value => {
      const details = parsePullRequestDetails(value)
      if (details.url !== resource) throw new Error('Alto returned a different pull request')
      this.observe(details)
      this.put(`details:${resource}`, { kind: 'details', resource, value: details, fetchedAt: this.now(), bytes: 0 })
      return details
    }).finally(() => { if (this.reads.get(resource) === request) this.reads.delete(resource) })
    this.reads.set(resource, request)
    return request
  }

  private patch(resource: string, workspace: string, force: boolean, details: PullRequestDetails | undefined): Patch {
    this.controller.signal.throwIfAborted()
    const key = this.diffKey(resource, workspace)
    const pending = this.diffs.get(key)
    const revision = details ? pullRequestRevision(details) : undefined
    if (pending && !pending.invalidated) {
      if (revision === undefined || pending.revision === revision) return pending
      pending.invalidated = true
    }
    const cached = this.get(key)
    if (!force && cached?.kind === 'diff' && !cached.value.invalidated
      && (revision === undefined || cached.value.revision === revision)
      && (!cached.value.provisional || this.now() - cached.value.startedAt < this.freshFor)) {
      this.active.get(resource)?.patches.set(workspace, cached.value)
      return cached.value
    }
    const request: Patch = {
      resource, workspace, revision,
      provisional: !details, invalidated: false, users: 0, complete: false, failed: false, document: undefined, startedAt: this.now(), fetchedAt: 0,
      promise: callPullRequestRead(this.host, PULL_REQUEST_DIFF_METHOD, { resource, workspace }, this.controller.signal).then(value => {
        const document = parseDiffReviewDocument(value)
        if (document.workspace !== workspace) throw new Error('Alto returned a different review workspace')
        request.document = document
        request.fetchedAt = this.now()
        if (!request.invalidated) this.put(key, { kind: 'diff', resource, value: request, bytes: new TextEncoder().encode(document.patch).byteLength })
        return request
      }).catch(error => { request.failed = true; throw error }).finally(() => { request.complete = true; this.release(request) }),
    }
    this.diffs.set(key, request)
    this.active.get(resource)?.patches.set(workspace, request)
    return request
  }

  private observe(details: PullRequestDetails): void {
    const revision = pullRequestRevision(details)
    const previous = this.get(`details:${details.url}`)
    const active = this.active.get(details.url)
    if (active) { active.details = details; active.revisions.add(revision) }
    const patches = new Set([
      ...Array.from(this.values.values()).flatMap(value => value.kind === 'diff' && value.resource === details.url ? [value.value] : []),
      ...Array.from(this.diffs.values()).filter(value => value.resource === details.url),
      ...(active?.patches.values() ?? []),
    ])
    const previousRevision = previous?.kind === 'details' ? pullRequestRevision(previous.value) : Array.from(patches).find(patch => !patch.invalidated && patch.revision !== undefined)?.revision
    const changed = previousRevision !== undefined && previousRevision !== revision
    for (const patch of patches) {
      // Recording the first observation supports later invalidation. It cannot
      // prove which revision an unversioned parallel download contains, so the
      // provisional flag and short lifetime remain until a subsequent fetch.
      if (patch.revision === undefined && !changed && (patch.users > 0 || this.now() - patch.startedAt < this.freshFor)) patch.revision = revision
      else if (patch.revision !== revision) patch.invalidated = true
      if (patch.invalidated) {
        const key = this.diffKey(patch.resource, patch.workspace)
        if (this.values.get(key)?.kind === 'diff' && this.values.get(key)?.value === patch) this.remove(key)
      }
    }
  }

  private diffKey(resource: string, workspace: string): string { return `diff:${JSON.stringify([resource, workspace])}` }

  private release(patch: Patch): void {
    const key = this.diffKey(patch.resource, patch.workspace)
    if (patch.complete && (patch.failed || patch.users === 0) && this.diffs.get(key) === patch) this.diffs.delete(key)
  }

  private get(key: string): CachedValue | undefined {
    const value = this.values.get(key)
    if (value) { this.values.delete(key); this.values.set(key, value) }
    return value
  }

  private put(key: string, value: CachedValue): void {
    this.remove(key)
    if (value.bytes > this.maxPatchBytes) return
    this.values.set(key, value)
    this.patchBytes += value.bytes
    while (this.values.size > this.maxEntries || this.patchBytes > this.maxPatchBytes) this.remove(this.values.keys().next().value!)
  }

  private remove(key: string): void {
    this.patchBytes -= this.values.get(key)?.bytes ?? 0
    this.values.delete(key)
  }
}
