import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Context } from 'cordis'
import type { HarnessPlugin, TurnDraft } from '../../src/server/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import type {
  WorkCheckout,
  WorkProviderBranchInput,
  WorkProviderRegistration,
  WorkProviderTargetInput,
  WorkTarget,
} from './work-contexts-api.js'
import type {} from './process-runner-api.js'

const execFileAsync = promisify(execFile)
const PROVIDER_ID = 'blox'
const DEFAULT_IDLE_TIMEOUT_MINUTES = 60
const DEFAULT_POLL_INTERVAL_MS = 10_000
const MAX_OUTPUT = 16 * 1024

interface BloxBinding {
  projectId: string
  branch: string
  sourcePath: string
  createdAt: string
}

interface BloxPersistence {
  bindings: Record<string, BloxBinding>
}

interface RawBloxWorkstation {
  workstation_id?: unknown
  name?: unknown
  status?: unknown
  created_at?: unknown
  message?: unknown
  uris?: unknown
  last_used_at?: unknown
  projects?: unknown
  provider?: unknown
}

export interface BloxWorkstation {
  id: string
  name: string
  status: string
  statusTone: NonNullable<WorkCheckout['statusTone']>
  message: string
  repository?: string
  ref?: string
  url?: string
  provider?: string
  createdAt?: string
  lastUsedAt?: string
  projectId?: string
  branch?: string
}

interface PendingLaunch {
  checkout: WorkCheckout
  phase: 'running' | 'succeeded' | 'failed'
  output: string
  error?: string
}

interface BloxProviderConfig {
  idleTimeoutMinutes?: number
  pollIntervalMs?: number
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function statusFor(
  message: string,
  rawStatus: unknown,
): Pick<BloxWorkstation, 'status' | 'statusTone'> {
  const value = message.toLowerCase()
  if (/fail|error|degraded/u.test(value)) return { status: 'Problem', statusTone: 'danger' }
  if (/ready|running/u.test(value)) return { status: 'Running', statusTone: 'success' }
  if (/queued|creat|provision|start|resum/u.test(value)) {
    return { status: 'Starting', statusTone: 'progress' }
  }
  if (/suspending/u.test(value)) return { status: 'Suspending', statusTone: 'warning' }
  if (/suspended|stopped/u.test(value)) return { status: 'Suspended', statusTone: 'neutral' }
  return {
    status: typeof rawStatus === 'number' ? `State ${rawStatus}` : 'Unknown',
    statusTone: 'neutral',
  }
}

function repositoryFrom(raw: RawBloxWorkstation): { repository?: string; ref?: string } {
  if (!Array.isArray(raw.projects)) return {}
  for (const project of raw.projects) {
    if (!isRecord(project) || !isRecord(project.Project) || !isRecord(project.Project.Repository)) continue
    const source = text(project.Project.Repository.source)
    if (!source) continue
    const [repository, query = ''] = source.split('?', 2)
    const ref = new URLSearchParams(query).get('ref')?.trim()
    return {
      ...(repository ? { repository: repository.replace(/\.git$/iu, '') } : {}),
      ...(ref ? { ref } : {}),
    }
  }
  return {}
}

function webTerminal(raw: RawBloxWorkstation): string | undefined {
  if (!Array.isArray(raw.uris)) return undefined
  for (const candidate of raw.uris) {
    if (isRecord(candidate) && candidate.type === 'web-terminal') return text(candidate.uri)
  }
  return undefined
}

export function parseBloxWorkstations(
  value: unknown,
  bindings: Readonly<Record<string, BloxBinding>> = {},
): BloxWorkstation[] {
  if (!Array.isArray(value)) throw new Error('Blox returned an invalid workstation list')
  return value.flatMap((candidate): BloxWorkstation[] => {
    if (!isRecord(candidate)) return []
    const raw = candidate as RawBloxWorkstation
    const id = text(raw.workstation_id)
    const name = text(raw.name)
    if (!id || !name) return []
    const message = text(raw.message) ?? ''
    const status = statusFor(message, raw.status)
    const repository = repositoryFrom(raw)
    const binding = bindings[name]
    const provider = text(raw.provider)
    const createdAt = text(raw.created_at)
    const lastUsedAt = text(raw.last_used_at)
    const url = webTerminal(raw)
    return [{
      id,
      name,
      ...status,
      message: message || status.status,
      ...repository,
      ...(provider ? { provider } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(lastUsedAt ? { lastUsedAt } : {}),
      ...(url ? { url } : {}),
      ...(binding ? { projectId: binding.projectId, branch: binding.branch } : {}),
    }]
  }).toSorted((left, right) => (
    (right.lastUsedAt ?? right.createdAt ?? '').localeCompare(left.lastUsedAt ?? left.createdAt ?? '')
  ))
}

function persistenceFile(projectRoot: string): string {
  return path.join(projectRoot, '.codex-cordis', 'block-internal', 'blox-bindings.json')
}

function binding(value: unknown): BloxBinding | undefined {
  if (
    !isRecord(value)
    || typeof value.projectId !== 'string'
    || typeof value.branch !== 'string'
    || typeof value.sourcePath !== 'string'
    || typeof value.createdAt !== 'string'
  ) return undefined
  return {
    projectId: value.projectId,
    branch: value.branch,
    sourcePath: value.sourcePath,
    createdAt: value.createdAt,
  }
}

export function parseBloxPersistence(value: unknown): BloxPersistence {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.workstations)) {
    return { bindings: {} }
  }
  return {
    bindings: Object.fromEntries(Object.entries(value.workstations).flatMap(([name, candidate]) => {
      const parsed = binding(candidate)
      return parsed ? [[name, parsed]] : []
    })),
  }
}

async function readPersistence(file: string): Promise<BloxPersistence> {
  try {
    return parseBloxPersistence(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return { bindings: {} }
    throw error
  }
}

async function writePersistence(file: string, state: BloxPersistence): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify({
      version: 1,
      workstations: state.bindings,
    }, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function commandFailure(error: unknown): string {
  if (isRecord(error)) {
    if (typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr.trim()
    if (typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout.trim()
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  }
  return String(error)
}

async function git(cwd: string, args: string[], timeout = 30_000, env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      ...(env ? { env } : {}),
    })
    return stdout
  } catch (error) {
    throw new Error(commandFailure(error))
  }
}

async function gitReferenceExists(cwd: string, reference: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', cwd, 'show-ref', '--verify', '--quiet', reference], {
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 1) return false
    throw new Error(commandFailure(error))
  }
}

export interface BloxBranchStaging {
  branch: string
  cwd: string
  cleanup(): Promise<void>
}

export async function stageBloxBranchCheckout(
  sourcePath: string,
  requestedBranch: string,
  requestedBaseRef?: string,
): Promise<BloxBranchStaging> {
  const branch = requestedBranch.trim()
  if (!branch || branch.length > 240) throw new Error('branch must be between 1 and 240 characters')
  try {
    await git(sourcePath, ['check-ref-format', '--branch', branch], 5_000)
  } catch {
    throw new Error(`${JSON.stringify(branch)} is not a valid Git branch name`)
  }
  if (
    await gitReferenceExists(sourcePath, `refs/heads/${branch}`)
    || await gitReferenceExists(sourcePath, `refs/remotes/origin/${branch}`)
  ) throw new Error(`branch ${JSON.stringify(branch)} already exists; select its checkout instead`)

  const baseRef = requestedBaseRef?.trim()
  if (requestedBaseRef !== undefined && (
    !baseRef
    || baseRef.length > 240
    || baseRef.startsWith('-')
    || /[\0-\x1f\x7f]/u.test(baseRef)
  )) throw new Error('baseRef must be a valid Git reference between 1 and 240 characters')

  let head: string
  try {
    head = baseRef
      ? await git(sourcePath, ['rev-parse', '--verify', `${baseRef}^{commit}`], 10_000)
      : await git(sourcePath, ['rev-parse', 'HEAD'], 5_000)
  } catch {
    throw new Error(`Git base reference ${JSON.stringify(baseRef)} does not exist in this checkout`)
  }

  const [changes, untracked, origin] = await Promise.all([
    baseRef ? Promise.resolve('') : git(sourcePath, ['diff', '--binary', 'HEAD']),
    baseRef ? Promise.resolve('') : git(sourcePath, ['ls-files', '--others', '--exclude-standard', '-z']),
    git(sourcePath, ['remote', 'get-url', 'origin'], 5_000),
  ])
  const usesHermit = await stat(path.join(sourcePath, 'bin', 'activate-hermit'))
    .then((metadata) => metadata.isFile(), (error: unknown) => {
      if (isRecord(error) && error.code === 'ENOENT') return false
      throw error
    })
  const stagingEnv = usesHermit
    ? { ...process.env, PATH: [path.join(sourcePath, 'bin'), process.env.PATH].filter(Boolean).join(path.delimiter) }
    : undefined
  const root = await mkdtemp(path.join(tmpdir(), 'alto-blox-branch-'))
  const cwd = path.join(root, 'checkout')
  const cleanup = async (): Promise<void> => rm(root, { recursive: true, force: true })
  try {
    await execFileAsync('git', ['clone', '--shared', '--no-checkout', sourcePath, cwd], {
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
      ...(stagingEnv ? { env: stagingEnv } : {}),
    })
    await git(cwd, ['remote', 'set-url', 'origin', origin.trim()], 5_000)
    await git(cwd, ['switch', '-c', branch, head.trim()], 30_000, stagingEnv)

    if (changes) {
      const patchFile = path.join(root, 'changes.patch')
      await writeFile(patchFile, changes, 'utf8')
      await git(cwd, ['apply', '--whitespace=nowarn', patchFile])
    }
    for (const relative of untracked.split('\0').filter(Boolean)) {
      const source = path.resolve(sourcePath, relative)
      const destination = path.resolve(cwd, relative)
      if (!destination.startsWith(`${cwd}${path.sep}`)) throw new Error('Git returned an invalid untracked path')
      await mkdir(path.dirname(destination), { recursive: true })
      await cp(source, destination, { recursive: true, preserveTimestamps: true })
    }
    return { branch, cwd, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export function bloxWorkstationName(checkout: Pick<WorkCheckout, 'branch' | 'repository'>): string {
  if (!checkout.repository) throw new Error('Blox requires a git remote for this checkout')
  const repository = checkout.repository.split('?', 1)[0]?.replace(/\.git$/iu, '') ?? ''
  const repoName = repository.split('/').filter(Boolean).at(-1)
  if (!repoName) throw new Error('Blox could not determine the repository name')
  const branch = checkout.branch.replaceAll('/', '-')
  const name = checkout.branch === 'main' || checkout.branch === 'master'
    ? repoName
    : `${repoName}-${branch}`
  return name.slice(0, 63).replace(/-+$/u, '')
}

export function bloxLaunchArgs(idleTimeoutMinutes: number): string[] {
  // Launch must retain the Git context in cwd so the CLI can sync the branch,
  // commits, and uncommitted files. Supplying --name turns this into an
  // existing-workstation lookup and skips that discovery path.
  return ['blox', 'ws', 'launch', '--idle-timeout', String(idleTimeoutMinutes)]
}

function cleanOutput(value: string): string {
  return value.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

function boundedIdleTimeout(
  options: Record<string, JsonValue> | undefined,
  fallback: number,
): number {
  const requested = options?.idleTimeoutMinutes
  return typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(10, Math.min(1_440, Math.round(requested)))
    : fallback
}

function pendingCheckout(source: WorkCheckout, branch: string, name: string): WorkCheckout {
  return {
    id: `blox-${name}`,
    kind: PROVIDER_ID,
    projectId: source.projectId,
    branch,
    label: name,
    location: name,
    ...(source.repository ? { repository: source.repository } : {}),
    status: 'Starting',
    statusTone: 'progress',
    message: 'Preparing this branch on Blox',
  }
}

export function bloxExecutionContext(
  target: WorkTarget,
  sourcePath: string,
  workstation?: Pick<BloxWorkstation, 'status' | 'message'>,
): string {
  const state = workstation
    ? `${workstation.status}: ${workstation.message}`
    : 'status currently unavailable'
  return `Alto execution target: Blox workstation ${JSON.stringify(target.location)}.
This chat remains in the local agent app-server, but repository work for ${JSON.stringify(target.branch)} must run on that workstation (${state}).
- Load and follow the installed Blox skill. Keep every delegation and follow-up on ${JSON.stringify(target.location)}.
- Do not edit files, change Git state, or run implementation, build, or test commands in the local checkout at ${JSON.stringify(sourcePath)}.
- Prefer Blox ACP for iterative work and a Blox agent prompt for a self-contained task. Delegate the user's intent, constraints, and exit criteria, then verify the outcome.
- Local read-only inspection is allowed only to formulate or verify the remote work.
- If the workstation is unavailable, report that. Never silently fall back to local execution.`
}

export class BloxWorkProvider {
  private readonly file: string
  private readonly children = new Set<ChildProcess>()
  private readonly pending = new Map<string, PendingLaunch>()
  private persistence: BloxPersistence = { bindings: {} }
  private workstations: BloxWorkstation[] = []
  private registration: WorkProviderRegistration | undefined
  private refreshPromise: Promise<void> | undefined
  private active = true

  constructor(
    private readonly ctx: Context,
    private readonly defaultIdleTimeoutMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES,
  ) {
    this.file = persistenceFile(ctx.program.projectRoot)
  }

  async start(owner: Context): Promise<void> {
    this.persistence = await readPersistence(this.file)
    this.registration = this.ctx.workContexts.registerProvider(owner, {
      id: PROVIDER_ID,
      label: 'Blox',
      description: 'Run this branch on an isolated Blox workstation.',
      createTarget: (input) => this.createTarget(input),
      createBranchTarget: (input) => this.createBranchTarget(input),
    })
    await this.refresh()
    owner.effect(() => () => {
      this.active = false
      for (const child of this.children) child.kill('SIGINT')
    }, 'bloxProvider.processes')
  }

  refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.readWorkstations().finally(() => {
      this.refreshPromise = undefined
    })
    return this.refreshPromise
  }

  async createTarget(input: WorkProviderTargetInput): Promise<WorkCheckout> {
    const name = bloxWorkstationName(input.source)
    const checkout = pendingCheckout(input.source, input.source.branch, name)
    await this.remember(name, input.source, input.source.branch)
    this.launch(
      name,
      bloxLaunchArgs(boundedIdleTimeout(input.options, this.defaultIdleTimeoutMinutes)),
      input.source.location,
      checkout,
    )
    return checkout
  }

  async createBranchTarget(input: WorkProviderBranchInput): Promise<WorkCheckout> {
    if (!input.source.repository) throw new Error('Blox requires a git remote for this checkout')
    const staging = await stageBloxBranchCheckout(input.source.location, input.branch, input.baseRef)
    const target = { ...input.source, branch: staging.branch }
    const name = bloxWorkstationName(target)
    const checkout = pendingCheckout(input.source, staging.branch, name)
    try {
      await this.remember(name, input.source, staging.branch)
      this.launch(
        name,
        bloxLaunchArgs(boundedIdleTimeout(input.options, this.defaultIdleTimeoutMinutes)),
        staging.cwd,
        checkout,
        staging.cleanup,
      )
    } catch (error) {
      await staging.cleanup()
      delete this.persistence.bindings[name]
      await writePersistence(this.file, this.persistence)
      throw error
    }
    return checkout
  }

  executionContext(threadId: string): string | undefined {
    const target = this.ctx.workContexts.targetForThread(threadId)
    if (!target || target.kind !== PROVIDER_ID) return undefined
    const binding = this.persistence.bindings[target.location]
    const workstation = this.workstations.find((candidate) => candidate.name === target.location)
    return bloxExecutionContext(
      target,
      binding?.sourcePath ?? 'the original local checkout',
      workstation,
    )
  }

  private async remember(name: string, source: WorkCheckout, branch: string): Promise<void> {
    this.persistence.bindings[name] = {
      projectId: source.projectId,
      branch,
      sourcePath: source.location,
      createdAt: new Date().toISOString(),
    }
    await writePersistence(this.file, this.persistence)
  }

  private async readWorkstations(): Promise<void> {
    try {
      const { stdout } = await this.ctx.processRunner.execFile('sq', ['blox', 'ws', 'list', '--json', '--limit=100'], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      })
      this.workstations = parseBloxWorkstations(JSON.parse(stdout), this.persistence.bindings)
    } catch {
      // Keep the last known checkouts. Launching still retries through the CLI,
      // and dropping them here would make persisted chat targets look detached.
    }
    this.publish()
  }

  private launch(
    workstation: string,
    args: string[],
    cwd: string,
    checkout: WorkCheckout,
    cleanup?: () => Promise<void>,
  ): void {
    const launch: PendingLaunch = { checkout, phase: 'running', output: '' }
    this.pending.set(workstation, launch)
    const child = spawn('sq', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.children.add(child)
    this.publish()

    let cleanupStarted = false
    const finishCleanup = (): void => {
      if (!cleanup || cleanupStarted) return
      cleanupStarted = true
      void cleanup().catch(() => undefined)
    }
    const append = (chunk: Buffer): void => {
      launch.output = cleanOutput(`${launch.output}${chunk.toString('utf8')}`).slice(-MAX_OUTPUT)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      launch.phase = 'failed'
      launch.error = error.message
      this.children.delete(child)
      finishCleanup()
      this.publish()
    })
    child.on('close', (code) => {
      if (launch.phase === 'running') {
        launch.phase = code === 0 ? 'succeeded' : 'failed'
        if (code !== 0) launch.error = launch.output.trim() || `sq blox exited with status ${code ?? 'unknown'}`
      }
      this.children.delete(child)
      finishCleanup()
      this.publish()
      void this.refresh()
    })
  }

  private publish(): void {
    if (!this.active || !this.registration) return
    const remote = this.workstations.flatMap((workstation): WorkCheckout[] => {
      if (!workstation.projectId || !workstation.branch) return []
      return [{
        id: `blox-${workstation.name}`,
        kind: PROVIDER_ID,
        projectId: workstation.projectId,
        branch: workstation.branch,
        label: workstation.name,
        location: workstation.name,
        status: workstation.status,
        statusTone: workstation.statusTone,
        message: workstation.message,
        ...(workstation.repository ? { repository: workstation.repository } : {}),
        ...(workstation.url ? { url: workstation.url } : {}),
        ...(workstation.lastUsedAt ? { lastUsedAt: workstation.lastUsedAt } : {}),
      }]
    })
    const known = new Set(remote.map((checkout) => checkout.id))
    const pending = [...this.pending.values()].flatMap((launch): WorkCheckout[] => {
      if (known.has(launch.checkout.id)) return []
      return [{
        ...launch.checkout,
        status: launch.phase === 'failed' ? 'Problem' : launch.phase === 'succeeded' ? 'Ready' : 'Starting',
        statusTone: launch.phase === 'failed' ? 'danger' : launch.phase === 'succeeded' ? 'success' : 'progress',
        message: launch.phase === 'failed'
          ? launch.error ?? 'Blox launch failed'
          : launch.phase === 'succeeded' ? 'Blox launch completed' : 'Preparing this branch on Blox',
      }]
    })
    this.registration.update({ checkouts: [...remote, ...pending] })
  }
}

const bloxProvider: HarnessPlugin<BloxProviderConfig> = async (ctx, config) => {
  const idleTimeout = Math.max(
    10,
    Math.min(1_440, Math.round(config.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES)),
  )
  const pollInterval = Math.max(2_000, Math.round(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS))
  const provider = new BloxWorkProvider(ctx, idleTimeout)
  await provider.start(ctx)

  ctx.on('codex/turn/prepare', async (_draft: TurnDraft, next) => {
    const prepared = await next()
    const context = provider.executionContext(prepared.threadId)
    if (!context) return prepared
    return {
      ...prepared,
      additionalContext: {
        ...prepared.additionalContext,
        alto_blox_target: { kind: 'application', value: context },
      },
    }
  })

  const timer = setInterval(() => void provider.refresh(), pollInterval)
  ctx.effect(() => () => clearInterval(timer), 'bloxProvider.pollTimer')
}

bloxProvider.inject = ['program', 'turnProgram', 'workContexts', 'processRunner']

export default bloxProvider
