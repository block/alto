import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type {
  RpcId,
  RpcNotification,
  RpcRequest,
  RpcResponse,
} from '../shared/protocol.js'
import { errorMessage, isRecord } from '../shared/protocol.js'

interface AppServerProcess extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals): boolean
}

export interface AppServerClientOptions {
  command?: string
  args?: string[]
  cwd?: string
  createProcess?: () => AppServerProcess
}

export type AppServerStatus = 'starting' | 'ready' | 'stopped' | 'failed'

export interface AppServerStatusEvent {
  status: AppServerStatus
  error?: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class AppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'AppServerRpcError'
  }
}

export class AppServerClient extends EventEmitter {
  private process: AppServerProcess | undefined
  private startPromise: Promise<void> | undefined
  private nextId = 1
  private readonly pending = new Map<RpcId, PendingRequest>()
  private currentStatus: AppServerStatus = 'stopped'

  constructor(private readonly options: AppServerClientOptions = {}) {
    super()
  }

  get status(): AppServerStatus {
    return this.currentStatus
  }

  start(): Promise<void> {
    this.startPromise ??= this.startInternal()
    return this.startPromise
  }

  private async startInternal(): Promise<void> {
    this.setStatus('starting')
    const command = this.options.command ?? 'codex'
    const args = this.options.args ?? ['app-server', '--stdio']

    try {
      this.process = this.options.createProcess?.() ?? spawn(command, args, {
        cwd: this.options.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.attachProcess(this.process)

      await this.rawRequest('initialize', {
        clientInfo: {
          name: 'alto',
          title: 'Alto',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      })
      this.notify('initialized', {})
      this.setStatus('ready')
    } catch (error) {
      this.setStatus('failed', errorMessage(error))
      this.rejectPending(error)
      throw error
    }
  }

  private attachProcess(child: AppServerProcess): void {
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.handleLine(line))

    child.stderr.on('data', (chunk: Buffer | string) => {
      this.emit('stderr', chunk.toString())
    })

    child.once('error', (error) => {
      this.setStatus('failed', error.message)
      this.rejectPending(error)
    })

    child.once('exit', (code, signal) => {
      const reason = `codex app-server exited (${signal ?? code ?? 'unknown'})`
      if (this.currentStatus !== 'stopped') {
        this.setStatus(code === 0 ? 'stopped' : 'failed', code === 0 ? undefined : reason)
      }
      this.rejectPending(new Error(reason))
      this.process = undefined
      this.startPromise = undefined
    })
  }

  private handleLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.emit('stderr', `Invalid app-server JSON: ${line}`)
      return
    }

    if (!isRecord(message)) return
    const id = message.id as RpcId | undefined
    const method = typeof message.method === 'string' ? message.method : undefined

    if (method && id !== undefined) {
      const request: RpcRequest = {
        id,
        method,
        ...(isRecord(message.params) ? { params: message.params } : {}),
      }
      this.emit('request', request)
      return
    }

    if (method) {
      const notification: RpcNotification = {
        method,
        ...(isRecord(message.params) ? { params: message.params } : {}),
      }
      this.emit('notification', notification)
      return
    }

    if (id !== undefined) {
      this.handleResponse(message as unknown as RpcResponse)
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)

    if (response.error) {
      pending.reject(
        new AppServerRpcError(
          response.error.message,
          response.error.code,
          response.error.data,
        ),
      )
      return
    }
    pending.resolve(response.result)
  }

  private setStatus(status: AppServerStatus, error?: string): void {
    this.currentStatus = status
    const event: AppServerStatusEvent = {
      status,
      ...(error ? { error } : {}),
    }
    this.emit('status', event)
  }

  async request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    await this.start()
    return this.rawRequest(method, params) as Promise<T>
  }

  private rawRequest(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write({ method, id, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  notify(method: string, params: unknown = {}): void {
    this.write({ method, params })
  }

  respond(id: RpcId, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: RpcId, code: number, message: string, data?: unknown): void {
    this.write({
      id,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data }),
      },
    })
  }

  private write(message: unknown): void {
    if (!this.process?.stdin.writable) {
      throw new Error('codex app-server is not running')
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private rejectPending(reason: unknown): void {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  async stop(): Promise<void> {
    const child = this.process
    this.process = undefined
    this.startPromise = undefined
    this.setStatus('stopped')
    if (!child) return
    child.stdin.end()
    child.kill('SIGTERM')
  }
}
