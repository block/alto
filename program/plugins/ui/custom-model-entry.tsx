import { X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { uiStyles } from './appearance.js'

export function CustomModelEntry({
  initialValue = '', disabled = false, onApply, onCancel,
}: {
  initialValue?: string
  disabled?: boolean
  onApply: (value: string) => void | Promise<void>
  onCancel?: () => void
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const applying = useRef(false)
  const errorId = useId()
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useLayoutEffect(() => {
    mounted.current = true
    input.current?.focus({ preventScroll: true })
    input.current?.select()
    return () => { mounted.current = false }
  }, [])
  useLayoutEffect(() => {
    if (error && !pending) input.current?.focus({ preventScroll: true })
  }, [error, pending])

  async function apply(): Promise<void> {
    if (disabled || applying.current) return
    const model = value.trim()
    if (!model || model.length > 256 || /[\u0000-\u001f\u007f]/.test(model)) {
      setError(!model ? 'Enter a model name or ID.'
        : model.length > 256 ? 'Use at most 256 characters.' : 'Use a model name on one line.')
      return
    }
    setError(undefined)
    applying.current = true
    setPending(true)
    try { await onApply(model) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { applying.current = false; if (mounted.current) setPending(false) }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void apply()
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  return <div className="custom-model-entry" role="group" aria-label="Custom model entry">
    <div className="custom-model-entry-controls">
      <input ref={input} className={uiStyles.input} type="text" aria-label="Custom model" placeholder="Model name or ID"
        aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={256} value={value} disabled={disabled || pending}
        onChange={event => { setValue(event.target.value); setError(undefined) }} onKeyDown={keyDown} />
      <button className={uiStyles.button + ' ghost'} type="button" disabled={disabled || pending || !value.trim()}
        onClick={() => { void apply() }}>{pending ? 'Applying…' : 'Use'}</button>
      {onCancel && <button className={uiStyles.iconButton + ' custom-model-entry-cancel'} type="button" aria-label="Cancel custom model"
        disabled={disabled || pending} onClick={onCancel}><X size={13} /></button>}
    </div>
    {error && <p id={errorId} className="custom-model-entry-error" role="alert">{error}</p>}
  </div>
}
