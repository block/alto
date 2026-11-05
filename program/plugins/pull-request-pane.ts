import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import type { DiffReviewDocument } from './diff-viewer-api.js'
import type { ProcessRunnerService } from './process-runner-api.js'
import {
  parsePullRequestReference,
  PULL_REQUEST_DIFF_METHOD,
  PULL_REQUEST_READ_METHOD,
  type PullRequestAuthor,
  type PullRequestComment,
  type PullRequestDetails,
  type PullRequestReference,
} from './pull-request-pane-api.js'

const MAX_DIFF_BYTES = 20 * 1024 * 1024
const COMMENT_FIELDS = 'id body createdAt url author { login url }'
export const PULL_REQUEST_DETAILS_QUERY = `query AltoPullRequestPane($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title url state isDraft body createdAt updatedAt headRefName baseRefName headRefOid baseRefOid
      mergeable mergeStateStatus reviewDecision additions deletions changedFiles
      author { login url } repository { nameWithOwner } headRepository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup {
        state contexts(first: 50) {
          nodes {
            __typename
            ... on CheckRun { id name status conclusion detailsUrl }
            ... on StatusContext { id context state targetUrl }
          }
          pageInfo { hasNextPage }
        }
      } } } }
      comments(last: 30) { nodes { ${COMMENT_FIELDS} } pageInfo { hasPreviousPage } }
      reviewThreads(first: 30) {
        nodes {
          id path line isResolved isOutdated
          comments(first: 10) { nodes { ${COMMENT_FIELDS} } pageInfo { hasNextPage } }
        }
        pageInfo { hasNextPage }
      }
    }
  }
}`

const identity = z.object({ nameWithOwner: z.string() })
const authorSchema = z.object({ login: z.string(), url: z.string() })
const commentSchema = z.object({ id: z.string(), body: z.string(), createdAt: z.string().datetime(), url: z.string(), author: authorSchema.nullable() })
const nextPage = z.object({ hasNextPage: z.boolean() })
const previousPage = z.object({ hasPreviousPage: z.boolean() })
const checkSchema = z.discriminatedUnion('__typename', [
  z.object({ __typename: z.literal('CheckRun'), id: z.string(), name: z.string(), status: z.string(), conclusion: z.string().nullable(), detailsUrl: z.string().nullable() }),
  z.object({ __typename: z.literal('StatusContext'), id: z.string(), context: z.string(), state: z.string(), targetUrl: z.string().nullable() }),
])
const pullRequestSchema = z.object({
  id: z.string(), number: z.number().int().positive(), title: z.string(), url: z.string(), state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(), body: z.string(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  headRefName: z.string().nullable(), baseRefName: z.string(), headRefOid: z.string().nullable(), baseRefOid: z.string(),
  mergeable: z.string(), mergeStateStatus: z.string(), reviewDecision: z.string().nullable(),
  additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), changedFiles: z.number().int().nonnegative(),
  author: authorSchema.nullable(), repository: identity, headRepository: identity.nullable(),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({
    state: z.string(), contexts: z.object({ nodes: z.array(checkSchema).max(50), pageInfo: nextPage }),
  }).nullable() }) })).max(1) }),
  comments: z.object({ nodes: z.array(commentSchema).max(30), pageInfo: previousPage }),
  reviewThreads: z.object({ nodes: z.array(z.object({
    id: z.string(), path: z.string(), line: z.number().int().positive().nullable(), isResolved: z.boolean(), isOutdated: z.boolean(),
    comments: z.object({ nodes: z.array(commentSchema).max(10), pageInfo: nextPage }),
  })).max(30), pageInfo: nextPage }),
})

function safeUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function author(value: z.infer<typeof authorSchema> | null): PullRequestAuthor | null {
  return value ? { login: value.login, url: safeUrl(value.url) ?? 'https://github.com' } : null
}

function comment(value: z.infer<typeof commentSchema>, fallback: string): PullRequestComment {
  return { ...value, author: author(value.author), url: safeUrl(value.url) ?? fallback }
}

async function gh(runner: ProcessRunnerService, args: string[], signal: AbortSignal, maxBuffer = 8 * 1024 * 1024): Promise<string> {
  signal.throwIfAborted()
  try {
    const { stdout } = await runner.execFile('gh', args, {
      signal, timeout: 30_000, maxBuffer,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', GH_PAGER: 'cat' },
    })
    signal.throwIfAborted()
    return stdout
  } catch (error) {
    signal.throwIfAborted()
    if (isRecord(error) && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new Error(`GitHub response exceeds the ${Math.floor(maxBuffer / 1024 / 1024)} MB limit. Open this pull request on GitHub.`)
    }
    throw new Error('Could not load GitHub. Check your connection, gh auth status --hostname github.com, and repository access.')
  }
}

async function graphql(reference: PullRequestReference, runner: ProcessRunnerService, signal: AbortSignal): Promise<z.infer<typeof pullRequestSchema>> {
  const [owner = '', name = ''] = reference.repository.split('/')
  const stdout = await gh(runner, ['api', 'graphql', '--hostname', 'github.com',
    '-f', `query=${PULL_REQUEST_DETAILS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${reference.number}`], signal)
  let value: unknown
  try { value = JSON.parse(stdout) as unknown } catch { throw new Error('GitHub returned an invalid response') }
  if (!isRecord(value) || (Array.isArray(value.errors) && value.errors.length)) throw new Error('GitHub returned incomplete pull request data')
  const result = z.object({ data: z.object({ repository: z.object({ pullRequest: pullRequestSchema.nullable() }).nullable() }) }).safeParse(value)
  if (!result.success) throw new Error('GitHub returned incomplete pull request data')
  const pr = result.data.data.repository?.pullRequest
  if (!pr) throw new Error('This pull request is unavailable. Check its URL and your GitHub access.')
  if (pr.repository.nameWithOwner.toLowerCase() !== reference.repository || pr.number !== reference.number
    || parsePullRequestReference(pr.url).url !== reference.url) throw new Error('GitHub returned a different pull request')
  return pr
}

export async function readPullRequestDetails(resource: string, runner: ProcessRunnerService, signal: AbortSignal): Promise<PullRequestDetails> {
  const reference = parsePullRequestReference(resource)
  const pr = await graphql(reference, runner, signal)
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup
  const threads = pr.reviewThreads.nodes.map((thread) => ({
    ...thread, url: safeUrl(thread.comments.nodes[0]?.url ?? null) ?? reference.url,
    comments: thread.comments.nodes.map((entry) => comment(entry, reference.url)), moreComments: thread.comments.pageInfo.hasNextPage,
  }))
  return {
    id: pr.id, number: pr.number, title: pr.title, url: reference.url, repository: reference.repository,
    headRepository: pr.headRepository?.nameWithOwner ?? null, branch: pr.headRefName ?? '', baseBranch: pr.baseRefName,
    draft: pr.isDraft, createdAt: pr.createdAt, updatedAt: pr.updatedAt, review: pr.reviewDecision, checks: rollup?.state ?? null,
    mergeable: pr.mergeable, mergeState: pr.mergeStateStatus, unresolvedThreads: threads.filter((thread) => !thread.isResolved).length,
    moreThreads: pr.reviewThreads.pageInfo.hasNextPage, description: pr.body, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles,
    state: pr.state, author: author(pr.author), body: pr.body, headSha: pr.headRefOid ?? '', baseSha: pr.baseRefOid,
    checksList: (rollup?.contexts.nodes ?? []).map((check) => check.__typename === 'CheckRun'
      ? { id: check.id, name: check.name, status: check.status, conclusion: check.conclusion, url: safeUrl(check.detailsUrl) }
      : { id: check.id, name: check.context, status: ['SUCCESS', 'FAILURE', 'ERROR'].includes(check.state) ? 'COMPLETED' : 'PENDING', conclusion: check.state, url: safeUrl(check.targetUrl) }),
    moreChecks: rollup?.contexts.pageInfo.hasNextPage ?? false,
    comments: pr.comments.nodes.map((entry) => comment(entry, reference.url)), moreComments: pr.comments.pageInfo.hasPreviousPage, threads,
  }
}

export async function readPullRequestDiff(resource: string, runner: ProcessRunnerService, signal: AbortSignal, workspace = ''): Promise<DiffReviewDocument> {
  const reference = parsePullRequestReference(resource)
  const patch = await gh(runner, ['api', '--hostname', 'github.com', `repos/${reference.repository}/pulls/${reference.number}`,
    '--header', 'Accept: application/vnd.github.diff'], signal, MAX_DIFF_BYTES)
  if (Buffer.byteLength(patch, 'utf8') > MAX_DIFF_BYTES) throw new Error('Pull request diff exceeds the 20 MB limit. Open it on GitHub.')
  if (patch.trim() && !/^diff --git /mu.test(patch)) throw new Error('GitHub did not return a supported diff. Open it on GitHub.')
  return {
    id: `github-pr-${createHash('sha256').update(`${reference.url}\0${patch}`).digest('hex')}`,
    title: `${reference.repository} #${reference.number}`, workspace, patch, createdAt: new Date().toISOString(),
  }
}

const pullRequestPane: HarnessPlugin = (ctx) => {
  const controller = new AbortController()
  ctx.effect(() => () => controller.abort(), 'pull-request.lifetime')
  for (const [method, read] of [[PULL_REQUEST_READ_METHOD, readPullRequestDetails], [PULL_REQUEST_DIFF_METHOD, readPullRequestDiff]] as const) {
    ctx.clientExtensions.registerMethod(ctx, method, async (payload) => {
      if (!isRecord(payload) || typeof payload.resource !== 'string') throw new Error(`${method} needs a GitHub pull request resource`)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)])
      const result = await read(payload.resource, ctx.processRunner, signal, typeof payload.workspace === 'string' ? payload.workspace : '')
      return result as unknown as JsonValue
    })
  }
}
pullRequestPane.inject = ['clientExtensions', 'processRunner']
export default pullRequestPane
