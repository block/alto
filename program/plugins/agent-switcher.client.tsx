import { Check, Gauge, LockKeyhole, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clientStyles, type BrowserPlugin, type ClientUiService } from '../../src/client/plugin-api.js'
import { errorMessage } from '../../src/shared/protocol.js'
import { AGENT_SWITCHER_ACTION, AGENT_SWITCHER_OVERLAY, AGENT_SWITCHER_TOGGLE } from './agent-switcher-api.js'
import {
  applyAgentPickerSelection,
  buildAgentPickerOptions,
  filterAgentPickerOptions,
  initialAgentPickerKey,
  nextEnabledAgentPickerKey,
  preferredAgentEffort,
  type AgentPickerOption,
} from './agent-switcher-model.js'
import type {} from './hotkeys-api.js'
import type { ClientSessionService } from './session-api.js'
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
      setMount((current) => current === target ? current : target)
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
  const provider = state.providers?.find((candidate) => candidate.id === (state.providerId ?? 'codex'))?.label
    ?? (state.providerId === 'codex' || state.providerId === undefined ? 'Codex' : state.providerId)
  const open = activeOverlay === AGENT_SWITCHER_OVERLAY
  return mount ? createPortal(
    <button
      className={`${clientStyles.iconButton} agent-switcher-trigger`}
      type="button"
      data-hotkey-action={AGENT_SWITCHER_ACTION}
      aria-label={`Model and reasoning: ${provider} · ${summary.model} · ${summary.effort}`}
      aria-haspopup="dialog"
      aria-controls="agent-switcher-dialog"
      aria-expanded={open}
      title={`Model and reasoning: ${provider} · ${summary.model} · ${summary.effort}\n⌘⇧M or Alt M`}
      onClick={() => ui.overlays.toggle(AGENT_SWITCHER_OVERLAY)}
    >
      <Gauge size={15} />
    </button>,
    mount,
  ) : null
}

function optionDomId(key: string): string {
  return `agent-switcher-option-${key.replace(/[^a-z0-9_-]/gi, '-')}`
}

export function AgentSwitcherDialog({ session, ui }: { session: ClientSessionService; ui: ClientUiService }): ReactNode {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const options = useMemo(() => buildAgentPickerOptions(state), [state])
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState(() => initialAgentPickerKey(options))
  const initial = options.find((option) => option.key === selectedKey)
  const [effort, setEffort] = useState<string | undefined>(() => initial ? preferredAgentEffort(state, initial) : undefined)
  const [problem, setProblem] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const filtered = useMemo(() => filterAgentPickerOptions(options, query), [options, query])
  const selected = options.find((option) => option.key === selectedKey)
    ?? filtered.find((option) => option.key === selectedKey)
    ?? filtered[0]
    ?? options[0]
  const summary = currentSessionModelSummary(state)
  const close = useCallback(() => ui.overlays.close(AGENT_SWITCHER_OVERLAY), [ui.overlays])

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const frame = window.requestAnimationFrame(() => input.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [close])

  useEffect(() => {
    if (!filtered.length) return
    if (filtered.some((option) => option.key === selectedKey)) return
    setSelectedKey((filtered.find((option) => !option.disabledReason) ?? filtered[0])?.key)
  }, [filtered, selectedKey])

  useEffect(() => {
    if (!selected) return
    setEffort((current) => (
      current && selected.efforts.some((choice) => choice.value === current)
        ? current
        : preferredAgentEffort(state, selected)
    ))
  }, [selected?.key])

  useLayoutEffect(() => {
    if (!selected) return
    optionRefs.current.get(selected.key)?.scrollIntoView({ block: 'nearest' })
  }, [filtered, selected])

  const apply = (): void => {
    if (!selected) return
    setProblem(undefined)
    try {
      applyAgentPickerSelection(session, selected, effort)
      close()
    } catch (error) {
      setProblem(errorMessage(error))
    }
  }

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = nextEnabledAgentPickerKey(filtered, selectedKey, event.key === 'ArrowDown' ? 1 : -1)
      if (next) setSelectedKey(next)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      apply()
    }
  }

  return (
    <ConversationPaneOverlay className={`${clientStyles.overlayLayer} agent-switcher-layer`} onMouseDown={close}>
      <section
        id="agent-switcher-dialog"
        className={`${clientStyles.floatingPanel} agent-switcher-panel`}
        role="dialog"
        aria-modal="true"
        aria-label="Agent, model, and reasoning"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="agent-switcher-search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            aria-label="Search agents and models"
            aria-controls="agent-switcher-results"
            aria-activedescendant={selected ? optionDomId(selected.key) : undefined}
            placeholder="Search agents and models…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          <span className="agent-switcher-current-summary" title={`${summary.model} · ${summary.effort}`}>
            {summary.model} <span>· {summary.effort}</span>
          </span>
          <button className={clientStyles.iconButton} type="button" aria-label="Close model picker" onClick={close}>
            <X size={15} />
          </button>
        </div>

        <div id="agent-switcher-results" className="agent-switcher-results" role="listbox" aria-label="Agents and models">
          {filtered.map((option) => {
            const active = option.key === selected?.key
            return (
              <button
                ref={(node) => {
                  if (node) optionRefs.current.set(option.key, node)
                  else optionRefs.current.delete(option.key)
                }}
                id={optionDomId(option.key)}
                className={`agent-switcher-option${active ? ' is-active' : ''}${option.current ? ' is-current' : ''}`}
                type="button"
                role="option"
                aria-selected={active}
                aria-current={option.current ? 'true' : undefined}
                disabled={Boolean(option.disabledReason)}
                title={option.disabledReason}
                tabIndex={-1}
                onMouseEnter={() => setSelectedKey(option.key)}
                onClick={() => setSelectedKey(option.key)}
                key={option.key}
              >
                <span className="agent-switcher-option-copy">
                  <strong>{option.modelLabel}</strong>
                  <span>{option.providerLabel} · {option.providerLocation}</span>
                </span>
                <span className="agent-switcher-option-meta">
                  {option.disabledReason
                    ? <><LockKeyhole size={13} aria-hidden="true" /><span>New chat</span></>
                    : option.current ? <><Check size={14} aria-hidden="true" /><span>Current</span></> : null}
                </span>
              </button>
            )
          })}
          {!filtered.length && <p className="agent-switcher-empty">No matching agents or models.</p>}
        </div>

        <footer className="agent-switcher-footer">
          <div className="agent-switcher-reasoning">
            <span className="agent-switcher-footer-label">Reasoning</span>
            {selected?.efforts.length ? (
              <div className="agent-switcher-efforts" role="group" aria-label="Reasoning effort">
                {selected.efforts.map((choice) => (
                  <button
                    className="agent-switcher-effort"
                    type="button"
                    aria-pressed={choice.value === effort}
                    title={choice.description}
                    onClick={() => setEffort(choice.value)}
                    key={choice.value}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : <span className="agent-switcher-no-effort">No separate setting</span>}
          </div>
          <div className="agent-switcher-actions">
            {selected?.disabledReason && <span className="agent-switcher-note">{selected.disabledReason}</span>}
            <button className={`${clientStyles.button} small`} type="button" onClick={close}>Cancel</button>
            <button
              className={`${clientStyles.button} primary small`}
              type="button"
              disabled={!selected || Boolean(selected.disabledReason) || !state.connected}
              onClick={apply}
            >
              Use selection
            </button>
          </div>
          {problem && <p className="agent-switcher-error" role="alert">{problem}</p>}
        </footer>
      </section>
    </ConversationPaneOverlay>
  )
}

function AgentSwitcherSurface({ session, ui }: { session: ClientSessionService; ui: ClientUiService }): ReactNode {
  const activeOverlay = useSyncExternalStore(ui.overlays.subscribe, ui.overlays.snapshot)
  return activeOverlay === AGENT_SWITCHER_OVERLAY
    ? <AgentSwitcherDialog session={session} ui={ui} />
    : null
}

const agentSwitcherClient: BrowserPlugin = (ctx) => {
  const ui = ctx.clientUi
  const session = ctx.clientSession
  const Root = () => (
    <>
      <AgentSwitcherChrome session={session} ui={ui} />
      <AgentSwitcherSurface session={session} ui={ui} />
    </>
  )
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

agentSwitcherClient.inject = ['clientHotkeys', 'clientSession', 'clientUi']
agentSwitcherClient.resources = { provides: { roots: ['agent-switcher-root'] } }

export default agentSwitcherClient

