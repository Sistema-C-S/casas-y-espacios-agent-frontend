// Every INBOUND message restarts Meta's 24h window on the backend. The chat used
// to ignore that: it kept counting down the expiry it loaded with, hit zero, and
// disabled its own composer on a conversation the client had just reopened for
// another 24 hours. Fail-closed, triggered by the most common event in the
// system, and precisely while the advisor is in that chat *because* the client
// wrote. The fresh expiry rides on the `message.new` payload, so no refetch.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import type { Conversation, Message, WSMessageNew } from '../../types'

type WSHandlersForTest = { onMessageNew?: (data: WSMessageNew) => void }

const ADVISOR_ID = 'adv-1'
const CONVERSATION_ID = 'conv-1'

// Captured from the mocked hook so the test can fire WS events at the page.
let wsHandlers: WSHandlersForTest = {}

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: (handlers: WSHandlersForTest) => {
    wsHandlers = handlers
    return {
      subscribeConversation: vi.fn(),
      unsubscribeConversation: vi.fn(),
    }
  },
  consumePendingTransferReason: () => null,
}))

// The recorder pulls in mic-recorder-to-mp3-fixed, which has no business being
// instantiated in jsdom — the composer's enabled/disabled state is what matters.
vi.mock('../../components/chat/AudioRecorder', () => ({
  default: () => null,
}))

const getById = vi.fn()
const markAsSeen = vi.fn().mockResolvedValue({ unread_count: 0 })

vi.mock('../../services/conversations', () => ({
  conversationsService: {
    getById: (...args: unknown[]) => getById(...args),
    getMessages: vi.fn().mockResolvedValue({ messages: [], total: 0 }),
    markAsSeen: (...args: unknown[]) => markAsSeen(...args),
  },
}))

import ChatPage from '../../pages/ChatPage'
import { useAuthStore } from '../../store/authStore'

function conversation(expiresAt: string | null): Conversation {
  return {
    id: CONVERSATION_ID,
    status: 'escalada',
    bot_activo: false,
    has_escalation_history: true,
    channel: 'administrativa',
    agent: 'administrative',
    last_activity: new Date().toISOString(),
    intent: 'cartera',
    client: {
      id: 'cli-1',
      phone_number: '+573001234567',
      bsuid: null,
      user_name: null,
      full_name: 'Carlos Rodríguez',
      document_id: null,
      client_type: 'propietario',
    },
    escalation: {
      id: 'esc-1',
      reason: 'solicitud_usuario',
      summary: null,
      escalated_at: new Date().toISOString(),
      advisor: { id: ADVISOR_ID, full_name: 'Ana Gómez' },
    },
    resolution_type: null,
    resolution_notes: null,
    client_satisfied: null,
    closed_by: null,
    closed_by_advisor: null,
    closed_at: null,
    duration_seconds: null,
    last_message: null,
    whatsapp_window_expires_at: expiresAt,
    unread_count: 0,
    priority: 'media',
    case_number: 'CE-0001',
  } as Conversation
}

function inboundMessage(): Message {
  return {
    id: 'msg-nuevo',
    conversation_id: CONVERSATION_ID,
    wam_id: 'wamid.NEW',
    direction: 'inbound',
    msg_type: 'text',
    content: '¿Siguen ahí?',
    media_url: null,
    media_mime_type: null,
    transcription: null,
    advisor_name: null,
    delivered_via: 'webhook_meta',
    timestamp: new Date().toISOString(),
    created_at: new Date().toISOString(),
  } as Message
}

function renderChat() {
  return render(
    <MemoryRouter initialEntries={[`/chat/${CONVERSATION_ID}`]}>
      <Routes>
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/" element={<div>bandeja</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const composer = () =>
  screen.getByPlaceholderText(/Escribe tu respuesta|Ventana de 24 h cerrada/i)

// The countdown interpolates the formatted value, so React renders it as several
// text nodes inside one span — matching on the element's textContent instead of
// getByText avoids asserting against a fragment of the sentence.
const countdownText = () =>
  document.getElementById('chat-window-countdown')?.textContent ?? ''

beforeEach(() => {
  wsHandlers = {}
  getById.mockReset()
  markAsSeen.mockClear()
  useAuthStore.setState({
    advisor: {
      id: ADVISOR_ID,
      full_name: 'Ana Gómez',
      email: 'ana@example.com',
      role: 'asesor',
      area: 'administrativa',
      max_conversations: 3,
      active_conversations: 1,
      availability_status: 'available',
      is_active: true,
      avatar_url: null,
      must_change_password: false,
    },
    role: 'asesor',
  })
})

describe('ChatPage — 24h window refreshed by an inbound message', () => {
  it('re-enables the composer when message.new brings a fresh expiry', async () => {
    // Loaded with a window that expired a minute ago: composer locked.
    const expired = new Date(Date.now() - 60_000).toISOString()
    getById.mockResolvedValue({
      conversation: conversation(expired),
      messages: [],
      total_messages: 0,
    })

    renderChat()

    await waitFor(() => expect(composer()).toBeDisabled())

    // The client writes. Meta's clock restarts, and the event says so.
    const reopened = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await act(async () => {
      wsHandlers.onMessageNew?.({
        message: inboundMessage(),
        whatsapp_window_expires_at: reopened,
      })
    })

    expect(composer()).toBeEnabled()
    // ...and it learned this without spending an HTTP request on it.
    expect(getById).toHaveBeenCalledTimes(1)
  })

  it('shows the refreshed countdown instead of the one it loaded with', async () => {
    // 30 minutes left — under the 2h threshold, so the page is warning already.
    // 30 s short of 30 min: the countdown floors to 29 min however fast the render is
    // (exactly +30 min read "30 min" whenever no millisecond passed — a flaky test).
    const nearlyOver = new Date(Date.now() + 30 * 60 * 1000 - 30_000).toISOString()
    getById.mockResolvedValue({
      conversation: conversation(nearlyOver),
      messages: [],
      total_messages: 0,
    })

    renderChat()

    await waitFor(() => expect(countdownText()).toMatch(/29 min/))

    const reopened = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await act(async () => {
      wsHandlers.onMessageNew?.({
        message: inboundMessage(),
        whatsapp_window_expires_at: reopened,
      })
    })

    // Hours, not the 29 minutes it was loaded with. The exact figure depends on
    // how far the hook's local clock has ticked, so match the magnitude.
    expect(countdownText()).toMatch(/2[34] h/)
    expect(countdownText()).not.toMatch(/29 min/)
  })

  it('keeps the known expiry when the event carries a null window', async () => {
    // null means the backend could not resolve it — the window only ever moves
    // forward, so it never legitimately reverts to unknown. Overwriting here
    // would throw away a countdown that is still correct.
    // 30 s short of 3 h: always "2 h 59 min" (see nearlyOver above).
    const inThreeHours = new Date(Date.now() + 3 * 60 * 60 * 1000 - 30_000).toISOString()
    getById.mockResolvedValue({
      conversation: conversation(inThreeHours),
      messages: [],
      total_messages: 0,
    })

    renderChat()

    await waitFor(() => expect(countdownText()).toMatch(/2 h 59 min/))

    await act(async () => {
      wsHandlers.onMessageNew?.({
        message: inboundMessage(),
        whatsapp_window_expires_at: null,
      })
    })

    expect(countdownText()).toMatch(/2 h 59 min/)
  })
})
