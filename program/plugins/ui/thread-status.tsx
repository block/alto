import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { blockedStatusLabel, type ThreadBlockedKind, type ThreadWorkStatus } from '../thread-status-api.js'

export function threadStatusLabel(status: ThreadWorkStatus, kind?: ThreadBlockedKind): string {
  if (status === 'blocked') return blockedStatusLabel(kind)
  if (status === 'failed') return 'Failed'
  return status === 'running' ? 'Working' : 'Recently finished'
}

export function ThreadStatusIndicator({
  status,
  kind,
  label,
}: {
  status: ThreadWorkStatus | undefined
  /** What a blocked chat or program waits for. */
  kind?: ThreadBlockedKind | undefined
  /** Replaces the default accessible label, for example with a program's message. */
  label?: string | undefined
}): ReactNode {
  if (!status) return null
  const name = label ?? threadStatusLabel(status, kind)
  return (
    <span
      className={`thread-status-indicator ${status}`}
      data-thread-status={status}
      aria-label={name}
      title={name}
    >
      {status === 'running'
        ? <LoaderCircle size={12} strokeWidth={2} aria-hidden="true" />
        : status === 'blocked'
          ? <CircleAlert size={12} strokeWidth={2.25} aria-hidden="true" />
          : status === 'failed'
            ? <X size={12} strokeWidth={2.5} aria-hidden="true" />
            : <i aria-hidden="true" />}
    </span>
  )
}
