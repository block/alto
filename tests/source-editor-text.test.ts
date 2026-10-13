import { history, redo, undo } from '@codemirror/commands'
import { EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { sourceEditorSource, sourceEditorText } from '../program/plugins/source-editor-text.js'

function buffer(source: string) {
  const text = sourceEditorText(source)
  let state = EditorState.create({ doc: text.doc, extensions: [text.extension, history()] })
  const dispatch = (transaction: Transaction) => { state = transaction.state }
  return {
    source: () => sourceEditorSource(state),
    normalized: () => state.doc.toString(),
    edit: (spec: TransactionSpec) => dispatch(state.update(spec)),
    undo: () => undo({ state, dispatch }),
    redo: () => redo({ state, dispatch }),
  }
}

describe('Source editor line endings', () => {
  it.each(['', 'alpha\nbeta\n', 'alpha\r\nbeta\r\n', 'alpha\rbeta\r', 'alpha\r\nbeta\ngamma\r'])('round-trips source without normalizing untouched text: %j', (source) => {
    const editor = buffer(source)
    expect(editor.source()).toBe(source)
    expect(editor.normalized()).toBe(source.replace(/\r\n|\r/gu, '\n'))
  })

  it('accepts Vim LF insertions while retaining CRLF on disk', () => {
    const editor = buffer('alpha\r\nbeta\r\n')
    editor.edit({ changes: { from: 5, insert: '\nnew line' } })
    expect(editor.normalized()).toBe('alpha\nnew line\nbeta\n')
    expect(editor.source()).toBe('alpha\r\nnew line\r\nbeta\r\n')
    expect(editor.undo()).toBe(true)
    expect(editor.source()).toBe('alpha\r\nbeta\r\n')
    expect(editor.redo()).toBe(true)
    expect(editor.source()).toBe('alpha\r\nnew line\r\nbeta\r\n')
  })

  it('preserves untouched mixed separators across disjoint edits', () => {
    const editor = buffer('alpha\r\nbeta\ngamma\rdelta\r\n')
    editor.edit({ changes: [{ from: 0, to: 5, insert: 'first' }, { from: 11, insert: 'extra\n' }] })
    expect(editor.source()).toBe('first\r\nbeta\nextra\r\ngamma\rdelta\r\n')
    expect(editor.undo()).toBe(true)
    expect(editor.source()).toBe('alpha\r\nbeta\ngamma\rdelta\r\n')
  })

  it('restores removed mixed separators through grouped undo and redo', () => {
    const original = 'alpha\r\nbeta\ngamma\rdelta\r\n'
    const editor = buffer(original)
    editor.edit({ changes: { from: 10, to: 11 }, annotations: Transaction.userEvent.of('delete.backward') })
    editor.edit({ changes: { from: 9, to: 10 }, annotations: Transaction.userEvent.of('delete.backward') })
    const changed = editor.source()
    expect(changed).toBe('alpha\r\nbetgamma\rdelta\r\n')
    expect(editor.undo()).toBe(true)
    expect(editor.source()).toBe(original)
    expect(editor.redo()).toBe(true)
    expect(editor.source()).toBe(changed)
  })

  it('handles more than 100,000 line boundaries without spreading function arguments', () => {
    const source = 'a\r\n'.repeat(120_000)
    const editor = buffer(source)
    editor.edit({ changes: { from: 0, insert: 'x' } })
    expect(editor.source()).toBe('x' + source)
  })
})
