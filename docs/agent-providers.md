# Agent providers

Alto can open Codex, Claude, Gemini, and Pi chats from the Agent row in the composer's model picker. An agent is fixed after the first message. Select a workspace before choosing the agent: its local process runs in that checkout. Codex continues to use App Server; ACP conversations use the same composer, transcript, approvals, file review, progress, and history components.

Selecting an ACP agent changes the draft; its process and session start when the first prompt is sent. Model, reasoning, and mode options come from the agent once connected. Claude, Gemini, and configured Pi models also offer choices before the first message; Alto validates and applies the selection before submitting the prompt. Other ACP configuration selectors appear in the same menu. Alto restores saved choices when resuming a session if the agent still offers them.

**Settings → Model & reasoning → New chat defaults** selects the default agent and location for newly created chats, including Codex, Claude, Gemini, Pi, and registered remote providers. Alto remembers separate model and reasoning choices for each provider. Changing these defaults does not change an existing chat. Reasoning choices follow the selected model and the options its provider supports; Gemini ACP does not expose a reasoning setting, so Alto displays **Agent default**.

Opening settings or selecting draft choices does not start an agent or provision a remote machine. **Load models** explicitly opens and closes a temporary local ACP session to retrieve its choices without sending a prompt. Remote providers use their available catalogs without provisioning a workspace from settings.

Local ACP chats use Alto's prompt preparation hooks for application context. Claude receives trusted instructions through its adapter's `systemPrompt.append`, preserving the Claude Code preset and native tools. Live shell state and later changes travel with prompts. Untrusted reference context never enters the system prompt. Unchanged entries are omitted; resumed chats and the first prompt after a completed compaction receive the current context again. Other ACP agents receive the context as standard prompt text, without Claude-specific metadata. Remote providers retain their own context handling.

Cordis changes can use `files[].sourcePath` instead of inline `content`. The path is relative to `.codex-cordis/staging` in the resolved Alto runtime; describe `cordis_reprogram` for its exact location. Alto reads the staged contents once and uses the existing permission, validation, and atomic application path. An approval proposal retains those bytes even if the staged file changes before approval. This avoids making an agent generate a second copy of files it has already written. Source paths cannot escape the staging directory, including through symlinks.

## Native Codex model providers

Native Codex can use configured model providers through the `codex-models` Cordis entry. Each route supplies a model choice, its `modelProvider`, and supported App Server configuration, including provider authentication and an optional model catalog. Routes add to the existing model list without changing the default model. Credentials remain in Codex's configured auth helper.

Choose the model before starting a new chat. A saved chat keeps its provider; its model picker offers models for that provider. Reopening it restores its saved model and reasoning effort while loading the provider configuration it needs. Local routes are not advertised to remote Codex agents.

## Local setup

Codex CLI is optional. Alto starts `codex app-server` when you send a Codex
message, open a saved Codex chat or its history, request the Codex model list,
or use a Codex feature such as Code Tour generation or a local scheduled task.
Selecting another agent and chatting with it does not start Codex. To use
Codex, install its CLI on your `PATH` and run `codex login`. If startup fails,
you can fix the installation and retry without restarting Alto.

The default profile runs `npx --yes @agentclientprotocol/claude-agent-acp@0.81.0` for Claude and `npx --yes pi-acp@0.0.33` for Pi. These versions are pinned: an older Claude adapter can advertise models that its bundled Claude runtime cannot use. The first launch may download the adapter; subsequent launches can reuse npm's cache, but npm may still consult the registry. Claude's adapter also starts to discover saved history when Alto opens; discovery does not create a session or send a prompt. Other ACP providers start when their first session is needed.

Authenticate the local agent using its own CLI before selecting it in Alto. Pi additionally requires a local `pi` executable; the adapter starts it in RPC mode. Configure another ACP executable with a separate `plugins/acp-provider.ts` entry in `program/cordis.json`, using a unique `config.id`, label, command, and optional args, cwd, or env.

If a package filter or registry outage prevents `npx` from starting, configure the provider to run an already installed adapter directly. For example, use `command: "node"` with `args: ["/absolute/path/to/@agentclientprotocol/claude-agent-acp/dist/index.js"]`, ensuring that installation has the pinned version above. History discovery failures appear in the History pane and can be retried after fixing the launcher.

An ACP entry can supply `initialConfig` to show model choices before starting its process. The connected agent's catalog replaces these choices and remains authoritative. This does not configure or authenticate models in the underlying CLI.

Gemini uses the local `gemini --acp` executable. Install [Gemini CLI](https://geminicli.com/docs/get-started/installation/) and run `gemini` once to configure authentication before sending a Gemini chat in Alto. The process inherits the environment available to Alto. The profile sets `GEMINI_CLI_NO_RELAUNCH=true` so Alto owns the agent process directly and stopping the provider does not leave Gemini's launcher child running. Launch and authentication failures include setup instructions in the affected chat.

Gemini supports named model selection in the composer's **Model** menu after choosing **Agent → Gemini**, and in the new chat defaults page. **Agent default** keeps the CLI-configured model; selecting a named model, such as Gemini 4 Argon, applies that choice before the first prompt. Alto supports Gemini's older `models` catalog and `session/set_model` operation as well as standard ACP `configOptions` when supplied. Configuration failures appear in the affected chat. Gemini does not expose a separate reasoning-effort control through ACP, and Alto does not invent one. Gemini still uses the shared streaming transcript, approvals, attachments, Cordis bridge, queue, cancellation, and saved-session flow. It does not advertise Alto's steering or child-session extensions.

A live check with Gemini CLI `0.62.0-preview.0` completed a prompt and stopped the process cleanly. Reopening the same session after restarting the provider failed with `No previous sessions found for this project`, despite the CLI advertising `loadSession`. Alto retains its transcript and reports the resume failure. Resume on that CLI version is not verified; no fallback silently starts a replacement conversation.

To use DeepSeek through Pi, start a new chat and choose **Agent → Pi**, then **DeepSeek V4.1 Flash 1017 (Databricks)**. The model must also be configured in Pi's local `~/.pi/agent/models.json` as `system.ai.deepseek-v4-1-flash-1017`, using the `openai-responses` API and the production Databricks AI Gateway at `https://block-lakehouse-production.cloud.databricks.com/ai-gateway/mlflow/v1`. The Alto model value includes the provider prefix: `databricks/system.ai.deepseek-v4-1-flash-1017`. Authentication stays in Pi's existing Databricks configuration, including its OAuth refresh helper.

Responses API compatibility does not imply support for OpenAI-specific features. Pi extensions must avoid adding `service_tier: "priority"` or OpenAI-hosted `web_search` tools to this model. Alto preserves enabled Pi extensions; an extension requiring unsupported RPC interactions can still prevent a session from working. The current Pi adapter does not connect ACP-supplied MCP servers, so Alto's Cordis tools are unavailable in Pi chats.

Claude was tested with the real local adapter.

## Shared UI behavior

| Feature | ACP behavior |
| --- | --- |
| Model, reasoning, agent mode | Uses advertised session config options and supports older model and mode catalogs in the same composer picker. Claude, Gemini, and configured Pi models offer choices before the first message. Gemini supports named models but exposes no separate reasoning setting through ACP. |
| New chat defaults | Settings remembers a default provider and separate model and reasoning choices per provider. Only supported reasoning levels appear; existing chats retain their selections. |
| Streaming text and thoughts | Retained in the transcript, grouped by turn, with a final answer and elapsed time on completion. |
| Tool output | Commands and tool calls use the existing activity rows. Text output and status changes are retained. |
| File edits | ACP old/new file content becomes a unified diff with actual changed-line counts in Alto's file review UI. |
| Plans and progress | Plans update the transcript and shared progress pill; file changes feed the same review affordance. |
| Permission requests | The agent's offered choices appear in Alto's approval card. Ask waits for a decision; Full access automatically selects an allow option. |
| Questions | ACP form elicitation uses Alto's question styling, including single and multiple choices, free text, numbers, and booleans. Answers are retained in history. Full access never answers questions automatically. |
| Waiting and cancellation | A question or approval changes the turn to a waiting state and pauses the working shimmer. Stop cancels pending requests and the agent turn. |
| Attachments | Sends images when supported and local files as resource links. Agent image responses render in chat. |
| Skills | Local ACP chats can select Alto skills when the available catalog belongs to that checkout. Selected skills become explicit instructions with their file paths. Remote chats do not receive local skill paths. Claude also retains its own skill loading. |
| Queue | Saved, editable, reorderable messages appear in the usual queue and move into chat once when started. The server releases them after normal completion, even when the pane is closed. Stop, failure, and a server restart pause delivery. |
| Live steering | Claude advertises its steering extension. The existing queue's Steer button injects the message into the active turn. If the turn has just finished, Alto starts an ordinary next turn and records the message once. |
| Subagents | Claude's negotiated child-session events populate Alto's Agents panel, including nested transcripts, current status, and parent-scoped approvals. Background tasks advertise individual Stop support. |
| Cordis tools | ACP agents with MCP support receive an authenticated loopback MCP server exposing the existing Cordis dispatcher. List/describe/invoke resolve the current tool owners. Pi's current adapter does not connect this server. |
| History | Persists the complete transcript and the exact provider/session/workspace identity. Reopening uses ACP `session/load`; unsupported resumption reports an error rather than silently starting another conversation. |
| Connection failures | End streaming, clear pending decisions, retain the draft or transcript, and show an error in the affected chat. A later send can reconnect and resume. |

Send while Claude is working to queue a message, then choose **Steer** to inject it immediately. Steering and removal from the saved queue happen together on the server, so a finishing turn cannot also deliver that message as a new prompt. Agents without the advertised extension keep Steer disabled.

Ask Claude to delegate work, then open **Agents** to inspect its children without leaving the parent chat. Child permissions and questions appear in that chat. The current Claude adapter does not advertise independent cancellation for native child agents; Alto disables their individual Stop button and offers **Stop parent turn** while the parent is running. Background shell tasks expose a separate stop operation. Completed children leave the active count, and their transcripts remain saved. Agent-to-agent messaging and independently resuming a child are not supported by this adapter.

The ACP Ask/Full choices govern requests the agent sends to Alto. They do not add a Codex sandbox, override the agent's own permission mode, or run Codex's automatic approval reviewer. An inherited Auto setting waits for approval like Ask. Children retain the permission mode from their creation; they cannot gain Full access just because a later parent turn uses it.

The Cordis bridge binds to `127.0.0.1` on an ephemeral port, requires a random per-chat bearer token, and rejects browser-origin requests. Tokens stay out of saved chat state. The host supplies the chat ID, active turn ID, and captured permission mode; MCP arguments cannot override them. Calls require a running parent turn. If an older child is still active during a later turn, Cordis mutations require approval because Claude shares the parent's MCP connection with its children. Closing the chat fiber revokes the bridge and closes provider sessions so a resumed chat gets a fresh connection.

Cordis `workspace/open_pane` and new local `work/select` / `work/create` panes retain the current local agent provider. ACP sessions cannot change their working directory in place, so work-target changes must open a new local pane. Remote execution, native scheduled jobs, and Codex fork controls remain Codex-specific. Agent slash commands can be typed into the composer; usage and command metadata are retained, but a command picker and context-usage display are not added here.

## Existing Claude Code conversations

Alto discovers local Claude Code conversations through ACP `session/list` and includes them in the workspace sidebar and History pane alongside Codex and Alto-created chats. The default Agent Chats configuration lists `claude` in `historyProviders`; set that list to `[]` to disable automatic discovery, or include another local ACP provider that supports session listing. Remote providers are not queried by this discovery flow.

Discovery reads session metadata only. Selecting a previously unopened conversation calls ACP `session/load`, replays its user, assistant, and tool messages, and saves the transcript in Alto's local store. Subsequent prompts continue the original provider session in its original working directory. Imported conversations start with Ask permissions. The History pane's Refresh action queries Claude again, so conversations created outside Alto can appear without restarting the application. Claude history remains available if Codex history cannot be loaded; the pane shows a notice for the unavailable provider.

Native provider and session IDs identify each conversation. Alto uses stable chat IDs for discovered sessions and reuses the IDs of conversations already saved locally, preventing duplicates after refresh or restart. Opening and replaying a conversation preserves its history timestamp. A failed load preserves the existing transcript; a discovery failure preserves the previous catalog and appears as a notice in the History pane. This discovery concerns local Claude Code sessions rather than the Claude web application's history.

## Ownership and persistence

`AgentRegistry` ties each process provider to its Cordis fiber. `acp-provider.ts` handles ACP transport and translates configuration, text, tools, plans, permissions, questions, usage, steering, and child-session lifecycle events. `agent-chats.ts` owns the saved conversations and submission queues. `agent-session.client.ts` adapts those conversations to Alto's existing pane-owned session interface; native Codex calls keep their existing route.

ACP chat IDs use a separate namespace and never go to Codex's thread or queue methods. Decisions are checked against both the pending request and its owning chat. Cancelling, disconnecting, or unloading resolves pending protocol requests and ends streaming. Reloading the chat fiber closes its active sessions before persisting them as interrupted.

Files live under `.codex-cordis/agent-chats` in the Alto checkout. Writes are serialized per file and use rename after writing a private temporary file. Streaming saves are debounced; the UI receives coalesced updates. Configuration projections are reused while text streams so the model picker does not rebuild for each token.

## Validation

The regression tests cover real ACP SDK connections, permission and question replies, invalid/stale decisions, model configuration, cancellation, identity-preserving reloads, complete transcripts, file diffs, queue persistence/order/draining, pane navigation, and native Codex routing. The separate Alto instance was used for real Claude prompts, model/effort changes, questions, waiting state, queued follow-ups, file approvals, and history reloads. A real local Claude integration test also exercised authenticated Cordis list/describe/invoke, steering during a tool call, and native child-session transcripts. Regression tests cover the finishing-turn steering race, nested approvals, task cancellation boundaries, permission capture, token revocation, and live tool replacement.

Defaults tests cover provider-specific persistence, remote Codex's shared model and reasoning catalog, Claude model-dependent effort levels and version aliases, and Gemini named model selection. Hidden Electron checks exercise the settings controls at normal and narrow widths, preserve active chat selections, and verify that viewing settings neither starts model discovery nor provisions a remote agent.

Pi checks cover configured choices before process startup, snapshot isolation, live catalog replacement, and validation against the connected model catalog. A live check with Pi `1.3.0` and `pi-acp` `0.0.33` selected DeepSeek V4.1 Flash 1017 through production Databricks, streamed a file-read tool call and its answer, and retained the result in a second turn. The composer was checked at normal and narrow pane widths.

At the starting revision, four existing checks fail in `client-styles.test.ts`, `program-profile.test.ts`, and `turn-intervention-browser.test.ts`. The same failures were reproduced from an archive of the unchanged HEAD. They concern old shimmer expectations and profile outlet metadata, not ACP behavior.

Protocol references: [Gemini ACP](https://geminicli.com/docs/cli/acp-mode/), [session configuration](https://agentclientprotocol.com/protocol/v1/session-config-options), [Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp), and [Pi adapter](https://github.com/svkozak/pi-acp).
