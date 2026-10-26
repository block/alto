export const KEEP_AWAKE_STATE = 'keep-awake'
export const KEEP_AWAKE_SET = 'keep-awake.set'

export interface KeepAwakeState {
  enabled: boolean
  available: boolean
  active: boolean
  problem?: string
}

export const KEEP_AWAKE_DEFAULT: KeepAwakeState = { enabled: false, available: false, active: false }
