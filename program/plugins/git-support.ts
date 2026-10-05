import type { ProcessRunnerService } from './process-runner-api.js'
import type { HarnessContext, HarnessPlugin } from '../../src/server/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import type {
  GitBranchInspectOptions,
  GitBranchState,
  GitChangedFile,
  GitCheckState,
  GitInspectOptions,
  GitPullRequest,
  GitRepositoryState,
  GitSupportService,
  GitSupportSnapshot,
} from './git-support-api.js'

const STATE_NAME = 'git-support.state'
const INSPECT_METHOD = 'git-support.inspect'
const INSPECT_BRANCH_METHOD = 'git-support.inspect-branch'
const LOCAL_TTL_MS = 4_000
const REMOTE_TTL_MS = 45_000

interface GitSupportConfig {
  localTtlMs?: number
  remoteTtlMs?: number
}

interface PullRequestJson {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  headRefName: string
  baseRefName: string
  updatedAt?: string
  statusCheckRollup?: unknown[]
}

function normalizedPath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
}

async function command(
  runner: ProcessRunnerService,
  executable: string,
  args: string[],
  options: { cwd?: string; timeout?: number; trim?: boolean } = {},
): Promise<string> {
  const { stdout } = await runner.execFile(executable, args, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeout ?? 5_000,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
  return options.trim === false ? stdout : stdout.trim()
}

async function git(runner: ProcessRunnerService, location: string, args: string[], trim = true): Promise<string> {
  return command(runner, 'git', ['-C', location, ...args], { trim })
}

export function parseGitStatus(value: string): GitChangedFile[] {
  const records = value.split('\0')
  const files: GitChangedFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 3) continue
    const indexStatus = record[0] ?? ' '
    const worktreeStatus = record[1] ?? ' '
    const path = record.slice(3)
    if (!path) continue
    const renamed = /[RC]/u.test(indexStatus) || /[RC]/u.test(worktreeStatus)
    const previousPath = renamed ? records[index + 1] : undefined
    if (renamed) index += 1
    files.push({
      path,
      indexStatus,
      worktreeStatus,
      ...(previousPath ? { previousPath } : {}),
    })
  }
  return files.toSorted((left, right) => left.path.localeCompare(right.path))
}

export function checkState(checks: unknown): GitCheckState | undefined {
  if (!Array.isArray(checks) || checks.length === 0) return undefined
  let pending = false
  for (const check of checks) {
    if (!isRecord(check)) continue
    const conclusion = typeof check.conclusion === 'string' ? check.conclusion.toUpperCase() : ''
    const state = typeof check.state === 'string' ? check.state.toUpperCase() : ''
    const status = typeof check.status === 'string' ? check.status.toUpperCase() : ''
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(conclusion)
      || ['FAILURE', 'ERROR'].includes(state)) return 'failing'
    if ((status && status !== 'COMPLETED') || ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(state)) {
      pending = true
    }
  }
  return pending ? 'pending' : 'passing'
}

export function githubRepository(remote: string): string | undefined {
  const value = remote.trim().replace(/\.git$/u, '')
  if (/^[a-z0-9.-]+\/[^/]+\/[^/]+$/iu.test(value)) return value
  const scp = value.includes('://') ? null : /^(?:[^@]+@)?([^:]+):(.+\/.+)$/u.exec(value)
  if (scp) return `${scp[1]}/${scp[2]}`
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/^\/+|\/+$/gu, '')
    return path ? `${url.hostname}/${path}` : undefined
  } catch {
    return undefined
  }
}

function pullRequest(value: unknown): GitPullRequest | undefined {
  if (
    !isRecord(value)
    || typeof value.number !== 'number'
    || typeof value.title !== 'string'
    || typeof value.url !== 'string'
    || typeof value.state !== 'string'
    || typeof value.isDraft !== 'boolean'
    || typeof value.headRefName !== 'string'
    || typeof value.baseRefName !== 'string'
  ) return undefined
  const checks = checkState(value.statusCheckRollup)
  return {
    number: value.number,
    title: value.title,
    url: value.url,
    state: value.state,
    draft: value.isDraft,
    headBranch: value.headRefName,
    baseBranch: value.baseRefName,
    ...(checks ? { checks } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  }
}

async function readPullRequests(runner: ProcessRunnerService, root: string, branch: string): Promise<GitPullRequest[]> {
  if (!branch || branch.startsWith('detached@')) return []
  let remote: string
  try {
    remote = await git(runner, root, ['remote', 'get-url', 'origin'])
  } catch {
    return []
  }
  const repository = githubRepository(remote)
  if (!repository) return []
  return readPullRequestsForRepository(runner, repository, branch, root)
}

async function readPullRequestsForRepository(
  runner: ProcessRunnerService,
  repository: string,
  branch: string,
  cwd?: string,
): Promise<GitPullRequest[]> {
  if (!branch || branch.startsWith('detached@')) return []
  try {
    const output = await command(runner, 'gh', [
      'pr', 'list',
      '--repo', repository,
      '--head', branch,
      '--state', 'open',
      '--limit', '5',
      '--json', 'number,title,url,state,isDraft,headRefName,baseRefName,updatedAt,statusCheckRollup',
    ], { ...(cwd ? { cwd } : {}), timeout: 7_000 })
    const parsed = JSON.parse(output) as unknown
    return Array.isArray(parsed)
      ? parsed.map(pullRequest).filter((candidate): candidate is GitPullRequest => Boolean(candidate))
      : []
  } catch {
    // GitHub CLI is optional. Local branch and file state remain available.
    return []
  }
}

async function readLocalState(runner: ProcessRunnerService, location: string): Promise<GitRepositoryState> {
  const root = normalizedPath(await git(runner, location, ['rev-parse', '--show-toplevel']))
  const [branchText, head, statusText] = await Promise.all([
    git(runner, root, ['branch', '--show-current']),
    git(runner, root, ['rev-parse', '--short', 'HEAD']),
    git(runner, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], false),
  ])
  const branch = branchText || `detached@${head}`
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  try {
    upstream = await git(runner, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    const [behindText, aheadText] = (await git(runner, root, [
      'rev-list', '--left-right', '--count', '@{upstream}...HEAD',
    ])).split(/\s+/u)
    behind = Number(behindText) || 0
    ahead = Number(aheadText) || 0
  } catch {
    // Local-only branches legitimately have no upstream.
  }
  return {
    root,
    branch,
    head,
    ...(upstream ? { upstream } : {}),
    ahead,
    behind,
    files: parseGitStatus(statusText),
    pullRequests: [],
    updatedAt: new Date().toISOString(),
  }
}

export function preserveRemoteState(
  local: GitRepositoryState,
  known: GitRepositoryState | undefined,
): GitRepositoryState {
  if (!known || known.root !== local.root || known.branch !== local.branch) return local
  return {
    ...local,
    pullRequests: known.pullRequests,
    ...(known.remoteUpdatedAt ? { remoteUpdatedAt: known.remoteUpdatedAt } : {}),
  }
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function inspectPayload(value: JsonValue | undefined): { location: string; options: GitInspectOptions } {
  if (!isRecord(value) || typeof value.location !== 'string' || !value.location.trim()) {
    throw new Error('git-support.inspect requires a location')
  }
  return {
    location: value.location,
    options: {
      includeRemote: value.includeRemote === true,
      force: value.force === true,
    },
  }
}

function inspectBranchPayload(value: JsonValue | undefined): {
  location: string
  branch: string
  options: GitBranchInspectOptions
} {
  if (
    !isRecord(value)
    || typeof value.location !== 'string'
    || !value.location.trim()
    || typeof value.branch !== 'string'
    || !value.branch.trim()
  ) throw new Error('git-support.inspect-branch requires a location and branch')
  return {
    location: value.location,
    branch: value.branch,
    options: {
      ...(typeof value.repository === 'string' ? { repository: value.repository } : {}),
      ...(typeof value.originUrl === 'string' ? { originUrl: value.originUrl } : {}),
      force: value.force === true,
    },
  }
}

export class GitSupportRegistry implements GitSupportService {
  private readonly aliases = new Map<string, string>()
  private readonly repositories = new Map<string, GitRepositoryState>()
  private readonly inflight = new Map<string, Promise<GitRepositoryState>>()
  private readonly localInflight = new Map<string, Promise<GitRepositoryState>>()
  private readonly branches = new Map<string, GitBranchState>()
  private readonly branchInflight = new Map<string, Promise<GitBranchState>>()
  private revision = 0
  private readonly state
  private readonly runner: ProcessRunnerService

  constructor(
    owner: HarnessContext,
    private readonly localTtlMs: number,
    private readonly remoteTtlMs: number,
  ) {
    this.runner = owner.processRunner
    this.state = owner.clientExtensions.registerState(owner, STATE_NAME, json(this.snapshot()))
  }

  snapshot(): GitSupportSnapshot {
    return {
      version: 1,
      revision: this.revision,
      aliases: Object.fromEntries(this.aliases),
      repositories: Object.fromEntries(this.repositories),
      updatedAt: new Date().toISOString(),
    }
  }

  async inspect(location: string, options: GitInspectOptions = {}): Promise<GitRepositoryState> {
    const alias = normalizedPath(location)
    const knownRoot = this.aliases.get(alias)
    const known = knownRoot ? this.repositories.get(knownRoot) : undefined
    const now = Date.now()
    const localFresh = known && now - Date.parse(known.updatedAt) < this.localTtlMs
    const remoteFresh = !options.includeRemote || (
      known?.remoteUpdatedAt && now - Date.parse(known.remoteUpdatedAt) < this.remoteTtlMs
    )
    if (!options.force && known && localFresh && remoteFresh) return known

    const key = `${alias}:${options.includeRemote ? 'remote' : 'local'}:${options.force ? 'force' : 'cached'}`
    const running = this.inflight.get(key)
    if (running) return running
    const work = this.load(alias, known, options).finally(() => this.inflight.delete(key))
    this.inflight.set(key, work)
    return work
  }

  async inspectBranch(
    location: string,
    branch: string,
    options: GitBranchInspectOptions = {},
  ): Promise<GitBranchState> {
    const name = branch.trim()
    if (!name || name.length > 240) throw new Error('Git branch is invalid')
    let repository = options.repository ? githubRepository(options.repository) : undefined
    if (!repository && options.originUrl) repository = githubRepository(options.originUrl)
    let cwd: string | undefined
    if (!repository) {
      const local = await this.inspect(location)
      cwd = local.root
      try {
        repository = githubRepository(await git(this.runner, local.root, ['remote', 'get-url', 'origin']))
      } catch {
        // A local-only repository can still provide a stable empty branch result.
      }
    }
    const key = `${repository ?? normalizedPath(location)}\0${name}`
    const known = this.branches.get(key)
    if (!options.force && known && Date.now() - Date.parse(known.updatedAt) < this.remoteTtlMs) {
      return known
    }
    const running = this.branchInflight.get(key)
    if (running) return running
    const work = (async (): Promise<GitBranchState> => {
      const next: GitBranchState = {
        branch: name,
        pullRequests: repository
          ? await readPullRequestsForRepository(this.runner, repository, name, cwd)
          : [],
        updatedAt: new Date().toISOString(),
        ...(repository ? { repository } : {}),
      }
      this.branches.set(key, next)
      return next
    })().finally(() => this.branchInflight.delete(key))
    this.branchInflight.set(key, work)
    return work
  }

  private readLocal(alias: string, force: boolean): Promise<GitRepositoryState> {
    // Remote metadata requests and local badges can arrive together. They
    // should share the filesystem scan even when their final results differ.
    const key = `${alias}:${force ? 'force' : 'cached'}`
    const running = this.localInflight.get(key)
    if (running) return running
    const work = readLocalState(this.runner, alias).finally(() => this.localInflight.delete(key))
    this.localInflight.set(key, work)
    return work
  }

  private async load(
    alias: string,
    known: GitRepositoryState | undefined,
    options: GitInspectOptions,
  ): Promise<GitRepositoryState> {
    let next = known
    const now = Date.now()
    const localFresh = known && now - Date.parse(known.updatedAt) < this.localTtlMs
    if (options.force || !localFresh) {
      next = preserveRemoteState(await this.readLocal(alias, options.force === true), known)
    }
    if (!next) next = await this.readLocal(alias, options.force === true)
    if (options.includeRemote) {
      const remoteFresh = next.remoteUpdatedAt
        && now - Date.parse(next.remoteUpdatedAt) < this.remoteTtlMs
      if (options.force || !remoteFresh) {
        next = {
          ...next,
          pullRequests: await readPullRequests(this.runner, next.root, next.branch),
          remoteUpdatedAt: new Date().toISOString(),
        }
      }
    }
    this.aliases.set(alias, next.root)
    this.aliases.set(next.root, next.root)
    this.repositories.set(next.root, next)
    this.revision += 1
    this.state.update(json(this.snapshot()))
    return next
  }
}

const gitSupport: HarnessPlugin<GitSupportConfig> = (ctx, config) => {
  const registry = new GitSupportRegistry(
    ctx,
    Math.max(500, config?.localTtlMs ?? LOCAL_TTL_MS),
    Math.max(5_000, config?.remoteTtlMs ?? REMOTE_TTL_MS),
  )
  ctx.provide('gitSupport', registry)
  ctx.clientExtensions.registerMethod(ctx, INSPECT_METHOD, async (payload) => {
    const { location, options } = inspectPayload(payload)
    return json(await registry.inspect(location, options))
  })
  ctx.clientExtensions.registerMethod(ctx, INSPECT_BRANCH_METHOD, async (payload) => {
    const { location, branch, options } = inspectBranchPayload(payload)
    return json(await registry.inspectBranch(location, branch, options))
  })
}

gitSupport.inject = ['clientExtensions', 'processRunner']
gitSupport.provide = 'gitSupport'

export default gitSupport
