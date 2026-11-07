// The composer used to disable itself until each send finished, so an advisor
// answering a chatty client had to wait on every HTTP round-trip. Sends now run
// through a serial queue: the bubble paints and the composer clears at once, the
// requests leave one at a time in the order they were written, and a failure
// stops the queue so nothing is delivered ahead of the message that failed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import type { Message } from '../../types'

vi.mock('../../components/chat/AudioRecorder', () => ({ default: () => null }))

const replyText = vi.fn()
vi.mock('../../services/conversations', () => ({
  conversationsService: {
    replyText: (...args: unknown[]) => replyText(...args),
    replyMedia: vi.fn(),
  },
}))

import ChatInput from '../../components/chat/ChatInput'

type Retry = (localId: string) => void

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function serverMessage(id: string, content: string): { message: Message } {
  return { message: { id, content } as Message }
}

const flush = () => act(async () => { await Promise.resolve() })

function setup(windowState: 'open' | 'closed' = 'open') {
  const onOptimisticMessage = vi.fn()
  const onMessageConfirmed = vi.fn()
  const onMessageFailed = vi.fn()
  let retry: Retry | null = null

  render(
    <ChatInput
      conversationId="conv-1"
      clientName="Cliente"
      agentDisplay="Administrativa"
      waitMinutes={null}
      onOptimisticMessage={onOptimisticMessage}
      onMessageConfirmed={onMessageConfirmed}
      onMessageFailed={onMessageFailed}
      onRegisterRetry={(fn) => { retry = fn }}
      whatsappWindow={{
        state: windowState,
        canReply: windowState === 'open',
        msLeft: windowState === 'open' ? 3_600_000 : 0,
      }}
    />,
  )

  const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement
  const send = (text: string) => {
    fireEvent.change(textarea(), { target: { value: text } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
  }

  return {
    onOptimisticMessage,
    onMessageConfirmed,
    onMessageFailed,
    getRetry: () => retry,
    textarea,
    send,
  }
}

beforeEach(() => {
  replyText.mockReset()
})

describe('ChatInput send queue', () => {
  it('clears the composer and keeps it usable while a send is in flight', async () => {
    const first = deferred<{ message: Message }>()
    replyText.mockReturnValueOnce(first.promise)
    const ui = setup()

    ui.send('hola')
    await flush()

    expect(ui.onOptimisticMessage).toHaveBeenCalledTimes(1)
    expect(ui.textarea().value).toBe('')
    expect(ui.textarea().disabled).toBe(false)
  })

  it('sends a second message only after the first one finished, in order', async () => {
    const first = deferred<{ message: Message }>()
    const second = deferred<{ message: Message }>()
    replyText.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const ui = setup()

    ui.send('uno')
    ui.send('dos')
    await flush()

    // Both bubbles are on screen, but only the first request has left.
    expect(ui.onOptimisticMessage).toHaveBeenCalledTimes(2)
    expect(replyText).toHaveBeenCalledTimes(1)
    expect(replyText).toHaveBeenLastCalledWith('conv-1', 'uno')

    await act(async () => { first.resolve(serverMessage('m1', 'uno')) })
    await flush()

    expect(replyText).toHaveBeenCalledTimes(2)
    expect(replyText).toHaveBeenLastCalledWith('conv-1', 'dos')

    await act(async () => { second.resolve(serverMessage('m2', 'dos')) })
    await flush()

    expect(ui.onMessageConfirmed).toHaveBeenCalledTimes(2)
  })

  it('marks the failed message and the ones queued behind it without sending them', async () => {
    const first = deferred<{ message: Message }>()
    replyText.mockReturnValueOnce(first.promise)
    const ui = setup()

    ui.send('uno')
    ui.send('dos')
    await flush()

    await act(async () => { first.reject(new Error('network')) })
    await flush()
    await flush()

    expect(replyText).toHaveBeenCalledTimes(1)
    expect(ui.onMessageFailed).toHaveBeenCalledTimes(2)
    const [firstId, secondId] = ui.onOptimisticMessage.mock.calls.map(
      (call) => (call[0] as Message)._localId,
    )
    expect(ui.onMessageFailed).toHaveBeenNthCalledWith(1, firstId)
    expect(ui.onMessageFailed).toHaveBeenNthCalledWith(2, secondId)
  })

  it('does not overwrite what the advisor is typing when a send fails', async () => {
    const first = deferred<{ message: Message }>()
    replyText.mockReturnValueOnce(first.promise)
    const ui = setup()

    ui.send('uno')
    fireEvent.change(ui.textarea(), { target: { value: 'borrador' } })
    await act(async () => { first.reject(new Error('network')) })
    await flush()

    expect(ui.textarea().value).toBe('borrador')
  })

  it('retries a failed message in place with the same local id', async () => {
    replyText
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(serverMessage('m1', 'uno'))
    const ui = setup()

    ui.send('uno')
    await flush()
    await flush()
    const localId = ui.onOptimisticMessage.mock.calls[0][0]._localId

    act(() => { ui.getRetry()?.(localId) })
    await flush()
    await flush()

    expect(replyText).toHaveBeenCalledTimes(2)
    expect(replyText).toHaveBeenLastCalledWith('conv-1', 'uno')
    const repainted = ui.onOptimisticMessage.mock.calls[1][0] as Message
    expect(repainted._localId).toBe(localId)
    expect(repainted._status).toBe('sending')
    expect(ui.onMessageConfirmed).toHaveBeenCalledWith(localId, expect.objectContaining({ id: 'm1' }))
  })

  it('ignores a retry for a message it does not know', async () => {
    const ui = setup()

    act(() => { ui.getRetry()?.('local-unknown') })
    await flush()

    expect(replyText).not.toHaveBeenCalled()
    expect(ui.onOptimisticMessage).not.toHaveBeenCalled()
  })
})
