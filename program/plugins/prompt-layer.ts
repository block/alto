import type {
  HarnessPlugin,
  TurnDraft,
  UiShell,
  UiShellNode,
} from '../../src/server/plugin-api.js'

interface PromptLayerConfig {
  context?: string
}

interface SlotContract {
  name: string
  presentation: 'cards' | 'plain' | 'inline'
  direction: 'row' | 'column'
  grow: boolean
  scroll: 'none' | 'x' | 'y' | 'both'
}

function outletsIn(node: UiShellNode, outlets: string[] = []): string[] {
  if (node.type === 'outlet') outlets.push(node.name)
  if (node.type === 'box') {
    for (const child of node.children) outletsIn(child, outlets)
  }
  return outlets
}

function slotsIn(node: UiShellNode, slots: SlotContract[] = []): SlotContract[] {
  if (node.type === 'slot') {
    slots.push({
      name: node.name,
      presentation: node.presentation ?? 'cards',
      direction: node.direction ?? 'column',
      grow: node.grow ?? false,
      scroll: node.scroll ?? 'none',
    })
  }
  if (node.type === 'box') {
    for (const child of node.children) slotsIn(child, slots)
  }
  return slots
}

const authoringGuidance = `Cordis plugin authoring contract:
- When program changes are already written in staging, pass files[].sourcePath to cordis_reprogram instead of generating the file contents again. Describe that tool to find its staging directory. Alto reads the staged files and retains the same approvals, validation, and rollback. Never edit live program files directly.
- Before adding UI, inspect cordis_runtime_status for the current shell, surfaces, contributions, and IDs.
- Every cordis.json entry must declare a stable id, a concise product-facing name, and a brief description of the behavior it owns. Never use module paths or implementation filenames as display copy.
- Visible behavior belongs in browser Cordis modules, not src/client/App.tsx. A profile entry may declare module for server behavior, client for browser behavior, or both. Pair a server-owned surface descriptor with a client module that calls ctx.clientUi.registerSurface(ctx, surfaceId, Component). The client component owns its React state, shortcuts, interactions, and presentation.
- Import CSS as text in the client module and install it with ctx.clientUi.registerStyle(ctx, stableId, String(styles)). Surface and style registrations are fiber-owned: disable, replace, or fail the entry and Cordis tears both down together. Browser modules may import React and Cordis, but privileged filesystem/process work stays in the server module. Reuse the stable clientStyles primitives and core design tokens before duplicating pane, header, overlay, floating-panel, or icon-button styling. Put a feature class beside the shared class and keep feature overrides in the plugin stylesheet; core primitives use zero-specificity :where() selectors, so ordinary plugin CSS wins.
- Rich Markdown code blocks are renderer plugins. Inject clientMarkdown and call ctx.clientMarkdown.registerCodeBlock(ctx, { id, component, languages, priority }) to replace their rendering without coupling syntax highlighting, copy controls, or themes to the conversation surface. Omit languages for a catch-all renderer; provide lowercase fenced-code languages such as ["mermaid"] for a specialized renderer. Resolution follows priority and then falls through to the next matching renderer, so unloading a specialized fiber restores the ordinary code block or plain fallback.
- Math follows the same lifecycle. A client fiber can call ctx.clientMarkdown.registerMath(ctx, { id, component, remarkPlugins, priority }); keep its parser plugins, renderer, fonts, and registered styles in that fiber so disabling it restores literal Markdown cleanly.
- The fixed clientHost is transport, a raw event journal, native app-server commands, and one generic call method. The default clientSession projection is a replaceable browser plugin. New feature state and actions must not add feature cases to src/client: register JSON state and methods with ctx.clientExtensions.registerState/registerMethod in the server fiber, subscribe to ctx.clientHost in the browser fiber, read snapshot.extensions, and call ctx.clientHost.call(name, payload). Both server registrations unload with their owner.
- External workspace catalogs belong in their consuming server plugin. Register them with ctx.projects.registerSource(ctx, id, snapshot); names, roots, explicit thread assignments, and projectless threads update atomically and disappear with the owning fiber.
- Treat the browser kernel as mounting and recovery infrastructure only. Do not add feature switches, component implementations, plugin state, or feature CSS to the kernel. A feature-specific renderer in src/client is a migration bug unless it is a reusable library imported by a program client module.
- Slots are the clean default for small additive widgets, not a capability boundary. Prefer a compatible live slot when the user wants an addition without a redesign. Never guess a slot name.
- Outlets are exclusive replacement points for full shell subtrees. Register one with ctx.ui.registerShellRegion(ctx, { id, outlet, root }); its fiber must also own the surfaces referenced by root. Disable the current outlet owner before installing a replacement. Regions may contain boxes, surfaces, slots, and contributions, but not nested outlets.
- Workspace Layout is the only spatial compositor. Plugins register pane kinds such as Canvas, Terminal, or Browser with clientWorkspaceLayout; the compositor supplies tabs, splits, focus, full screen, resizing, persistence, and teardown without knowing feature behavior.
- Canvas is a registered workspace pane containing free-form pages. A browser child can inject clientCanvas and call ctx.clientCanvas.registerPage(ctx, { id, title, component }) to own one entire Canvas tab, or registerDockItem(ctx, { id, component, order }) for a compact control above it. A page that belongs only in selected workspaces must provide availableIn: (workspace) => boolean; Canvas applies that predicate before automatic creation or restoration, so page state cannot leak into unrelated workspaces. Do not wrap page content in cards or recreate a widget board: the registered component receives the full active page and page-scoped storage. Each project workspace owns its page order, open/closed pages, and active page; disabling a page fiber removes that tab and re-enabling it restores the independently owned page. Dock props expose page selection, creation, close, and reorder actions so the tabs fiber can be replaced independently.
- A Canvas page must respond to the pane's full container rather than assuming a fixed width; wrap or truncate constrained content and use ResizeObserver only when CSS cannot express the behavior.
- Cross-feature shortcuts belong in a small browser integration fiber that injects clientHotkeys and the feature service, then calls ctx.clientHotkeys.registerAction(ctx, action). The action and its rebinding UI disappear with that fiber; do not install feature key listeners in the shell.
- Workspace Layout is a compositor, not a second shell. Pane-local UI belongs in a child fiber that injects clientWorkspaceLayout and calls registerPaneAddon for pane-title, after-header, conversation-overlay, or before-composer. Workspace-tab badges use registerTabAddon and receive the tab's chat thread IDs. Use the order field when several fibers share a placement. A plugin that must address every visible chat can inspect paneTargets() and call focusPane(workspaceId, paneId); app-wide plugins should continue to use the stable clientSession, which routes to the focused pane without reopening that chat in a duplicate session.
- A layout that replaces the stock conversation subtree must preserve registered header-left, header-right, and main contributions. Render those contributions in the corresponding layout regions instead of hiding them with the replaced shell subtree. Keep inactive workspace views mounted but hidden: chat sessions, drafts, browser views, and native terminal processes are live workspace state and must survive tab switches. Dispose that state only when its pane, tab, plugin, or application is actually closed.
- A requested UI change may replace or remove any live shell box, layout, theme, surface, region, or contribution. For exact placement, put { type: "contribution", id, presentation } directly in the shell tree and update shell-ui.ts and the owning plugin in the same transaction. Only the transport and recovery kernel stays fixed.
- Match the selected presentation. inline is a single compact toolbar row: omit title and description, use one row, short text, and at most one or two small actions; do not put metrics, lists, groups, or inputs there. plain is a page-aligned section. cards is a self-contained panel.
- Keep the default UI clean: make the smallest layout change that satisfies the request, and do not restructure unrelated regions unless the user asks for a redesign.
- Composer behavior is surface data. Set its capabilities array from skills, markdown, images, and files; omit any capability the requested interface should not expose.
- Cross-cutting composer submission behavior belongs in a browser plugin. Register it with ctx.clientUi.registerSubmitMiddleware(ctx, middleware, { activeTurn: true }) when it accepts input during a running turn. The middleware receives the requested queue or steer mode and request.target for the exact pane-owned session. Use the target's threadId, activeTurn, send, and steer operations instead of assuming the app-wide focused session; consume the draft or call next(draft). Cordis removes the middleware with its owning fiber.
- Keep contribution IDs and action IDs stable and use order for placement. Declarative UiNode values are useful for small generic data panels; use a browser client renderer when behavior or appearance is feature-specific. Avoid fixed widths, and let text truncate before it expands a toolbar or rail.
- After applying UI work, verify the live result at its normal width and a narrow width. It must not enlarge its parent header, cover conversation content, or push controls off-screen.
- UI, client-extension, and ctx.on registrations are already owned effects. Put timers, watchers, subprocesses, and other external resources inside ctx.effect() and return cleanup or abort logic. Guard async work so it cannot call registration.update() after disposal.
- Declare every inject and provide edge. Use a nested profile entry when several fibers share isolation or interception; do not rebuild unrelated entries.
- Read docs/plugin-authoring.md when the change adds a new fiber or visible contribution.`

function shellContext(shell: UiShell | undefined): string {
  const slots = shell ? slotsIn(shell.root) : []
  const outlets = shell ? outletsIn(shell.root) : []
  const liveSlots = slots.length
    ? slots.map((slot) => (
        `- ${slot.name}: ${slot.presentation}, ${slot.direction}`
        + `${slot.grow ? ', grows' : ''}`
        + `${slot.scroll === 'none' ? '' : `, scroll=${slot.scroll}`}`
      )).join('\n')
    : '- No live slots. Add the required slot to the shell in the same transaction as the widget.'
  const liveOutlets = outlets.length
    ? outlets.map((outlet) => `- ${outlet}: exclusive shell region`).join('\n')
    : '- No live outlets. Add one to the shell before registering a replaceable region.'

  return `Current live shell: ${shell?.id ?? 'none'}
Current live slots:
${liveSlots}
Current live outlets:
${liveOutlets}`
}

// app-server truncates each additionalContext value above 1,000 approximate
// tokens, calculated as 4,000 UTF-8 bytes. Keep the original text intact across
// entries, preferring line boundaries so individual authoring rules stay together.
function applicationContext(key: string, text: string): NonNullable<TurnDraft['additionalContext']> {
  const entries: NonNullable<TurnDraft['additionalContext']> = {}
  let remaining = text
  let part = 1
  while (remaining) {
    let bytes = 0
    let end = 0
    let lineEnd = 0
    for (const character of remaining) {
      const size = Buffer.byteLength(character, 'utf8')
      if (bytes + size > 4_000) break
      bytes += size
      end += character.length
      if (character === '\n') lineEnd = end
    }
    if (end < remaining.length && lineEnd > 0) end = lineEnd
    const name = part === 1 ? key : `${key}_${String(part).padStart(3, '0')}`
    entries[name] = { kind: 'application', value: remaining.slice(0, end) }
    remaining = remaining.slice(end)
    part += 1
  }
  return entries
}

const promptLayer: HarnessPlugin<PromptLayerConfig> = (ctx, config) => {
  const context = config.context?.trim()
  if (!context) return

  ctx.on('codex/turn/prepare', async (draft: TurnDraft, next) => {
    const prepared = await next()
    return {
      ...prepared,
      additionalContext: {
        ...prepared.additionalContext,
        ...applicationContext('cordis_program', context),
        ...applicationContext('cordis_authoring', authoringGuidance),
        ...applicationContext('cordis_shell', shellContext(ctx.ui.snapshot().shell)),
      },
    }
  })
}

promptLayer.inject = ['turnProgram', 'ui']

export default promptLayer
