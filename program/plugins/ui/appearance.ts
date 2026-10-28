import { clientStyles } from '../../../src/client/plugin-api.js'

/** Visual roles shared by built-in surfaces. Features retain their own layout. */
export const uiStyles = {
  button: clientStyles.button,
  iconButton: clientStyles.iconButton,
  dialog: 'alto-dialog',
  panel: 'alto-popup-panel',
  row: 'alto-choice-row',
  field: 'alto-field',
  input: 'alto-input',
  title: 'alto-control-title',
  description: 'alto-control-description',
  segment: 'alto-segment',
  tooltip: 'alto-tooltip',
  key: 'alto-keycap',
} as const
