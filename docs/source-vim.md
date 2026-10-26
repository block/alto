# Vim navigation in Source

Focus a Source pane to use Vim navigation. Source stays read-only: navigation,
selection, and clipboard copying do not modify the file. Inline edit requests
show a proposed change, and only Accept writes it to disk.
The status line shows the mode, cursor position, and pending commands. The
keyboard button or `:help` opens the shortcut reference.

Mouse controls remain available. Click source text to place the cursor and
continue navigating with keys. Drag across text for a character selection, or
drag in the gutter to select whole lines. Use `y` or the standard Copy shortcut
to copy a selection, and `c`, the toolbar, or the gutter's comment button to
review it. Press `e` to open directly in Edit mode. Choose Comment to send the
selection to chat, or Edit to propose a change to those lines. Wrap and reload
controls return keyboard focus to Source.

| Action | Keys |
| --- | --- |
| Move the cursor | `h j k l`, arrow keys, counts such as `12j` |
| Move by word or whitespace-delimited WORD | `w b 1e`, `W B E`, `ge gE` |
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
| Request an edit to the current or selected lines | `e` |
| Cancel a command or selection | Escape |

Search treats the query as literal text. It ignores case unless the query
contains a capital letter, searches other occurrences on the same line, and
wraps at the end of the file. Submitting an empty search repeats the previous
query. Commands belong to one pane and one loaded file: opening another file
resets its marks and searches, while switching workspace tabs retains the
loaded pane and cursor.

This is a navigation-focused Vim subset, not a Neovim process. Direct editing,
macros, registers, regular-expression searches, block selections, and arbitrary
Ex commands are not supported. Bracket matching uses source delimiters without
language-specific parsing. Use the Editor pane for direct text editing.
Bare `e` opens an edit request; `1e` and other counted word-end motions, `ye`,
and `ge` keep their Vim behavior. The diff viewer is unchanged.

## Comments and small edits

Press `c` or click the comment control to open the compact request composer.
Press `e` to open it with Edit already selected.
Choose **Comment** or **Edit**, enter a request, and use the circular send button
or `Cmd+Enter` (`Ctrl+Enter` on other platforms). Escape closes an unsent draft.

Source remembers the chat that opened the file. The destination picker can
change that association for this Source pane without affecting other panes.
An independently opened Source pane uses the only chat in its tab; with several
chats, choose one. A closed or replaced destination is never silently rerouted.
Comments send immediately with the selected source and its file revision, using
the chat's normal queue when a turn is already running.

**Edit** sends a proposal request to the linked local Codex chat, using its
conversation history and settings. A busy chat queues the request for its next
turn. The request tells the agent to return replacement text through
`source/propose_edit` and leave the file unchanged until review. The inline
Pierre diff offers **Accept** and **Reject**; a changed file
requires a new proposal. Text outside the selection, line endings, and file
permissions are preserved. Proposals stay with a retained pane while switching
tabs or files. They expire after fifteen minutes and do not survive a browser reload or host
restart. Reject discards the proposal; it does not undo messages already sent
to the chat.

Inline edits require a local Codex destination and a file inside its project
workspace. Alto's currently running plugin files must be changed through chat
so Cordis can reload them safely. Direct typing into Source remains disabled.

## Implementation

`source-vim.ts` provides pure motions and position conversions.
`source-vim-controller.ts` owns command sequences, selections, searches, marks,
and jump history. It returns effects for the Source pane to carry out, including
clipboard writes, scrolling, and review comments. The controller never writes
source files or accesses the DOM.

`source-vim-dom.ts` measures rendered text to place the cursor and character
selection overlays across syntax tokens, tabs, wide characters, and wrapped
lines. Source positions use UTF-16 offsets; screen placement comes from DOM
ranges rather than assuming each offset occupies one monospace cell.

Unit tests cover command semantics. The Electron fixture exercises the real
Source plugin, syntax renderer, focus behavior, clipboard integration, mouse
selection, review comments, pane retention, and normal and narrow layouts.
