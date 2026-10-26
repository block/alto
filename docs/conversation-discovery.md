# Conversation discovery

Use Cordis tools to find and inspect saved conversations without operating the UI:

- `workspace/list_tabs` returns current tab names and exact pane and conversation IDs.
- `conversation/search` accepts `query` and an optional `scope`. The default, `titles`, searches tab-name history, chat titles, and saved previews. `messages` also searches saved user and assistant text. Results include IDs, matching fields, excerpts, current tabs, and `nextCursor`.
- `conversation/read` reads recent saved messages for an `id`. Pass `nextCursor` back as `cursor` for older content. It omits tool logs and reasoning, marks truncated messages, and does not open or resume an agent.
- `conversation/open` focuses an existing pane for an `id`, or creates a new full-size tab. Optional `placement` values `right` and `below` open a split beside the invoking chat. The tool waits for the browser to report the pane identity and never sends a prompt.

For example, search for `jptrv` with the default scope. If the tab name is unknown, search for `Japan` with `scope: "messages"`, read the best candidate by ID, then open that ID only when requested.

The History plugin injects this workflow as application context into each turn prepared by Alto, including Codex and local ACP chats. It explains Cordis discovery and invocation, title and message searches, pagination, incomplete-search warnings, reading candidates, and reopening exact IDs. The guidance is registered and removed with the tools, preserves other turn context, and stays below the per-entry context limit. Remote sessions using their own harness keep that harness's instructions.

Workspace persistence records tab names against the conversations currently in their panes in `.codex-cordis/workspace-tab-history.json`. Names survive renames, closing tabs, and app restarts. History's search bar uses the same saved names. Existing open tabs are recorded at activation; names lost before activation cannot be reconstructed automatically. Several conversations may share a tab name, so results retain all matching IDs.

Title queries use native metadata filtering and the small local name index. Message queries use paginated native search with a short cache; ACP content is read from saved chats without reconnecting remote agents. Search failures are returned as warnings rather than reported as complete empty results.
