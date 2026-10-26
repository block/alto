import { QUESTION_REPLY_COMPONENT, type QuestionReplyButtonProps } from '../chat-surfaces-api.js'
import { QuestionComposerContext } from './question-composer.js'
import { Check } from 'lucide-react'
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { clientStyles } from '../../../src/client/plugin-api.js'
import { isRecord, type PendingServerRequest } from '../../../src/shared/protocol.js'

export interface InputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  options: { label: string; description: string }[]
}

export function inputQuestions(params: Record<string, unknown>): InputQuestion[] {
  if (!Array.isArray(params.questions)) return []
  return params.questions.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.question !== 'string') return []
    const options = Array.isArray(value.options) ? value.options.flatMap((option) => (
      isRecord(option) && typeof option.label === 'string' && option.label.trim()
        ? [{ label: option.label, description: typeof option.description === 'string' ? option.description : '' }]
        : []
    )) : []
    return [{
      id: value.id,
      header: typeof value.header === 'string' ? value.header : '',
      question: value.question,
      isOther: value.isOther === true,
      isSecret: value.isSecret === true,
      options,
    }]
  })
}

interface AnswerDraft {
  option?: string
  custom: boolean
  text: string
}

export function UserInputRequest({ request, resolve, heading, submitLabel }: {
  request: PendingServerRequest
  heading?: string
  submitLabel?: string
  resolve: (id: string | number, result: unknown) => Promise<void>
}): ReactNode {
  const composerContext = useContext(QuestionComposerContext)
  const ReplyButton = composerContext?.ui.component<QuestionReplyButtonProps>(QUESTION_REPLY_COMPONENT)
  const questions = inputQuestions(request.params)
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const alive = useRef(true)
  const id = useId()
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const answerFor = (question: InputQuestion, values = answers): string => {
    const draft = values[question.id]
    if (!draft) return ''
    return !question.options.length || draft.custom ? draft.text : draft.option ?? ''
  }
  const complete = questions.length > 0 && questions.every((question) => answerFor(question).trim())
  const locked = submitting || submitted
  const update = (questionId: string, patch: Partial<AnswerDraft>): void => {
    setError('')
    setAnswers((current) => ({
      ...current,
      [questionId]: { custom: false, text: '', ...current[questionId], ...patch },
    }))
  }
  const submit = async (values = answers, fromComposer = false): Promise<void> => {
    if (!questions.length || !questions.every((question) => answerFor(question, values).trim()) || inFlight.current || submitted) return
    inFlight.current = true
    setSubmitting(true)
    setError('')
    try {
      // The caller routes this either to a pending server request or to the
      // original chat for asynchronous questions.
      await resolve(request.id, {
        answers: Object.fromEntries(questions.map((question) => [question.id, { answers: [answerFor(question, values)] }])),
      })
      if (alive.current) setSubmitted(true)
    } catch (error) {
      if (alive.current) setError('Could not send your answers. Please try again.')
      if (fromComposer) throw error
    } finally {
      inFlight.current = false
      if (alive.current) setSubmitting(false)
    }
  }

  return (
    <form className={clientStyles.floatingPanel + ' input-request'} aria-label="Agent questions" aria-busy={submitting}
      onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <div className="input-request-heading">{heading ?? (request.params.isBlocking === false ? 'A question for you' : 'Your input is needed')}</div>
      {questions.map((question, index) => {
        const draft = answers[question.id]
        const name = id + '-' + index
        const custom = !question.options.length || draft?.custom
        return <fieldset className="input-question" key={question.id} disabled={locked}>
          <legend>
            {question.header && <span className="input-question-header">{question.header}</span>}
            <span className="input-question-title">{question.question}</span>
          </legend>
          {question.options.length > 0 && <div className="input-question-options">
            {question.options.map((option, optionIndex) => {
              const selected = !draft?.custom && draft?.option === option.label
              return <label className="input-question-option" key={optionIndex}>
                <input type="radio" name={name} value={option.label} checked={selected}
                  aria-describedby={option.description ? name + '-description-' + optionIndex : undefined}
                  onChange={() => update(question.id, { option: option.label, custom: false })} />
                <span className="input-question-indicator" aria-hidden="true">{selected && <Check size={14} />}</span>
                <span className="input-question-option-copy">
                  <span>{option.label}</span>
                  {option.description && <span className="input-question-description" id={name + '-description-' + optionIndex}>{option.description}</span>}
                </span>
              </label>
            })}
            {question.isOther && <label className="input-question-option">
              <input type="radio" name={name} checked={Boolean(draft?.custom)}
                onChange={() => update(question.id, { custom: true })} />
              <span className="input-question-indicator" aria-hidden="true">{draft?.custom && <Check size={14} />}</span>
              <span>Something else</span>
            </label>}
          </div>}
          {custom && ReplyButton && !question.isSecret
            ? <div className="input-question-composer">
                {draft?.text && <span className="input-question-answer">{draft.text}</span>}
                <ReplyButton
                  threadId={typeof request.params.threadId === 'string' ? request.params.threadId : composerContext?.session.snapshot().threadId}
                  id={String(request.id) + ':' + question.id}
                  title={question.question}
                  label={draft?.text ? 'Edit in composer' : 'Reply in composer'}
                  disabled={locked}
                  submit={async (draft) => {
                    if (!draft.text.trim()) throw new Error('Type an answer in the composer.')
                    if (draft.images.length || draft.attachments.length || draft.skills.length) {
                      throw new Error('Send a text answer here; attachments can be sent in a separate message.')
                    }
                    const values = { ...answers, [question.id]: { custom: true, text: draft.text } }
                    setAnswers(values)
                    await submit(values, true)
                  }}
                />
              </div>
            : custom && <label className="input-question-custom">
            <span>{question.options.length ? 'Your answer' : 'Answer'}</span>
            <input type={question.isSecret ? 'password' : 'text'} value={draft?.text ?? ''}
              autoComplete="off" spellCheck={!question.isSecret}
              onChange={(event) => update(question.id, { text: event.target.value })} />
          </label>}
        </fieldset>
      })}
      {!questions.length && <p role="alert">This question could not be displayed.</p>}
      {error && <p className="input-request-error" role="alert">{error}</p>}
      {(!ReplyButton || complete || questions.some((question) => question.options.length > 0)) && <div className="input-request-actions">
        <button type="submit" className={clientStyles.button + ' primary'} disabled={!complete || locked}>
          {submitted ? 'Sent' : submitting ? 'Sending…' : submitLabel ?? (request.params.isBlocking === false ? 'Send answers' : 'Continue')}
        </button>
      </div>}
    </form>
  )
}
