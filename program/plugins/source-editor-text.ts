import { invertedEffects } from '@codemirror/commands'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'

interface LineEndings {
  preferred: string
  endings: readonly string[]
}

const restoreEndings = StateEffect.define<readonly string[]>()
const lineEndings = StateField.define<LineEndings>({
  create: (state) => ({ preferred: '\n', endings: Array<string>(state.doc.lines - 1).fill('\n') }),
  update(value, transaction) {
    let restored: readonly string[] | undefined
    for (const effect of transaction.effects) if (effect.is(restoreEndings)) restored = effect.value
    if (restored) return { ...value, endings: restored }
    if (!transaction.docChanged) return value
    const endings: string[] = []
    let consumed = 0
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      const first = transaction.startState.doc.lineAt(from).number - 1
      const last = transaction.startState.doc.lineAt(to).number - 1
      for (let index = consumed; index < first; index += 1) endings.push(value.endings[index]!)
      for (let line = 1; line < inserted.lines; line += 1) endings.push(value.preferred)
      consumed = last
    })
    for (let index = consumed; index < value.endings.length; index += 1) endings.push(value.endings[index]!)
    if (endings.length === value.endings.length && endings.every((ending, index) => ending === value.endings[index])) return value
    return { ...value, endings }
  },
})

/** Vim operates on LF text; file serialization retains even mixed line endings. */
export function sourceEditorText(source: string): { doc: string; extension: Extension } {
  const endings = source.match(/\r\n|\r|\n/gu) ?? []
  return {
    doc: source.replace(/\r\n|\r/gu, '\n'),
    extension: [
      lineEndings.init(() => ({ preferred: endings[0] ?? '\n', endings })),
      invertedEffects.of((transaction) => {
        const before = transaction.startState.field(lineEndings).endings
        return before === transaction.state.field(lineEndings).endings ? [] : [restoreEndings.of(before)]
      }),
    ],
  }
}

export function sourceEditorSource(state: EditorState): string {
  const { endings } = state.field(lineEndings)
  return state.doc.toJSON().map((line, index) => line + (endings[index] ?? '')).join('')
}
