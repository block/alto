import { Gauge } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clientStyles, type BrowserPlugin, type ClientUiService } from '../../src/client/plugin-api.js'
import { AGENT_SWITCHER_ACTION, AGENT_SWITCHER_OVERLAY, AGENT_SWITCHER_TOGGLE } from './agent-switcher-api.js'
import type {} from './composer-api.js'
import type {} from './hotkeys-api.js'
import type { ClientSessionService } from './session-api.js'
import { agentSelection } from './ui/agent-selection.js'
import { ComposerModelPicker, type ComposerPickerFocus } from './ui/composer-model-picker.js'
import { ConversationPaneOverlay } from './ui/conversation-overlay.js'
import { currentSessionModelSummary } from './ui/model-defaults.js'
import styles from './agent-switcher.css'

const TOGGLE_MOUNT = `[data-ui-contribution="${AGENT_SWITCHER_TOGGLE}"]`

function useToggleMount(ui: ClientUiService): HTMLElement | null {
  const revision = useSyncExternalStore(ui.subscribe, ui.snapshot)
  const [mount, setMount] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const sync = (): boolean => {
      const target = document.querySelector<HTMLElement>(TOGGLE_MOUNT)
      setMount(current => current === target ? current : target)
      return target !== null
    }
    if (sync()) return
    const observer = new MutationObserver(() => { if (sync()) observer.disconnect() })
    observer.observe(document.querySelector('.shell-kernel') ?? document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [revision])
  return mount
}

function AgentSwitcherChrome({ session, ui }: { session: ClientSessionService; ui: ClientUiService }): ReactNode {
  const mount = useToggleMount(ui)
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const activeOverlay = useSyncExternalStore(ui.overlays.subscribe, ui.overlays.snapshot)
  const summary = currentSessionModelSummary(state)
  const agent = agentSelection(state.providers ?? [], state.providerId ?? 'codex', state.agentConfig)
  const open = activeOverlay === AGENT_SWITCHER_OVERLAY
  const label = `Model and reasoning: ${agent.label} · ${agent.locationLabel} · ${summary.model} · ${summary.effort}`
  return mount ? createPortal(
    <button className={`${clientStyles.iconButton} agent-switcher-trigger`} type="button"
      data-hotkey-action={AGENT_SWITCHER_ACTION} aria-label={label} aria-haspopup="dialog"
      aria-controls="agent-switcher-dialog" aria-expanded={open} title={`${label}\n⌘⇧M or Alt M`}
      onClick={() => ui.overlays.toggle(AGENT_SWITCHER_OVERLAY)}><Gauge size={15} /></button>,
    mount,
  ) : null
}

export function AgentSwitcherDialog({ session, ui }: { session: ClientSessionService; ui: ClientUiService }): ReactNode {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const [focus, setFocus] = useState<ComposerPickerFocus>('models')
  // Capture before the shared picker moves focus into its selected model.
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const close = useCallback(() => ui.overlays.close(AGENT_SWITCHER_OVERLAY), [ui.overlays])
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }, [])

  return <ConversationPaneOverlay className={`${clientStyles.overlayLayer} agent-switcher-layer`} data-picker-boundary="" onMouseDown={close}>
    <div id="agent-switcher-dialog" className="agent-switcher-panel" onMouseDown={event => event.stopPropagation()}>
      <ComposerModelPicker presentation="dialog" open focus={focus} onFocusChange={setFocus}
        onOpenChange={open => { if (!open) close() }}
        models={state.models ?? state.harness?.codex.models ?? []}
        model={state.session.model} effort={state.session.effort}
        providers={state.providers ?? []} providerId={state.providerId ?? 'codex'}
        providerLocked={Boolean(state.threadId && state.activities.length) || state.turn.tag !== 'idle'}
        agentConfig={state.agentConfig ?? []} disabled={!state.connected}
        onModelChange={model => session.setModel(model)} onEffortChange={effort => session.setEffort(effort)}
        onProviderChange={(id, selection) => session.setProvider?.(id, selection)}
        onAgentConfigChange={(id, value) => session.setAgentConfig?.(id, value)}
        {...((!state.providerId || state.providerId === 'codex') && session.loadModels
          ? { onModelsRequest: async () => { await session.loadModels?.() } } : {})}
      />
    </div>
  </ConversationPaneOverlay>
}

function AgentSwitcherSurface({ session, ui }: { session: ClientSessionService; ui: ClientUiService }): ReactNode {
  const activeOverlay = useSyncExternalStore(ui.overlays.subscribe, ui.overlays.snapshot)
  return activeOverlay === AGENT_SWITCHER_OVERLAY ? <AgentSwitcherDialog session={session} ui={ui} /> : null
}

const agentSwitcherClient: BrowserPlugin = ctx => {
  const ui = ctx.clientUi
  const session = ctx.clientSession
  const Root = () => <><AgentSwitcherChrome session={session} ui={ui} /><AgentSwitcherSurface session={session} ui={ui} /></>
  ui.registerRoot(ctx, 'agent-switcher-root', Root)
  ui.registerStyle(ctx, 'agent-switcher', String(styles))
  ctx.clientHotkeys.registerAction(ctx, {
    id: AGENT_SWITCHER_ACTION,
    label: 'Choose model and reasoning',
    detail: 'Switch the focused chat’s agent, model, and reasoning effort.',
    category: 'Agent',
    binding: { kind: 'leader', key: 'm' },
    aliases: [{ kind: 'global', key: 'm', meta: true, shift: true }],
    run: () => ui.overlays.toggle(AGENT_SWITCHER_OVERLAY),
  })
  return () => ui.overlays.close(AGENT_SWITCHER_OVERLAY)
}

// The composer owns the shared picker’s styling and interaction contract.
agentSwitcherClient.inject = ['clientHotkeys', 'clientSession', 'clientUi', 'clientComposer']
agentSwitcherClient.resources = { provides: { roots: ['agent-switcher-root'] } }

export default agentSwitcherClient
