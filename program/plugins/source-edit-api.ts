export const SOURCE_EDIT_START_METHOD = 'source-edit.start'
export const SOURCE_EDIT_STATUS_METHOD = 'source-edit.status'
export const SOURCE_EDIT_APPLY_METHOD = 'source-edit.apply'
export const SOURCE_EDIT_DISCARD_METHOD = 'source-edit.discard'

export interface SourceEditRequest {
  path: string
  revision: string
  start: number
  end: number
  instruction: string
  workspace: string
  threadId: string
}

/** Exact selected bytes expressed as UTF-8, including the selected line endings. */
export interface SourceEditProposal {
  id: string
  path: string
  revision: string
  start: number
  end: number
  original: string
  replacement: string
}

export interface SourceEditApplied {
  path: string
  revision: string
}

export type SourceEditStatus =
  | { status: 'pending' }
  | { status: 'ready'; proposal: SourceEditProposal }
  | { status: 'failed'; problem: string }
  | { status: 'applied'; result: SourceEditApplied }

export function parseSourceEditStatus(value: unknown): SourceEditStatus {
  if (!value || typeof value !== 'object') throw new Error('Alto returned an invalid edit status')
  const state = value as Record<string, unknown>
  if (state.status === 'pending') return { status: 'pending' }
  if (state.status === 'failed' && typeof state.problem === 'string') {
    return { status: 'failed', problem: state.problem }
  }
  if (state.status === 'applied') {
    return { status: 'applied', result: parseSourceEditApplied(state.result) }
  }
  if (state.status === 'ready' && state.proposal && typeof state.proposal === 'object') {
    const proposal = state.proposal as Record<string, unknown>
    if (
      typeof proposal.id === 'string'
      && typeof proposal.path === 'string'
      && typeof proposal.revision === 'string'
      && Number.isSafeInteger(proposal.start) && Number(proposal.start) > 0
      && Number.isSafeInteger(proposal.end) && Number(proposal.end) >= Number(proposal.start)
      && typeof proposal.original === 'string'
      && typeof proposal.replacement === 'string'
    ) return { status: 'ready', proposal: proposal as unknown as SourceEditProposal }
  }
  throw new Error('Alto returned an invalid edit status')
}

export function parseSourceEditApplied(value: unknown): SourceEditApplied {
  if (value && typeof value === 'object') {
    const result = value as Record<string, unknown>
    if (typeof result.path === 'string' && typeof result.revision === 'string') {
      return { path: result.path, revision: result.revision }
    }
  }
  throw new Error('Alto returned an invalid applied edit')
}
