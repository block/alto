import { createContext } from 'react'
import type { ClientUiService } from '../../../src/client/plugin-api.js'
import type { ClientSessionService } from '../session-api.js'

export const QuestionComposerContext = createContext<{
  ui: ClientUiService
  session: ClientSessionService
} | undefined>(undefined)
