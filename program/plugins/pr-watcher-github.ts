import { createHash } from 'node:crypto'
import type { ProcessRunnerService } from './process-runner-api.js'
import { isRecord } from '../../src/shared/protocol.js'

export type WatchScope = 'pr' | 'stack'
export type WatchCiState = 'pending' | 'passing' | 'failing' | 'unknown'

export interface WatchFeedback {
  id: string
  url: string
  author: string
  body: string
  updatedAt: string
}

export interface WatchPullRequest {
  number: number
  url: string
  title: string
  repository: string
  headRepository: string
  branch: string
  headSha: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  ci: WatchCiState
  ciFingerprint: string
  feedback: WatchFeedback[]
}

export interface WatchTarget {
  key: string
  label: string
  scope: WatchScope
  pullRequestUrl: string
  stackId?: string
  members: WatchPullRequest[]
}

export interface ExistingWatchTarget {
  key: string
  label: string
  scope: WatchScope
  pullRequestUrl: string
  members: Array<{ url: string }>
}

class StackMembershipUnavailable extends Error {}

interface PullRequestLocation { repository: string; number: number; url: string }
interface Page { nodes: unknown[]; cursor?: string }
type Graphql = (query: string, variables: Record<string, string | number>) => Promise<Record<string, unknown>>
const PAGE_SIZE = 100
const MAX_PAGES = 20
const MAX_STACK_MEMBERS = 100
const MAX_FEEDBACK_ITEMS = 10_000
const MAX_REQUESTS = 250

function repositoryName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u.test(value)
    || ['.', '..'].includes(value.split('/')[1] ?? '')) {
    throw new Error('GitHub returned an invalid repository identity')
  }
  return value.toLowerCase()
}

export function parsePullRequestUrl(value: string): PullRequestLocation {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a GitHub pull request URL') }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/u.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || !match) {
    throw new Error('Use an HTTPS github.com pull request URL')
  }
  const repository = repositoryName(`${match[1]}/${match[2]}`)
  const number = Number(match[3])
  if (!Number.isSafeInteger(number)) throw new Error('Pull request number is invalid')
  return { repository, number, url: `https://github.com/${repository}/pull/${number}` }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`GitHub returned incomplete ${label}`)
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`GitHub returned incomplete ${label}`)
  return value
}

function page(value: unknown, label: string): Page {
  const connection = record(value, label)
  const info = record(connection.pageInfo, `${label} pagination`)
  if (!Array.isArray(connection.nodes) || connection.nodes.length > PAGE_SIZE || typeof info.hasNextPage !== 'boolean') {
    throw new Error(`GitHub returned incomplete ${label}`)
  }
  return {
    nodes: connection.nodes,
    ...(info.hasNextPage ? { cursor: text(info.endCursor, `${label} pagination cursor`) } : {}),
  }
}

async function collectPages(first: unknown, label: string, next: (cursor: string) => Promise<unknown>): Promise<unknown[]> {
  let current = page(first, label)
  const result = [...current.nodes]
  const cursors = new Set<string>()
  for (let count = 1; current.cursor; count += 1) {
    if (count >= MAX_PAGES || cursors.has(current.cursor)) {
      throw new Error(`${label} is incomplete: GitHub pagination exceeded the watch limit`)
    }
    cursors.add(current.cursor)
    current = page(await next(current.cursor), label)
    result.push(...current.nodes)
  }
  return result
}

const CI_FIELDS = `
  __typename
  ... on CheckRun { id name status conclusion startedAt completedAt }
  ... on StatusContext { id context state createdAt }
`
const PR_FIELDS = `
  id number url title state headRefName headRefOid
  repository { nameWithOwner }
  headRepository { nameWithOwner }
  statusCheckRollup {
    state
    contexts(first: ${PAGE_SIZE}) {
      nodes { ${CI_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`
const FEEDBACK_FIELDS = 'id url body updatedAt author { login }'
const THREAD_FIELDS = `id isResolved comments(first: ${PAGE_SIZE}) {
  nodes { ${FEEDBACK_FIELDS} }
  pageInfo { hasNextPage endCursor }
}`

function targetQuery(scope: WatchScope): string {
  return `query AltoWatchTarget($owner: String!, $name: String!, $number: Int!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        ${PR_FIELDS}
        ${scope === 'stack' ? `stack {
          id number size
          entries(first: ${MAX_STACK_MEMBERS}) {
            nodes { position pullRequest { ${PR_FIELDS} } }
            pageInfo { hasNextPage endCursor }
          }
        }` : ''}
      }
    }
  }`
}

function queryClient(runner: ProcessRunnerService, signal: AbortSignal): Graphql {
  let requests = 0
  return async (query, variables) => {
    signal.throwIfAborted()
    if (++requests > MAX_REQUESTS) throw new Error('Watch data is incomplete: GitHub request limit exceeded')
    const args = ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${query}`]
    for (const [name, value] of Object.entries(variables)) {
      args.push(typeof value === 'number' ? '-F' : '-f', `${name}=${value}`)
    }
    const { stdout } = await runner.execFile('gh', args, {
      signal,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' },
    })
    signal.throwIfAborted()
    const response = record(JSON.parse(stdout) as unknown, 'GraphQL response')
    if (Array.isArray(response.errors) && response.errors.length) {
      throw new Error('GitHub could not return complete watch data')
    }
    return record(response.data, 'GraphQL response data')
  }
}

function checkedBranch(value: unknown): string {
  const branch = text(value, 'head branch')
  if (branch.length > 1_024 || /[\x00-\x20\x7f~^:?*\[\\]/u.test(branch)
    || branch.startsWith('-') || branch === '@' || branch.includes('..') || branch.includes('@{')
    || branch.endsWith('.') || branch.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('GitHub returned an invalid head branch')
  }
  return branch
}

function ciState(value: unknown): WatchCiState {
  if (value === 'FAILURE' || value === 'ERROR') return 'failing'
  if (value === 'PENDING' || value === 'EXPECTED') return 'pending'
  if (value === 'SUCCESS') return 'passing'
  return 'unknown'
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readCi(pr: Record<string, unknown>, query: Graphql): Promise<{ ci: WatchCiState; ciFingerprint: string }> {
  const headSha = text(pr.headRefOid, 'head SHA')
  if (pr.statusCheckRollup === null) return { ci: 'unknown', ciFingerprint: digest([headSha, 'unknown']) }
  const rollup = record(pr.statusCheckRollup, 'CI rollup')
  const ci = ciState(rollup.state)
  const checks = await collectPages(rollup.contexts, 'CI checks', async (cursor) => {
    const data = await query(`query AltoWatchChecks($id: ID!, $cursor: String!) {
      node(id: $id) { ... on PullRequest {
        headRefOid
        statusCheckRollup { contexts(first: ${PAGE_SIZE}, after: $cursor) {
          nodes { ${CI_FIELDS} }
          pageInfo { hasNextPage endCursor }
        } }
      } }
    }`, { id: text(pr.id, 'PR node ID'), cursor })
    const node = record(data.node, 'PR check page')
    if (node.headRefOid !== headSha) throw new Error('PR head changed while reading CI; retry the watch poll')
    return record(node.statusCheckRollup, 'CI rollup page').contexts
  })
  // Other jobs completing must not reset the retry budget for the same failing job.
  const failures = checks.flatMap((value) => {
    const check = record(value, 'CI check')
    const failing = check.__typename === 'CheckRun'
      ? ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(String(check.conclusion))
      : ciState(check.state) === 'failing'
    if (!failing) return []
    return [[text(check.id, 'CI check ID'), check.status ?? check.state, check.conclusion ?? '',
      check.startedAt ?? check.createdAt ?? '', check.completedAt ?? '']]
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return { ci, ciFingerprint: digest([headSha, ci, failures]) }
}

function feedback(value: unknown, viewer: string): WatchFeedback | undefined {
  const item = record(value, 'feedback')
  const body = typeof item.body === 'string' ? item.body : undefined
  if (body === undefined) throw new Error('GitHub returned incomplete feedback text')
  const author = item.author === null ? 'ghost' : text(record(item.author, 'feedback author').login, 'feedback author')
  if (!body.trim() || author.toLowerCase() === viewer.toLowerCase() || item.state === 'PENDING') return undefined
  const id = text(item.id, 'feedback ID')
  const updatedAt = text(item.updatedAt, 'feedback update time')
  return {
    id: `${id}:${digest([updatedAt, body])}`,
    url: text(item.url, 'feedback URL'),
    author,
    body,
    updatedAt,
  }
}

async function readFeedback(prId: string, viewer: string, query: Graphql): Promise<WatchFeedback[]> {
  const initial = await query(`query AltoWatchFeedback($id: ID!) {
    node(id: $id) { ... on PullRequest {
      comments(first: ${PAGE_SIZE}) { nodes { ${FEEDBACK_FIELDS} } pageInfo { hasNextPage endCursor } }
      reviews(first: ${PAGE_SIZE}) { nodes { ${FEEDBACK_FIELDS} state } pageInfo { hasNextPage endCursor } }
      reviewThreads(first: ${PAGE_SIZE}) { nodes { ${THREAD_FIELDS} } pageInfo { hasNextPage endCursor } }
    } }
  }`, { id: prId })
  const node = record(initial.node, 'PR feedback')
  const readConnection = (field: 'comments' | 'reviews' | 'reviewThreads') => collectPages(node[field], field, async (cursor) => {
    const fields = field === 'reviewThreads' ? THREAD_FIELDS : `${FEEDBACK_FIELDS}${field === 'reviews' ? ' state' : ''}`
    const data = await query(`query AltoWatchFeedbackPage($id: ID!, $cursor: String!) {
      node(id: $id) { ... on PullRequest {
        ${field}(first: ${PAGE_SIZE}, after: $cursor) { nodes { ${fields} } pageInfo { hasNextPage endCursor } }
      } }
    }`, { id: prId, cursor })
    return record(data.node, 'PR feedback page')[field]
  })
  const [comments, reviews, threads] = await Promise.all([
    readConnection('comments'), readConnection('reviews'), readConnection('reviewThreads'),
  ])
  const all = [...comments, ...reviews]
  for (const value of threads) {
    const thread = record(value, 'review thread')
    if (typeof thread.isResolved !== 'boolean') throw new Error('GitHub returned incomplete review thread state')
    if (thread.isResolved) continue
    const threadComments = await collectPages(thread.comments, 'review thread comments', async (cursor) => {
      const data = await query(`query AltoWatchThreadComments($id: ID!, $cursor: String!) {
        node(id: $id) { ... on PullRequestReviewThread {
          comments(first: ${PAGE_SIZE}, after: $cursor) { nodes { ${FEEDBACK_FIELDS} } pageInfo { hasNextPage endCursor } }
        } }
      }`, { id: text(thread.id, 'review thread ID'), cursor })
      return record(data.node, 'review thread page').comments
    })
    if (all.length + threadComments.length > MAX_FEEDBACK_ITEMS) {
      throw new Error('Feedback is incomplete: more than 10000 items cannot be watched')
    }
    all.push(...threadComments)
  }
  const result = new Map<string, WatchFeedback>()
  for (const value of all) {
    const parsed = feedback(value, viewer)
    if (parsed) result.set(parsed.id, parsed)
  }
  return [...result.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
}

async function readMember(value: unknown, repository: string, viewer: string, query: Graphql): Promise<WatchPullRequest> {
  const pr = record(value, 'pull request')
  const location = parsePullRequestUrl(text(pr.url, 'pull request URL'))
  const actualRepository = repositoryName(record(pr.repository, 'pull request repository').nameWithOwner)
  if (location.repository !== repository || actualRepository !== repository || location.number !== pr.number) {
    throw new Error('GitHub returned a different pull request identity')
  }
  if (pr.state !== 'OPEN' && pr.state !== 'CLOSED' && pr.state !== 'MERGED') throw new Error('GitHub returned an invalid PR state')
  const identity = { number: location.number, url: location.url, title: text(pr.title, 'PR title'), repository }
  if (pr.state !== 'OPEN') {
    // Deleted forks and refs are normal after closure. Terminal members cannot be repair targets.
    const headRepository = pr.headRepository == null ? repository
      : repositoryName(record(pr.headRepository, 'pull request head repository').nameWithOwner)
    const headSha = typeof pr.headRefOid === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(pr.headRefOid)
      ? pr.headRefOid : ''
    let branch = ''
    if (typeof pr.headRefName === 'string' && pr.headRefName) {
      try { branch = checkedBranch(pr.headRefName) } catch { /* Only a display hint for terminal members. */ }
    }
    return {
      ...identity, headRepository, branch, headSha, state: pr.state,
      ci: 'unknown', ciFingerprint: digest([headSha, pr.state]), feedback: [],
    }
  }
  const headRepository = repositoryName(record(pr.headRepository, 'pull request head repository').nameWithOwner)
  const headSha = text(pr.headRefOid, 'head SHA')
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(headSha)) throw new Error('GitHub returned an invalid head SHA')
  const branch = checkedBranch(pr.headRefName)
  const [ci, feedback] = await Promise.all([
    readCi(pr, query),
    readFeedback(text(pr.id, 'PR node ID'), viewer, query),
  ])
  return {
    ...identity, headRepository, branch, headSha, state: pr.state,
    ...ci, feedback,
  }
}

async function readTargetWithQuery(
  url: string,
  scope: WatchScope,
  query: Graphql,
  expectedStackKey?: string,
): Promise<WatchTarget> {
  const location = parsePullRequestUrl(url)
  if (scope !== 'pr' && scope !== 'stack') throw new Error('Watch scope is invalid')
  const [owner, name] = location.repository.split('/') as [string, string]
  const data = await query(targetQuery(scope), { owner, name, number: location.number })
  const viewer = text(record(data.viewer, 'authenticated viewer').login, 'authenticated viewer')
  const pr = record(record(data.repository, 'repository').pullRequest, 'pull request')
  if (parsePullRequestUrl(text(pr.url, 'PR URL')).url !== location.url || pr.number !== location.number) {
    throw new Error('GitHub returned a different pull request identity')
  }
  if (scope === 'pr') {
    const member = await readMember(pr, location.repository, viewer, query)
    if (member.number !== location.number) throw new Error('GitHub returned a different pull request')
    return { key: `pr:${member.url}`, label: `${location.repository} #${member.number}`, scope, pullRequestUrl: member.url, members: [member] }
  }
  if (pr.stack === null) throw new StackMembershipUnavailable('This PR no longer belongs to a native GitHub stack')
  const stack = record(pr.stack, 'native GitHub stack')
  const stackId = text(stack.id, 'stack ID')
  const key = `stack:${location.repository}:${stackId}`
  if (expectedStackKey && key !== expectedStackKey) throw new Error('This PR belongs to a different native GitHub stack')
  if (!Number.isSafeInteger(stack.number) || Number(stack.number) < 1 || !Number.isSafeInteger(stack.size) || Number(stack.size) < 1) {
    throw new Error('GitHub returned incomplete stack identity')
  }
  const entries = page(stack.entries, 'stack entries')
  if (entries.cursor || Number(stack.size) > MAX_STACK_MEMBERS) throw new Error('Stack is incomplete: more than 100 members cannot be watched')
  if (entries.nodes.length !== stack.size) throw new Error('GitHub returned incomplete stack membership')
  const ordered = entries.nodes.map((entry) => record(entry, 'stack entry')).sort((a, b) => Number(a.position) - Number(b.position))
  if (!ordered.some((entry) => isRecord(entry.pullRequest) && entry.pullRequest.number === location.number)) {
    throw new StackMembershipUnavailable('The requested PR is no longer in this GitHub stack')
  }
  const members: WatchPullRequest[] = []
  const numbers = new Set<number>()
  const positions = new Set<number>()
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]!
    if (!Number.isSafeInteger(entry.position) || Number(entry.position) < 1 || positions.has(Number(entry.position))) {
      throw new Error('GitHub returned invalid stack positions')
    }
    positions.add(Number(entry.position))
    const member = await readMember(entry.pullRequest, location.repository, viewer, query)
    if (member.headRepository !== location.repository || numbers.has(member.number)) throw new Error('GitHub returned an invalid stack member identity')
    numbers.add(member.number)
    members.push(member)
  }
  return {
    key,
    label: `${location.repository} stack #${stack.number}`,
    scope, pullRequestUrl: location.url, stackId, members,
  }
}

export async function readWatchTarget(
  url: string,
  scope: WatchScope,
  runner: ProcessRunnerService,
  signal: AbortSignal,
): Promise<WatchTarget> {
  return readTargetWithQuery(url, scope, queryClient(runner, signal))
}

export async function readExistingWatchTarget(
  watch: ExistingWatchTarget,
  runner: ProcessRunnerService,
  signal: AbortSignal,
): Promise<WatchTarget> {
  // Share one request budget across reanchoring and terminal-state checks.
  const query = queryClient(runner, signal)
  if (watch.scope !== 'stack') return readTargetWithQuery(watch.pullRequestUrl, watch.scope, query)
  const anchor = parsePullRequestUrl(watch.pullRequestUrl)
  const candidates = [...new Set([anchor.url, ...watch.members.map((member) => {
    const location = parsePullRequestUrl(member.url)
    if (location.repository !== anchor.repository) throw new Error('Saved stack members belong to a different repository')
    return location.url
  })])]
  if (candidates.length > MAX_STACK_MEMBERS) throw new Error('Saved stack membership exceeds the watch limit')
  for (const url of candidates) {
    try {
      return await readTargetWithQuery(url, 'stack', query, watch.key)
    } catch (error) {
      // Schema, authentication, network, and rate-limit errors must not fan out into more reads.
      if (!(error instanceof StackMembershipUnavailable)) throw error
    }
  }
  const members: WatchPullRequest[] = []
  for (const url of candidates) {
    const target = await readTargetWithQuery(url, 'pr', query)
    const member = target.members[0]!
    if (member.state === 'OPEN') throw new Error('The native GitHub stack is gone but a saved member is still open')
    members.push(member)
  }
  return {
    key: watch.key, label: watch.label, scope: 'stack',
    pullRequestUrl: anchor.url, members,
  }
}
