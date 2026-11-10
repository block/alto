import { Check, ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ModelOption } from '../../../src/shared/protocol.js'
import type { AgentConfigOption } from '../../../src/server/services/agent-registry.js'
import type { ClientSessionSnapshot } from '../session-api.js'
import { agentSelection } from './agent-selection.js'
import { uiStyles } from './appearance.js'

function effortLabel(effort: string | undefined): string {
  if (!effort) return 'Default'
  if (effort.toLocaleLowerCase() === 'xhigh') return 'XHigh'
  return `${effort.charAt(0).toLocaleUpperCase()}${effort.slice(1)}`
}

export function ComposerModelPicker({
  models, model, effort, providers, providerId, providerLocked, agentConfig,
  disabled, open, onOpenChange, onModelChange, onEffortChange, onProviderChange,
  onAgentConfigChange, onModelsRequest,
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
  onOpenChange: (open: boolean) => void
  onModelChange: (model: string | undefined) => void | Promise<void>
  onEffortChange: (effort: string | undefined) => void
  onProviderChange?: ((id: string) => void) | undefined
  onAgentConfigChange?: ((id: string, value: string) => void) | undefined
  onModelsRequest?: (() => Promise<void>) | undefined
}): ReactNode {
  const control = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const latestOpenChange = useRef(onOpenChange)
  latestOpenChange.current = onOpenChange
  const requestRevision = useRef(0)
  const modelRequestRevision = useRef(0)
  const id = useId()
  const [page, setPage] = useState('root')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [choiceError, setChoiceError] = useState<string>()
  const [pendingModel, setPendingModel] = useState<{ model: string | undefined }>()
  const hasModels = models.length > 0
  const selection = agentSelection(providers, providerId)
  const selectedModel = models.find(option => option.id === model)
    ?? models.find(option => option.isDefault)
    ?? models[0]
  const reasoning = effort ?? selectedModel?.defaultReasoningEffort
  const reasoningOptions = selectedModel?.supportedReasoningEfforts ?? []
  const changingModel = pendingModel !== undefined && pendingModel.model === model
  const summary = [selectedModel?.displayName ?? model ?? `${selection.label} default`, effortLabel(reasoning)].join(' ')
  const choices = useMemo(
    () => [...models].sort((left, right) => Number(right.id === selectedModel?.id) - Number(left.id === selectedModel?.id)),
    [models, selectedModel?.id],
  )

  useLayoutEffect(() => {
    if (!open || page !== 'root') return
    const picker = control.current?.querySelector('.composer-model-picker')
    const active = picker?.querySelector<HTMLButtonElement>('[data-composer-models] button[aria-selected="true"]')
      ?? picker?.querySelector<HTMLButtonElement>('[data-composer-models] button:not(:disabled)')
      ?? picker?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    active?.focus({ preventScroll: true })
  }, [open, page, hasModels])
  useEffect(() => {
    requestRevision.current += 1
    modelRequestRevision.current += 1
    setError(undefined)
    setChoiceError(undefined)
    setPendingModel(undefined)
    setLoading(false)
    setPage('root')
    return () => { requestRevision.current += 1 }
  }, [providerId])
  useEffect(() => {
    modelRequestRevision.current += 1
    setPendingModel(undefined)
  }, [model])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!control.current?.contains(event.target as Node)) latestOpenChange.current(false)
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      latestOpenChange.current(false)
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      modelRequestRevision.current += 1
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

  function chooseModel(option: ModelOption): void {
    if (changingModel) return
    setChoiceError(undefined)
    if (option.id !== selectedModel?.id) {
      const revision = ++modelRequestRevision.current
      const failed = (failure: unknown): void => {
        if (modelRequestRevision.current !== revision) return
        setPendingModel(undefined)
        setChoiceError(failure instanceof Error ? failure.message : String(failure))
      }
      setPendingModel({ model })
      try {
        const result = onModelChange(option.id)
        if (result) void result.catch(failed)
      } catch (failure) { failed(failure) }
    }
  }

  function chooseEffort(value: string): void {
    if (changingModel) return
    try { onEffortChange(value) }
    catch (failure) { setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
    const target = event.target as HTMLElement
    const reasoningGroup = target.closest('.composer-picker-reasoning')
    if (reasoningGroup && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const buttons = [...reasoningGroup.querySelectorAll<HTMLButtonElement>('button')]
      const index = buttons.indexOf(target as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length
      event.preventDefault()
      buttons[next]?.focus()
      return
    }
    if (!target.closest('[data-composer-models]')) return
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...control.current?.querySelectorAll<HTMLButtonElement>('[data-composer-models] button[role="option"]') ?? []]
    if (!buttons.length) return
    event.preventDefault()
    const index = buttons.indexOf(target as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length
        : (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length)
    buttons[next]?.focus({ preventScroll: true })
    buttons[next]?.scrollIntoView({ block: 'nearest' })
  }

  return <div className="composer-model-control" ref={control}>
    <button ref={trigger} className="composer-model-trigger" type="button"
      aria-label={`Model and reasoning: ${summary}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={(disabled && (providerLocked || providers.length < 2)) || (!models.length && !providers.length && !onModelsRequest)}
      onClick={() => { if (!open) { setPage('root'); setPendingModel(undefined); setChoiceError(undefined) } onOpenChange(!open) }}>
      {providerId === 'codex' ? summary : [selection.label, selectedModel?.displayName ?? model, effortLabel(reasoning)].filter(Boolean).join(' · ')}
    </button>
    {open && <div id={id} className="composer-model-picker" role="dialog" aria-modal="false" aria-label="Model and reasoning" onKeyDown={navigate}>
      {page === 'root' && <>
        {(providers.length > 0 || (hasModels && onModelsRequest)) && <div className="composer-picker-toolbar">
          {providers.length > 0 && <button className="composer-picker-row" type="button"
            disabled={providerLocked} title={providerLocked ? 'Start a new chat to change agent' : 'Choose an agent'}
            onClick={() => setPage('agent')}>
            <span>Agent</span><span>{selection.label}</span><ChevronRight size={16} />
          </button>}
          {hasModels && onModelsRequest && <button className={uiStyles.iconButton} type="button" aria-label="Refresh models" title="Refresh models"
            disabled={loading} onClick={() => { void requestModels() }}><RefreshCw size={14} /></button>}
        </div>}
        {reasoningOptions.length > 0 && <div className="composer-picker-reasoning" role="group" aria-label="Reasoning">
          <span>Reasoning</span>
          <div>{reasoningOptions.map(option => <button type="button" key={option.reasoningEffort}
            aria-pressed={option.reasoningEffort === reasoning} title={option.description} disabled={changingModel}
            onClick={() => chooseEffort(option.reasoningEffort)}>
            {effortLabel(option.reasoningEffort)}
          </button>)}</div>
        </div>}
        <div className="composer-picker-options composer-picker-models" data-composer-models role="listbox" aria-label="Models">
          {loading && <p className="composer-picker-note" role="status">Loading models…</p>}
          {changingModel && <p className="composer-picker-note" role="status">Changing model…</p>}
          {error && <p className="composer-picker-note" role="alert">{error}</p>}
          {choiceError && <p className="composer-picker-note" role="alert">{choiceError}</p>}
          {onModelsRequest && (!models.length || error) && <button type="button" disabled={loading} onClick={() => { void requestModels() }}>
            <span>{error ? 'Retry' : 'Load models'}</span>
          </button>}
          {choices.map(option => <button className={uiStyles.row} type="button" role="option" aria-selected={option.id === selectedModel?.id} disabled={changingModel}
            key={option.id} onClick={() => chooseModel(option)}>
            <span>{option.displayName}</span>{option.id === selectedModel?.id && <Check size={15} />}
          </button>)}
          {!models.length && !onModelsRequest && <p className="composer-picker-note">This agent manages its model automatically.</p>}
        </div>
        {agentConfig.filter(option => !['model', 'thought_level', 'mode'].includes(option.category ?? '')).map(option => (
          <button className="composer-picker-row" type="button" key={option.id} onClick={() => setPage('config:' + option.id)}>
            <span>{option.name}</span><span>{option.options.find(value => value.value === option.currentValue)?.name}</span><ChevronRight size={16} />
          </button>
        ))}
        {providerId === 'codex' && <><div className="composer-picker-separator" />
          <button className="composer-picker-row reset" type="button" disabled={!models.length}
            onClick={() => {
              try { onModelChange(undefined); onEffortChange(undefined) }
              catch (failure) { setChoiceError(failure instanceof Error ? failure.message : String(failure)) }
            }}>
            <span>Reset to default</span><RotateCcw size={15} />
          </button>
        </>}
      </>}
      {page === 'agent' && <>
        <header className="composer-picker-header"><button type="button" aria-label="Back" onClick={() => setPage('root')}><ChevronLeft size={16} /></button><strong>Agent</strong></header>
        <div className="composer-picker-options">{selection.agents.map(provider => <button type="button" role="menuitemradio"
          key={provider.id} aria-checked={provider.id === providerId} disabled={providerLocked}
          onClick={() => { onProviderChange?.(provider.id); setPage('root') }}>
          <span>{provider.label}</span>{provider.id === providerId && <Check size={15} />}
        </button>)}</div>
      </>}
      {page.startsWith('config:') && agentConfig.filter(option => option.category !== 'mode' && 'config:' + option.id === page).map(option => <div key={option.id}>
        <header className="composer-picker-header"><button type="button" aria-label="Back" onClick={() => setPage('root')}><ChevronLeft size={16} /></button><strong>{option.name}</strong></header>
        <div className="composer-picker-options">{option.options.map(value => <button type="button" key={value.value} role="menuitemradio"
          aria-checked={value.value === option.currentValue} title={value.description}
          onClick={() => { onAgentConfigChange?.(option.id, value.value); setPage('root') }}>
          <span>{value.name}</span>{value.value === option.currentValue && <Check size={15} />}
        </button>)}</div>
      </div>)}
    </div>}
  </div>
}
