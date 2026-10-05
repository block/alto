import type { UiSurface } from '../../src/shared/protocol.js'

export const searchSurface = {
  id: 'default-search',
  kind: 'search',
  label: 'Search',
  appearance: 'full',
  placeholder: 'Search conversations and actions…',
  limit: 10,
} satisfies UiSurface
