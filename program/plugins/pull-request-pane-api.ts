import { z } from 'zod'
import type { JsonValue } from '../../src/shared/protocol.js'
import type { OpenPullRequest } from './pull-requests-api.js'

export const PULL_REQUEST_PANE_KIND = 'pull-request'
export const PULL_REQUEST_READ_METHOD = 'pull-request.read'
export const PULL_REQUEST_DIFF_METHOD = 'pull-request.diff'

export interface PullRequestReference { repository: string; number: number; url: string }

/** Resource identities stay independent of GitHub's optional page and fragment. */
export function parsePullRequestReference(value: string): PullRequestReference {
  const input = value.trim()
  if (input.length > 2_048) throw new Error('Enter a GitHub pull request URL or owner/repository#123')
  let match: RegExpExecArray | null
  if (/^https:\/\/github\.com\//iu.test(input)) {
    // Match the original path so URL normalization cannot hide dot segments.
    // The exact origin above also excludes credentials and explicit ports.
    const path = input.slice('https://github.com'.length).split(/[?#]/u, 1)[0] ?? ''
    match = /^\/([a-z\d][a-z\d-]*)\/([\w.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits))?\/?$/iu.exec(path)
  } else {
    match = /^([a-z\d][a-z\d-]*)\/([\w.-]+)#([1-9]\d*)$/iu.exec(input)
  }
  if (!match || ['.', '..'].includes(match[2] ?? '')) throw new Error('Use an HTTPS github.com pull request URL or owner/repository#123')
  const number = Number(match[3])
  if (!Number.isSafeInteger(number) || number > 2_147_483_647) throw new Error('The pull request number is invalid')
  const repository = `${match[1]}/${match[2]}`.toLowerCase()
  return { repository, number, url: `https://github.com/${repository}/pull/${number}` }
}

export interface PullRequestAuthor { login: string; url: string }
export interface PullRequestCheck { id: string; name: string; status: string; conclusion: string | null; url: string | null }
export interface PullRequestComment { id: string; body: string; author: PullRequestAuthor | null; createdAt: string; url: string }
export interface PullRequestThread {
  id: string
  path: string
  line: number | null
  isResolved: boolean
  isOutdated: boolean
  url: string
  comments: PullRequestComment[]
  moreComments: boolean
}
export interface PullRequestDetails extends OpenPullRequest {
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  author: PullRequestAuthor | null
  body: string
  headSha: string
  baseSha: string
  additions: number
  deletions: number
  changedFiles: number
  checksList: PullRequestCheck[]
  moreChecks: boolean
  comments: PullRequestComment[]
  moreComments: boolean
  threads: PullRequestThread[]
}

const authorSchema = z.object({ login: z.string(), url: z.string() })
const commentSchema = z.object({ id: z.string(), body: z.string(), author: authorSchema.nullable(), createdAt: z.string(), url: z.string() })
const detailsSchema = z.object({
  id: z.string(), number: z.number().int().positive(), title: z.string(), url: z.string(),
  repository: z.string(), headRepository: z.string().nullable(), branch: z.string(), baseBranch: z.string(),
  draft: z.boolean(), createdAt: z.string().optional(), updatedAt: z.string(), review: z.string().nullable(), checks: z.string().nullable(),
  mergeable: z.string(), mergeState: z.string(), unresolvedThreads: z.number().int().nonnegative(), moreThreads: z.boolean(),
  description: z.string().optional(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), changedFiles: z.number().int().nonnegative(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']), author: authorSchema.nullable(), body: z.string(), headSha: z.string(), baseSha: z.string(),
  checksList: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), conclusion: z.string().nullable(), url: z.string().nullable() })),
  moreChecks: z.boolean(), comments: z.array(commentSchema), moreComments: z.boolean(),
  threads: z.array(z.object({
    id: z.string(), path: z.string(), line: z.number().int().positive().nullable(), isResolved: z.boolean(), isOutdated: z.boolean(),
    url: z.string(), comments: z.array(commentSchema), moreComments: z.boolean(),
  })),
})

export function parsePullRequestDetails(value: JsonValue): PullRequestDetails {
  const parsed = detailsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Alto returned an invalid pull request')
  return parsed.data
}
