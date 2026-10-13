# Vim navigation in Source

Focus a Source pane to use Vim navigation. Source stays read-only: navigation,
selection, clipboard copying, and review comments do not modify the file.
The status line shows the mode, cursor position, and pending commands. The
keyboard button or `:help` opens the shortcut reference.

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

This is a navigation-focused Vim subset, not a Neovim process. Editing,
macros, registers, regular-expression searches, block selections, and arbitrary
Ex commands are not supported. Bracket matching uses source delimiters without
language-specific parsing. Use the Editor pane when you want to change files.
The diff viewer is unchanged.

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
