import { describe, expect, it, vi } from 'vitest'
import { ComposerReplies } from '../program/plugins/composer-replies.js'

const draft = { text: 'My answer', images: [], attachments: [], skills: [] }

describe('composer question replies', () => {
  it('scopes replies to the owning chat and does not clear another pending question', async () => {
    const replies = new ComposerReplies()
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    replies.begin({ id: 'one', threadId: 'a', title: 'First?', submit: first })
    replies.begin({ id: 'two', threadId: 'b', title: 'Second?', submit: second })
    await replies.submit('a', draft)
    expect(first).toHaveBeenCalledWith(draft)
    expect(second).not.toHaveBeenCalled()
    expect(replies.snapshot('a')).toBeUndefined()
    expect(replies.snapshot('b')?.target.id).toBe('two')
    await expect(replies.submit('missing', draft)).rejects.toThrow('no longer selected')
  })

  it('retains the reply after a failed send, prevents duplicates, and supports cancel', async () => {
    const replies = new ComposerReplies()
    const submit = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined)
    replies.begin({ id: 'one', threadId: 'a', title: 'First?', submit })
    await expect(replies.submit('a', draft)).rejects.toThrow('Connection lost')
    expect(replies.snapshot('a')).toMatchObject({ sending: false, error: 'Connection lost' })
    const sent = replies.submit('a', draft)
    await expect(replies.submit('a', draft)).rejects.toThrow('already being sent')
    await sent
    expect(submit).toHaveBeenCalledTimes(2)
    const dispose = replies.begin({ id: 'two', threadId: 'a', title: 'Second?', submit })
    replies.begin({ id: 'three', threadId: 'a', title: 'Third?', submit })
    dispose()
    expect(replies.snapshot('a')?.target.id).toBe('three')
    replies.cancel('a')
    expect(replies.snapshot('a')).toBeUndefined()
  })
})
