import { Check, ChevronDown, Cloud, Laptop, MoreHorizontal, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { ModelOption } from '../../../src/shared/protocol.js'
import type { AgentConfigOption } from '../../../src/server/services/agent-registry.js'
import type { AgentConfigSelection, ClientSessionSnapshot } from '../session-api.js'
import { agentSelection, type AgentPickerChoice } from './agent-selection.js'
import { uiStyles } from './appearance.js'

function effortLabel(effort: string | undefined): string {
  if (!effort) return 'Default'
  if (effort.toLocaleLowerCase() === 'xhigh') return 'XHigh'
  return `${effort.charAt(0).toLocaleUpperCase()}${effort.slice(1)}`
}

export type ComposerPickerFocus = 'models' | 'agents'

export function ComposerModelPicker({
  models, model, effort, providers, providerId, providerLocked, agentConfig,
  disabled, open, focus, onFocusChange, agentControlRef, onOpenChange, presentation = 'popover',
  onModelChange, onEffortChange, onProviderChange, onAgentConfigChange, onModelsRequest,
}: {
  models: ModelOption[]
  model: string | undefined
  effort: string | undefined
  providers: NonNullable<ClientSessionSnapshot['providers']>
  providerId: string
  providerLocked: boolean
  agentConfig: AgentConfigOption[]
  disabled: boolean
  open: boolean
  presentation?: 'popover' | 'dialog'
  focus: ComposerPickerFocus
  onFocusChange: (focus: ComposerPickerFocus) => void
  agentControlRef?: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onModelChange: (model: string | undefined) => void | Promise<void>
  onEffortChange: (effort: string | undefined) => void
  onProviderChange?: ((id: string, selection?: AgentConfigSelection) => void | Promise<void>) | undefined
  onAgentConfigChange?: ((id: string, value: string) => void | Promise<void>) | undefined
  onModelsRequest?: (() => Promise<void>) | undefined
}): ReactNode {
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  const previousFocus = useRef(focus)
  const hadModels = useRef(models.length > 0)
  const wasBusy = useRef(false)
  const busyFocus = useRef<HTMLElement | null>(null)
  const latestOpenChange = useRef(onOpenChange)
  latestOpenChange.current = onOpenChange
  const modelRevision = useRef(0)
  const agentRevision = useRef(0)
  const configRevision = useRef(0)
  const requestRevision = useRef(0)
  const id = useId()
  const [moreOpen, setMoreOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [choiceError, setChoiceError] = useState<string>()
  const [changingModel, setChangingModel] = useState(false)
  const [changingAgent, setChangingAgent] = useState(false)
  const [pendingConfig, setPendingConfig] = useState<string>()
  const selection = useMemo(() => agentSelection(providers, providerId, agentConfig), [providers, providerId, agentConfig])
  const agentChoices = useMemo(() => selection.agentGroups.flatMap(group => group.agents), [selection])
  const selectedAgent = agentChoices.find(choice => choice.selected)
  const selectedModel = models.find(option => option.id === model) ?? models.find(option => option.isDefault) ?? models[0]
  const reasoning = effort ?? selectedModel?.defaultReasoningEffort
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? []
  const summary = [selectedModel?.displayName ?? model ?? `${selection.label} default`, effortLabel(reasoning)].join(' ')
  const busy = changingModel || changingAgent || pendingConfig !== undefined
  const canLoadModels = !!onModelsRequest && providerId === 'codex'
  const extraOptions = agentConfig.filter(option => !['agent', 'model', 'thought_level', 'mode'].includes(option.category ?? ''))
  const hasMore = extraOptions.length > 0 || canLoadModels || (providerId === 'codex' && models.length > 0)
  const provider = providers.find(provider => provider.id === providerId)
  const unavailable = provider?.status !== 'ready' && provider?.status !== 'starting' ? provider?.error : undefined
  const statusMessage = loading ? 'Loading models…' : changingModel ? 'Changing model…'
    : changingAgent ? 'Changing agent…' : pendingConfig ? 'Applying options…' : undefined

  function rememberBusyFocus(): void {
    const active = document.activeElement
    busyFocus.current = active instanceof HTMLElement && control.current?.contains(active) ? active : null
  }

  function focusPicker(area: ComposerPickerFocus): void {
    const picker = control.current?.querySelector('.composer-model-picker')
    const visible = (button: HTMLElement | null | undefined): button is HTMLElement => !!button?.getClientRects().length
    const nativeAgent = picker?.querySelector<HTMLSelectElement>('select[aria-label="Agent"]:not(:disabled)')
    const list = area === 'agents' ? '[data-composer-agents]' : '[data-composer-models]'
    const selected = picker?.querySelector<HTMLButtonElement>(`${list} button[aria-selected="true"]:not(:disabled)`)
    const first = picker?.querySelector<HTMLButtonElement>(`${list} button:not(:disabled)`)
    const target = area === 'agents' && visible(nativeAgent) ? nativeAgent
      : visible(selected) ? selected : visible(first) ? first
        : [...picker?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? []].find(visible)
    target?.focus({ preventScroll: true })
    if (target?.closest('[role="listbox"]')) target.scrollIntoView({ block: 'nearest' })
  }

  useLayoutEffect(() => {
    const opening = open && !wasOpen.current
    if (!open && wasOpen.current) {
      setChangingAgent(false)
      setChangingModel(false)
      setPendingConfig(undefined)
    }
    if (open && (opening || focus !== previousFocus.current)) {
      if (opening) {
        setChangingAgent(false)
        setChangingModel(false)
        setPendingConfig(undefined)
        setChoiceError(undefined)
        setMoreOpen(false)
      }
      const active = document.activeElement
      if (active instanceof HTMLElement && (control.current?.contains(active) || agentControlRef?.current?.contains(active))) opener.current = active
      else if (opening) opener.current = trigger.current
      focusPicker(focus)
    }
    wasOpen.current = open
    previousFocus.current = focus
  }, [open, focus])
  useLayoutEffect(() => {
    if (open && models.length > 0 && !hadModels.current
      && !document.activeElement?.closest('[data-composer-agents], .composer-picker-native-agent')) focusPicker('models')
    hadModels.current = models.length > 0
  }, [open, models.length > 0])
  useLayoutEffect(() => {
    if (!open) return
    const picker = control.current?.querySelector<HTMLElement>('.composer-model-picker')
    if (!picker) return
    const measure = (): void => {
      const inset = Number.parseFloat(getComputedStyle(picker).getPropertyValue('--space-2')) || 8
      const boundary = presentation === 'dialog' ? picker.closest<HTMLElement>('[data-picker-boundary]') : null
      const boundaryStyle = boundary && getComputedStyle(boundary)
      const available = presentation === 'dialog'
        ? boundary ? boundary.clientHeight - Number.parseFloat(boundaryStyle!.paddingTop) - Number.parseFloat(boundaryStyle!.paddingBottom)
          : window.innerHeight - 2 * inset
        : picker.getBoundingClientRect().bottom - inset
      picker.style.setProperty('--composer-picker-available-height', `${Math.max(0, Math.floor(available))}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    // Pane resizing and editor growth both change the space above the trigger.
    for (let ancestor: HTMLElement | null = control.current; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [open, presentation])
  useLayoutEffect(() => {
    if (open && wasBusy.current && !busy && document.activeElement === document.body) {
      const target = busyFocus.current
      if (target?.isConnected && !target.matches(':disabled') && target.getClientRects().length) target.focus({ preventScroll: true })
      else focusPicker(focus)
    }
    wasBusy.current = busy
  }, [open, busy])
  useEffect(() => {
    modelRevision.current += 1
    agentRevision.current += 1
    configRevision.current += 1
    requestRevision.current += 1
    setChangingModel(false)
    setChangingAgent(false)
    setPendingConfig(undefined)
    setLoading(false)
    setChoiceError(undefined)
    setError(undefined)
    setMoreOpen(false)
    return () => {
      modelRevision.current += 1
      agentRevision.current += 1
      configRevision.current += 1
      requestRevision.current += 1
    }
  }, [providerId])
  useEffect(() => {
    modelRevision.current += 1
    setChangingModel(false)
  }, [model])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!control.current?.contains(event.target as Node) && !agentControlRef?.current?.contains(event.target as Node)) latestOpenChange.current(false)
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      latestOpenChange.current(false)
      opener.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      modelRevision.current += 1
      agentRevision.current += 1
      configRevision.current += 1
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  async function requestModels(): Promise<void> {
    if (!onModelsRequest || loading) return
    const revision = ++requestRevision.current
    setLoading(true)
    setError(undefined)
    try { await onModelsRequest() }
    catch (failure) { if (requestRevision.current === revision) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (requestRevision.current === revision) setLoading(false) }
  }

  async function chooseModel(option: ModelOption): Promise<void> {
    if (busy || option.id === selectedModel?.id) return
    const revision = ++modelRevision.current
    rememberBusyFocus()
    setChangingModel(true)
    setChoiceError(undefined)
    try { await onModelChange(option.id) }
    catch (failure) { if (modelRevision.current === revision) setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (modelRevision.current === revision) setChangingModel(false) }
  }

  function chooseEffort(value: string): void {
    if (busy || value === reasoning) return
    setChoiceError(undefined)
    try { onEffortChange(value) }
    catch (failure) { setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
  }

  async function chooseAgent(choice: AgentPickerChoice): Promise<void> {
    if (providerLocked || busy || choice.selected || !onProviderChange) return
    const revision = ++agentRevision.current
    rememberBusyFocus()
    setChangingAgent(true)
    setChoiceError(undefined)
    try { await onProviderChange(choice.providerId, choice.selection) }
    catch (failure) { if (agentRevision.current === revision) setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (agentRevision.current === revision) setChangingAgent(false) }
  }

  async function chooseConfig(option: AgentConfigOption, value: string): Promise<void> {
    if (busy || value === option.currentValue || !onAgentConfigChange) return
    const revision = ++configRevision.current
    rememberBusyFocus()
    setPendingConfig(option.id)
    setChoiceError(undefined)
    try { await onAgentConfigChange(option.id, value) }
    catch (failure) { if (configRevision.current === revision) setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (configRevision.current === revision) setPendingConfig(undefined) }
  }

  async function resetDefaults(): Promise<void> {
    if (busy) return
    const revision = ++configRevision.current
    rememberBusyFocus()
    setPendingConfig('defaults')
    setChoiceError(undefined)
    try {
      await onModelChange(undefined)
      if (configRevision.current === revision) onEffortChange(undefined)
    } catch (failure) { if (configRevision.current === revision) setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (configRevision.current === revision) setPendingConfig(undefined) }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    const target = event.target as HTMLElement
    const reasoningGroup = target.closest('.composer-picker-reasoning')
    if (reasoningGroup && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const buttons = [...reasoningGroup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (!buttons.length) return
      const index = buttons.indexOf(target as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length
      event.preventDefault()
      buttons[next]?.focus()
      return
    }
    const list = target.closest('[data-composer-models], [data-composer-agents]')
    if (!list) return
    if (event.key === 'ArrowLeft' && list.hasAttribute('data-composer-models') && !providerLocked) {
      event.preventDefault(); focusPicker('agents'); return
    }
    if (event.key === 'ArrowRight' && list.hasAttribute('data-composer-agents')) {
      event.preventDefault(); focusPicker('models'); return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)')]
    if (!buttons.length) return
    event.preventDefault()
    const index = buttons.indexOf(target as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length
        : (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length)
    buttons[next]?.focus({ preventScroll: true })
    buttons[next]?.scrollIntoView({ block: 'nearest' })
  }

  return <div className="composer-model-control" data-picker-presentation={presentation} ref={control}>
    {presentation === 'popover' && <button ref={trigger} className="composer-model-trigger" type="button"
      aria-label={`Model and reasoning: ${summary}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      title={`${selection.label} · ${selection.locationLabel}\n${summary}`}
      disabled={(disabled && (providerLocked || providers.length < 2)) || (!models.length && !providers.length && !onModelsRequest)}
      onClick={() => { onFocusChange('models'); onOpenChange(!open || focus !== 'models') }}>
      <span>{summary}</span><ChevronDown size={12} />
    </button>}
    {open && <div id={id} className="composer-model-picker" role="dialog" aria-modal={presentation === 'dialog'} aria-label="Model and reasoning"
      data-presentation={presentation} data-agent-locked={providerLocked || !providers.length ? 'true' : undefined} onKeyDown={navigate}>
      <div className="composer-picker-body">
        {providers.length > 0 && <section className="composer-picker-agents-rail" aria-label="Agents">
          <div className="composer-picker-section-heading"><strong>Agent</strong></div>
          <div className="composer-picker-agent-list" data-composer-agents role="listbox" aria-label="Agents">
            {selection.agentGroups.map(group => <div className="composer-picker-agent-group" key={group.id} role="group" aria-label={group.label}>
              <div className="composer-picker-group-label" aria-hidden="true">{group.id === 'local' ? <Laptop size={12} /> : <Cloud size={12} />}<span>{group.label}</span></div>
              {group.agents.map(choice => <button className="composer-picker-agent-choice" key={choice.key} type="button" role="option"
                aria-label={`${choice.label} · ${group.label}`} aria-selected={choice.selected} tabIndex={choice.selected ? 0 : -1}
                disabled={providerLocked || busy || !onProviderChange} onClick={() => { void chooseAgent(choice) }}>
                <span className="composer-picker-agent-copy"><span>{choice.label}</span>{choice.description && <small>{choice.description}</small>}</span>
                {choice.selected && <Check size={14} />}
              </button>)}
              {!group.agents.length && !group.unavailable.length && <p className="composer-picker-note">No agents available.</p>}
              {group.unavailable.map((entry, index) => <p key={index} className="composer-picker-note" role="status">{entry.reason}</p>)}
            </div>)}
          </div>
        </section>}
        <section className="composer-picker-main" aria-label="Model settings">
          {providers.length > 0 && <div className="composer-picker-agent-select">
            <span>Agent</span>
            {providerLocked ? <span className="composer-picker-current-agent" title="Start a new chat to change agent">{selection.label} · {selection.locationLabel}</span>
              : <div className="composer-picker-native-agent"><select aria-label="Agent" value={selectedAgent?.key ?? ''} disabled={busy || !onProviderChange}
                  onChange={event => { const choice = agentChoices.find(choice => choice.key === event.target.value); if (choice) void chooseAgent(choice) }}>
                  {!selectedAgent && <option value="" disabled>Choose an agent</option>}
                  {selection.agentGroups.map(group => <optgroup label={group.label} key={group.id}>
                    {group.agents.map(choice => <option value={choice.key} key={choice.key}>{choice.label}</option>)}
                    {group.unavailable.map((entry, index) => <option disabled key={index}>{entry.reason}</option>)}
                    {!group.agents.length && !group.unavailable.length && <option disabled>No agents available</option>}
                  </optgroup>)}
                </select><small>{selection.locationLabel}</small></div>}
          </div>}
          <div className="composer-picker-section-heading">
            <div className="composer-picker-model-title"><strong>Model</strong><div className="composer-picker-current-agent" role={statusMessage ? 'status' : undefined}>{statusMessage ?? `${selection.label} · ${selection.locationLabel}`}</div></div>
            {hasMore && <button className={`${uiStyles.iconButton} composer-picker-more-button`} type="button" aria-label="More options" title="More options"
              aria-expanded={moreOpen} aria-controls={`${id}-options`} onClick={() => setMoreOpen(value => !value)}><MoreHorizontal size={16} /></button>}
          </div>
          <div className="composer-picker-options composer-picker-models" data-composer-models role="listbox" aria-label="Models">
            {unavailable && <p className="composer-picker-note" role="status">{unavailable}</p>}
            {!models.length && canLoadModels && <button type="button" disabled={loading} onClick={() => { void requestModels() }}>Load models</button>}
            {models.map(option => <button className={uiStyles.row} type="button" role="option" aria-selected={option.id === selectedModel?.id}
              tabIndex={option.id === selectedModel?.id ? 0 : -1} disabled={busy} key={option.id} title={option.displayName} onClick={() => { void chooseModel(option) }}>
              <span>{option.displayName}</span>{option.id === selectedModel?.id && <Check size={14} />}
            </button>)}
            {!models.length && !canLoadModels && !unavailable && <p className="composer-picker-note">Model follows the agent’s defaults.</p>}
          </div>
          {error && <p className="composer-picker-note" role="alert">{error}</p>}
          {choiceError && <p className="composer-picker-note" role="alert">{choiceError}</p>}
          {reasoningOptions.length > 0 && <div className="composer-picker-reasoning" role="group" aria-label="Reasoning">
            <span>Reasoning</span><div>{reasoningOptions.map(option => <button key={option.reasoningEffort} type="button"
              aria-pressed={option.reasoningEffort === reasoning} title={option.description} tabIndex={option.reasoningEffort === reasoning ? 0 : -1}
              disabled={busy} onClick={() => chooseEffort(option.reasoningEffort)}>{effortLabel(option.reasoningEffort)}</button>)}</div>
          </div>}
          {moreOpen && <div id={`${id}-options`} className="composer-picker-details" role="group" aria-label="Options">
            {extraOptions.map(option => <label className="composer-picker-setting" key={option.id}>
              <span>{option.name}</span><select aria-label={option.name} value={option.currentValue} disabled={busy || !onAgentConfigChange}
                onChange={event => { void chooseConfig(option, event.target.value) }}>
                {option.options.map(value => <option key={value.value} value={value.value}>{value.name}</option>)}
              </select>
            </label>)}
            <div className="composer-picker-maintenance">
              {canLoadModels && <button type="button" disabled={loading || busy} onClick={() => { void requestModels() }}><RefreshCw size={13} />Refresh models</button>}
              {providerId === 'codex' && <button type="button" disabled={!models.length || busy} onClick={() => { void resetDefaults() }}><RotateCcw size={13} />Reset to default</button>}
            </div>
          </div>}
        </section>
      </div>
    </div>}
  </div>
}
