# Rich replies

Rich Replies is an experimental Cordis plugin that lets an agent compose the answer itself as HTML in the conversation. Its prompt guidance applies to every prepared turn. Never use rich UI merely to display or restyle text. If the answer works as normal text or Markdown, use that instead. Rich UI must add a useful visualization or meaningful interaction that Markdown cannot provide; changing fonts, colors, columns, or decoration alone does not count.

## Authoring a reply

Call `reply/html` through Cordis with an `html` string and an optional short `title`. Copy the returned `markdown` field into the visible assistant response. The tool prepares the reply; calling it alone does not display content. Agents can also emit an `alto-html` fence directly. Ordinary `html` fences continue to display source code.

The HTML should read as an answer in the conversation flow. Use typography, whitespace, diagrams, and inline controls to organize it. Avoid a generic enclosing card, box, background panel, or title bar, and do not repeat the answer in a plain-text introduction followed by an embedded widget. Surrounding prose should add context that the HTML does not already contain. The optional `title` supplies an accessible name; it does not create a visible header.

The HTML can include inline CSS and JavaScript. Use semantic elements, labeled keyboard controls, responsive sizing, and readable contrast. Alto supplies a base font and a transparent body with zero margin and padding, so the answer aligns with the surrounding conversation. Its theme variables are `--alto-bg`, `--alto-fg`, `--alto-muted`, `--alto-border`, `--alto-accent`, and `--alto-font`. Inherit the defaults; use `--alto-bg`, the conversation background, only when an intentional area needs a fill. Controls change only the local reply; they do not run commands or save changes to the workspace.

The plugin accepts at most 60,000 characters per document. A pause of 250 milliseconds in streamed content triggers a preview. The frame grows with its contents up to 640 pixels, then scrolls internally. Source and preview share the same frame instance, so switching views preserves local interaction state. The HTML source remains in the saved conversation and rebuilds its preview when reopened; JavaScript state does not persist across reopening.

## Execution boundary

The server fiber owns a loopback HTTP listener on a random port and serves documents at random capability URLs. Each document uses an opaque origin through both an iframe sandbox and an HTTP Content Security Policy sandbox. Only script execution is enabled. The generated code cannot access Alto's document, session, filesystem, or host tools. It receives theme values and can report its height; these messages cannot invoke host actions.

The document policy blocks external scripts, images, styles, connections, embedded frames, and form submissions. Inline scripts, inline styles, and data images are supported. This policy is not a complete network isolation mechanism: code can navigate its own frame, including sending data already present in its reply. Top-level navigation and popups remain sandboxed. A separate origin also does not guarantee a separate renderer process; a script that loops or allocates excessively can affect Alto's responsiveness. The experiment therefore assumes agent-authored local interactions, rather than arbitrary untrusted applications.

Documents stay in bounded memory: at most 128 documents, expiring after one hour. Unloading the plugin closes its listener, clears stored documents, removes its tool and prompt guidance, and restores ordinary code rendering for `alto-html` fences. No shell or conversation implementation changes are required.
