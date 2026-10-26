import type { ClientHostService } from '../../src/client/plugin-api.js'
import { isRecord, type JsonValue } from '../../src/shared/protocol.js'
import {
  CODE_TOUR_START_METHOD,
  CODE_TOUR_RESULT_METHOD,
  parseCodeTourGenerationResponse,
  type CodeTourGenerationResponse,
} from './code-tour-api.js'

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1_000)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Each host call finishes quickly even when the model needs several minutes. */
export async function requestCodeTourGeneration(
  host: Pick<ClientHostService, 'call'>,
  payload: JsonValue,
  signal: AbortSignal,
): Promise<CodeTourGenerationResponse> {
  signal.throwIfAborted()
  const started = await host.call(CODE_TOUR_START_METHOD, payload)
  signal.throwIfAborted()
  if (!isRecord(started) || typeof started.id !== 'string') {
    throw new Error('Alto could not start code tour generation')
  }

  for (;;) {
    const state = await host.call(CODE_TOUR_RESULT_METHOD, { id: started.id })
    signal.throwIfAborted()
    if (!isRecord(state)) throw new Error('Alto returned an invalid code tour status')
    if (state.status === 'ready') return parseCodeTourGenerationResponse(state.result ?? null)
    if (state.status === 'failed') {
      throw new Error(typeof state.problem === 'string' ? state.problem : 'Code tour generation failed')
    }
    if (state.status !== 'pending') throw new Error('Alto returned an invalid code tour status')
    await waitForNextPoll(signal)
  }
}
