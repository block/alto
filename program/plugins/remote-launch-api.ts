import type {} from '../../src/server/services/agent-registry.js'
import type { RemoteAgentProcess } from '../../src/server/services/remote-agent-api.js'
import { isRecord } from '../../src/shared/protocol.js'

/** An explicit, isolated repository checkout for a new remote chat. */
export interface RemoteLaunchTarget {
  repository: string
  branch: string
  /** Stable ownership key; retries of the same task reuse its workstation. */
  key: string
}

export function remoteLaunchTarget(value: unknown): RemoteLaunchTarget {
  if (!isRecord(value)) throw new Error('A remote launch target is required')
  const field = (name: keyof RemoteLaunchTarget, maximum: number): string => {
    const text = value[name]
    if (typeof text !== 'string' || !text.trim() || text.length > maximum || /[\0-\x1f\x7f]/u.test(text)) {
      throw new Error(`Invalid remote launch ${name}`)
    }
    return text
  }
  return { repository: field('repository', 2048), branch: field('branch', 240), key: field('key', 512) }
}

declare module '../../src/server/services/agent-registry.js' {
  interface AgentSessionOptions { remoteTarget?: RemoteLaunchTarget }
  interface AgentProviderSnapshot { remoteLaunchTargets?: boolean }
}

declare module '../../src/server/services/remote-agent-api.js' {
  interface RemoteAgentBackend {
    supportsLaunchTarget?: boolean
    create(agentId: string, cwd: string, signal: AbortSignal, target?: RemoteLaunchTarget): Promise<RemoteAgentProcess>
  }
}
