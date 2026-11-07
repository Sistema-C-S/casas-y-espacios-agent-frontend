// A failed outbound bubble used to be a dead end: the text went back into the
// composer and the advisor had to resend it by hand. With several messages in
// flight that no longer works, so the bubble itself offers the retry.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import MessageBubble from '../../components/chat/MessageBubble'
import type { Message } from '../../types'

function outbound(status?: 'sending' | 'failed'): Message {
  return {
    id: 'local-1',
    conversation_id: 'conv-1',
    wam_id: null,
    direction: 'outbound_advisor',
    msg_type: 'text',
    content: 'hola',
    media_url: null,
    media_mime_type: null,
    transcription: null,
    advisor_name: 'Ana',
    delivered_via: 'panel',
    timestamp: '2026-09-18T17:31:45.000Z',
    created_at: '2026-09-18T17:31:45.000Z',
    _localId: 'local-1',
    _status: status,
  } as Message
}

describe('MessageBubble retry', () => {
  it('offers a retry button on a failed message and reports its local id', () => {
    const onRetry = vi.fn()
    render(<MessageBubble message={outbound('failed')} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(onRetry).toHaveBeenCalledWith('local-1')
  })

  it('shows no retry button on a failed message when the page gave no handler', () => {
    render(<MessageBubble message={outbound('failed')} />)

    expect(screen.getAllByText('No se pudo enviar').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull()
  })

  it('shows no retry button while sending or once delivered', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<MessageBubble message={outbound('sending')} onRetry={onRetry} />)
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull()

    rerender(<MessageBubble message={outbound(undefined)} onRetry={onRetry} />)
    expect(screen.queryByRole('button', { name: /reintentar/i })).toBeNull()
  })
})
