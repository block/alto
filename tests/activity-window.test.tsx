import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ActivityTimeline,
  initialVisibleTurnStart,
  resumedStreamText,
  shouldObserveActivityHeight,
  turnFinalAgents,
  type ActivityItem,
} from '../program/plugins/ui/activity.js'

function prompts(count: number): ActivityItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user:${index}`,
    kind: 'user',
    title: 'You',
    content: `Prompt ${index}`,
    timestamp: 'now',
  }))
}

describe('activity timeline window', () => {
  it('starts with the most recent 24 turns', () => {
    expect(initialVisibleTurnStart(100)).toBe(76)
    expect(initialVisibleTurnStart(12)).toBe(0)

    const html = renderToStaticMarkup(<ActivityTimeline items={prompts(30)} markdown={false} />)
    expect(html).not.toContain('data-activity-id="user:5"')
    expect(html).toContain('data-activity-id="user:6"')
    expect(html).toContain('data-activity-id="user:29"')
    expect(html).toContain('Show earlier activity')
  })

  it('offers an older page even when every loaded turn is visible', () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline items={prompts(24)} markdown={false} hasEarlier />,
    )

    expect(html).toContain('Show earlier activity')
    expect(html).toContain('data-activity-id="user:0"')
  })
})

describe('streaming reply height observation', () => {
  it('observes only visible agent replies while they are animating', () => {
    expect(shouldObserveActivityHeight('agent', true, true)).toBe(true)
    expect(shouldObserveActivityHeight('agent', true, false)).toBe(false)
    expect(shouldObserveActivityHeight('agent', false, true)).toBe(false)
    expect(shouldObserveActivityHeight('reasoning', true, true)).toBe(false)
  })
})

describe('turn final lane', () => {
  const item = (id: string, kind: ActivityItem['kind'], extra: Partial<ActivityItem> = {}): ActivityItem => ({
    id, kind, title: kind, content: id, timestamp: 'now', turnId: 'turn', ...extra,
  })
  const prompt = item('user', 'user')

  it('keeps a running ACP reply in the final lane before its phase is known', () => {
    const reply = item('agent:2', 'agent', { status: 'streaming' })
    const items = [prompt, item('agent:1', 'agent'), item('tool:1', 'tool'), reply]

    expect(turnFinalAgents(items, true)).toEqual([reply])
    // Completion marks the same reply final, so it stays in the same lane.
    const completed = { ...reply, status: 'completed', phase: 'final_answer' as const, durationMs: 10 }
    expect(turnFinalAgents([...items.slice(0, -1), completed], false)).toEqual([completed])
  })

  it('returns earlier text to the work lane once other activity follows it', () => {
    const items = [prompt, item('agent:1', 'agent'), item('tool:1', 'tool')]
    expect(turnFinalAgents(items, true)).toEqual([])
  })

  it('leaves App Server commentary in the work lane', () => {
    const items = [prompt, item('agent:1', 'agent', { phase: 'commentary' })]
    expect(turnFinalAgents(items, true)).toEqual([])
  })

  it('does not treat an unfinished stopped turn as answered', () => {
    expect(turnFinalAgents([prompt, item('agent:1', 'agent')], false)).toEqual([])
  })
})

describe('streaming reveal resume', () => {
  it('resumes a remounted reply from the characters already shown', () => {
    expect(resumedStreamText('Hello, world', false, 5)).toBe('Hello')
  })

  it('shows completed text when no reveal was in progress', () => {
    expect(resumedStreamText('Hello, world', false, undefined)).toBe('Hello, world')
    expect(resumedStreamText('Hello', false, 9)).toBe('Hello')
  })

  it('does not split a surrogate pair', () => {
    expect(resumedStreamText('a😀b', false, 2)).toBe('a😀')
  })
})
