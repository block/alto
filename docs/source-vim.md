# Vim navigation and editing in Source

Focus a Source pane to use Vim navigation. It opens in review mode. Press
`i`, `a`, `I`, `A`, `o`, or `O` to start editing at the cursor, or click the
pencil button to open the editor in Normal mode. The status line shows your
mode, cursor position, and whether the file has unsaved changes. The keyboard
button or `:help` in review opens the shortcut reference.

Editing uses CodeMirror 6 with Vim bindings. Use Insert mode to type, Escape
to return to Normal mode, and ordinary Vim changes such as `ciw`, `dd`, `x`,
`p`, `u`, `Ctrl+r`, and `.`. Mouse placement, dragging, native Copy/Paste,
search, and Visual selections remain available. `c` changes text in editing;
it adds a comment in review.

Save with `⌘S` (`Ctrl+s`), `:w`, or the save button. `:wq` saves and returns
to review only after a successful save with no further edits. The book button
or `:q` returns to the saved file for review and retains the editor's draft.
Review comments stay attached to their saved file revision. This is not a
Neovim process: Neovim plugins and shell commands are not supported.

Each pane retains its file buffers and undo history across file and workspace
tab switches. Draft text and its original revision are backed up locally for
recovery when the pane is restored after a reload or restart; undo history
is session-only. Disk writes are explicit. Saves compare the original revision
with the current disk contents and reject conflicts without replacing the
buffer. Changes typed during a pending save remain unsaved. Reload is disabled
while a draft is dirty; Discard changes requires confirmation before reloading.

Mouse controls remain available. Click source text to place the cursor and
continue navigating with keys. Drag across text for a character selection, or
drag in the gutter to select whole lines. Use `y` or the standard Copy shortcut
to copy a selection, and `c`, the toolbar, or the gutter's comment button to
review it. Wrap and reload controls return keyboard focus to Source.

| Action | Keys |
| --- | --- |
| Move the cursor | `h j k l`, arrow keys, counts such as `12j` |
| Move by word or whitespace-delimited WORD | `w b e`, `W B E`, `ge gE` |
| Move within a line | `0`, `^`, `$`, `g_`, Home, End |
| Go to a line | `gg`, `G`, `42G`, `42gg`, `:42`, `:$` |
| Move by paragraph or matching bracket | `{`, `}`, `%` |
| Find a character on this line | `f F t T` followed by a character; `;` / `,` repeat |
| Search forward / backward | `/`, `?`; `n` repeats the direction, `N` reverses it |
| Find the word under the cursor | `*`, `#` |
| Select characters / whole lines | `v`, `V`; motions extend the selection, `o` exchanges ends |
| Copy to the system clipboard | `y` in Visual mode, `yy`, or a motion such as `yw`, `y$`, `yG` |
| Select or copy a text object | `viw`, `yiw`, `yaw`, `yi(`, `ya{`, `yi"`; word, WORD, bracket and quote objects |
| Move through the viewport | `Ctrl+d/u`, `Ctrl+f/b`, Page Down / Up, `H M L` |
| Position the current line | `zz`, `zt`, `zb` |
| Scroll by a line | `Ctrl+e`, `Ctrl+y` |
| Set / return to a local mark | `ma`, `'a` for the line, `` `a `` for the exact position |
| Return through jumps | `Ctrl+o`, `Ctrl+i` |
| Comment on the current or selected lines | `c` |
| Cancel a command or selection | Escape |

Search treats the query as literal text. It ignores case unless the query
contains a capital letter, searches other occurrences on the same line, and
wraps at the end of the file. Submitting an empty search repeats the previous
query. Commands belong to one pane and one loaded file: opening another file
resets its marks and searches, while switching workspace tabs retains the
loaded pane and cursor.

The table describes the review command layer. Its search is literal and its
bracket matching uses source delimiters without language-specific parsing.
Editing has CodeMirror's Vim search, text objects, registers, and editing
commands instead. The read-only diff viewer is unchanged.

## Implementation

`source-vim.ts` provides pure motions and position conversions.
`source-vim-controller.ts` owns command sequences, selections, searches, marks,
and jump history. It returns effects for the Source pane to carry out, including
clipboard writes, scrolling, and review comments. The review controller never writes source files or accesses the DOM.

`source-editor.client.tsx` owns one CodeMirror instance per edited buffer,
including its selection, syntax parser, history, and Vim state. Its Ex save
commands route to the exact invoking editor. The Source pane owns dirty state,
file navigation, saving, and draft recovery through `source-editor-drafts.ts`.
`source-viewer.ts` performs bounded UTF-8 reads and revision-checked atomic
saves, preserving BOM, line endings, permissions, and ownership. A changed
file is checked again immediately before replacement. External programs can
still race the final rename because the filesystem has no portable conditional
rename operation.

`source-vim-dom.ts` measures rendered text to place the cursor and character
selection overlays across syntax tokens, tabs, wide characters, and wrapped
lines. Source positions use UTF-16 offsets; screen placement comes from DOM
ranges rather than assuming each offset occupies one monospace cell.

Unit tests cover command semantics. The Electron fixture exercises the real
Source plugin, syntax renderer, focus behavior, clipboard integration, pane
retention, editing, save conflicts, and normal and narrow layouts.
