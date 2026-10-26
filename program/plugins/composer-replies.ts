import type { ClientDraft } from '../../src/client/plugin-api.js'

export interface ComposerReplyTarget {
  id: string
  threadId: string
  title: string
  submit(draft: ClientDraft): Promise<void>
}

export interface ComposerReplyState {
  target: ComposerReplyTarget
  sending: boolean
  error?: string
}

export class ComposerReplies {
  private readonly targets = new Map<string, ComposerReplyState>()
  private readonly listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  snapshot = (threadId?: string): ComposerReplyState | undefined => threadId ? this.targets.get(threadId) : undefined
  private changed(): void { for (const listener of this.listeners) listener() }

  begin(target: ComposerReplyTarget): () => void {
    if (this.targets.get(target.threadId)?.sending) return () => {}
    this.targets.set(target.threadId, { target, sending: false })
    this.changed()
    return () => {
      if (this.targets.get(target.threadId)?.target === target) this.cancel(target.threadId)
    }
  }

  cancel(threadId: string): void {
    if (this.targets.delete(threadId)) this.changed()
  }

  async submit(threadId: string, draft: ClientDraft): Promise<void> {
    const current = this.targets.get(threadId)
    if (!current) throw new Error('This question is no longer selected')
    if (current.sending) throw new Error('This answer is already being sent')
    this.targets.set(threadId, { target: current.target, sending: true })
    this.changed()
    try {
      await current.target.submit(draft)
      if (this.targets.get(threadId)?.target === current.target) this.cancel(threadId)
    } catch (error) {
      if (this.targets.get(threadId)?.target === current.target) {
        this.targets.set(threadId, {
          target: current.target, sending: false,
          error: error instanceof Error ? error.message : 'Could not send your answer. Try again.',
        })
        this.changed()
      }
      throw error
    }
  }
}
