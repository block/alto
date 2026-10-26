import { useEffect, useRef, useState } from 'react'
import type { ClientHostService } from '../../src/client/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import {
  SOURCE_EDIT_START_METHOD, SOURCE_EDIT_STATUS_METHOD, SOURCE_EDIT_APPLY_METHOD, SOURCE_EDIT_DISCARD_METHOD,
  parseSourceEditStatus, parseSourceEditApplied, type SourceEditRequest, type SourceEditProposal,
} from './source-edit-api.js'

export interface SourceEditItem {
  id: string
  path: string
  revision: string
  start: number
  end: number
  body: string
  status: 'pending' | 'ready' | 'applying' | 'failed'
  proposal?: SourceEditProposal
  problem?: string
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1_000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Proposals belong to the retained Source pane, including when another file is visible. */
export function useSourceEdits(host: ClientHostService, onApplied: (path: string) => void) {
  const [state, setState] = useState<{ edits: SourceEditItem[]; version: number }>({ edits: [], version: 0 })
  const { edits, version } = state
  const setEdits = (change: (items: SourceEditItem[]) => SourceEditItem[]): void => {
    setState((current) => ({ edits: change(current.edits), version: current.version + 1 }))
  }
  const operations = useRef(new Map<string, AbortController>())
  const applying = useRef(new Set<string>())
  const mounted = useRef(true)
  const applied = useRef(onApplied)
  applied.current = onApplied

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const [id, operation] of operations.current) {
        operation.abort()
        if (!applying.current.has(id)) void host.call(SOURCE_EDIT_DISCARD_METHOD, { id }).catch(() => undefined)
      }
      operations.current.clear()
    }
  }, [host])

  const update = (id: string, change: (edit: SourceEditItem) => SourceEditItem): void => {
    if (mounted.current) setEdits((items) => items.map((item) => item.id === id ? change(item) : item))
  }
  const problem = (id: string, error: unknown, status: 'ready' | 'failed'): void => {
    update(id, (edit) => ({ ...edit, status, problem: error instanceof Error ? error.message : String(error) }))
  }

  const poll = async (id: string, signal: AbortSignal): Promise<void> => {
    try {
      while (!signal.aborted) {
        const state = parseSourceEditStatus(await host.call(SOURCE_EDIT_STATUS_METHOD, { id }))
        if (signal.aborted) return
        if (state.status === 'failed') throw new Error(state.problem)
        if (state.status === 'ready') {
          update(id, (edit) => {
            if (state.proposal.id !== id || state.proposal.path !== edit.path || state.proposal.revision !== edit.revision
              || state.proposal.start !== edit.start || state.proposal.end !== edit.end) {
              return { ...edit, status: 'failed', problem: 'The proposed edit does not match the requested selection.' }
            }
            return { ...edit, status: 'ready', proposal: state.proposal }
          })
          return
        }
        if (state.status === 'applied') {
          if (mounted.current) setEdits((items) => items.filter((item) => item.id !== id))
          applied.current(state.result.path)
          operations.current.delete(id)
          return
        }
        await pause(signal)
      }
    } catch (error) {
      if (!signal.aborted) problem(id, error, 'failed')
    }
  }

  const start = async (
    request: SourceEditRequest,
    deliver: (prompt: string, beforeSend: () => Promise<void>) => Promise<void>,
  ): Promise<void> => {
    const result = await host.call(SOURCE_EDIT_START_METHOD, request as unknown as JsonValue)
    if (!isRecord(result) || typeof result.id !== 'string' || typeof result.prompt !== 'string') {
      throw new Error('Alto could not prepare the edit request.')
    }
    const id = result.id
    if (!mounted.current) { await host.call(SOURCE_EDIT_DISCARD_METHOD, { id }); return }
    const operation = new AbortController()
    operations.current.set(id, operation)
    const beforeSend = async (): Promise<void> => {
      if (operation.signal.aborted) throw new Error('This edit request was cancelled.')
      const status = parseSourceEditStatus(await host.call(SOURCE_EDIT_STATUS_METHOD, { id }))
      if (operation.signal.aborted) throw new Error('This edit request was cancelled.')
      if (status.status !== 'pending') throw new Error('This edit request is no longer waiting for a proposal.')
    }
    try {
      await deliver(result.prompt, beforeSend)
      if (operation.signal.aborted) return
      setEdits((items) => [...items, { id, path: request.path, revision: request.revision, start: request.start,
        end: request.end, body: request.instruction, status: 'pending' }])
      void poll(id, operation.signal)
    } catch (error) {
      operation.abort()
      operations.current.delete(id)
      await host.call(SOURCE_EDIT_DISCARD_METHOD, { id }).catch(() => undefined)
      throw error
    }
  }

  const accept = async (id: string): Promise<void> => {
    if (applying.current.has(id)) return
    applying.current.add(id)
    update(id, (edit) => { const next = { ...edit, status: 'applying' as const }; delete next.problem; return next })
    try {
      const result = parseSourceEditApplied(await host.call(SOURCE_EDIT_APPLY_METHOD, { id }))
      operations.current.get(id)?.abort()
      operations.current.delete(id)
      if (mounted.current) {
        setEdits((items) => items.filter((item) => item.id !== id))
        applied.current(result.path)
      }
    } catch (error) {
      problem(id, error, 'ready')
    } finally {
      applying.current.delete(id)
    }
  }

  const reject = async (id: string): Promise<void> => {
    if (applying.current.has(id)) return
    try {
      await host.call(SOURCE_EDIT_DISCARD_METHOD, { id })
      operations.current.get(id)?.abort()
      operations.current.delete(id)
      if (mounted.current) setEdits((items) => items.filter((item) => item.id !== id))
    } catch (error) {
      update(id, (edit) => ({ ...edit, problem: error instanceof Error ? error.message : String(error) }))
    }
  }

  return { edits, version, start, accept, reject }
}
