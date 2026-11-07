// PROD 2026-10-08: the client wrote again after the bot closed the
// conversation, so the router opened a new one. "Reabrir" on the old one got
// 409 CLIENT_HAS_ACTIVE_CONVERSATION, the advisor only saw a toast and kept
// retrying, and an admin had to step in. The backend now names the live
// conversation — the panel must take her there.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'

import type { Conversation } from '../../types'
import { ROUTES } from '../../constants/routes'
import { useToastStore } from '../../store/toastStore'

const list = vi.fn()
const reopen = vi.fn()

vi.mock('../../services/conversations', () => ({
  conversationsService: {
    list: (...args: unknown[]) => list(...args),
    reopen: (...args: unknown[]) => reopen(...args),
  },
}))

import HistorialPage from '../../pages/HistorialPage'

function closedConversation(): Conversation {
  return {
    id: 'conv-closed',
    status: 'cerrada',
    bot_activo: true,
    has_escalation_history: false,
    channel: 'administrativa',
    agent: 'administrative',
    last_activity: '2026-10-08T19:33:35+00:00',
    intent: 'faq',
    client: {
      id: 'cli-1',
      phone_number: '+573001234567',
      bsuid: null,
      user_name: null,
      full_name: 'Carlos Rodríguez',
      document_id: null,
      client_type: 'arrendatario',
    },
    escalation: null,
    resolution_type: 'otro',
    resolution_notes: null,
    client_satisfied: 'si',
    closed_by: 'bot',
    closed_by_advisor: null,
    closed_at: '2026-10-08T19:33:35+00:00',
    duration_seconds: 600,
    last_message: null,
    // Open window: otherwise "Reabrir" renders disabled and is never clicked.
    whatsapp_window_expires_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    unread_count: 0,
    priority: 'baja',
    case_number: 'CE-2026-000100',
  } as Conversation
}

function conflict(detail: Record<string, unknown>) {
  return Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, data: { detail } },
  })
}

function OpenedChat() {
  const { id } = useParams<{ id: string }>()
  return <div>chat abierto: {id}</div>
}

function renderHistorial() {
  return render(
    <MemoryRouter initialEntries={['/historial']}>
      <Routes>
        <Route path="/historial" element={<HistorialPage />} />
        <Route path={ROUTES.CHAT} element={<OpenedChat />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function clickReopen() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }))
}

beforeEach(() => {
  list.mockReset()
  reopen.mockReset()
  useToastStore.setState({ toasts: [] })
  list.mockResolvedValue({ total: 1, conversations: [closedConversation()] })
})

describe('HistorialPage — reopen blocked by a live conversation', () => {
  it('opens the live conversation the backend named, and says why', async () => {
    reopen.mockRejectedValue(
      conflict({
        code: 'CLIENT_HAS_ACTIVE_CONVERSATION',
        message: 'El cliente ya tiene una conversación activa',
        active_conversation: {
          id: 'conv-live',
          status: 'activa',
          bot_activo: true,
          case_number: 'CE-2026-000123',
        },
      }),
    )

    renderHistorial()
    await clickReopen()

    expect(await screen.findByText('chat abierto: conv-live')).toBeTruthy()
    const [toast] = useToastStore.getState().toasts
    expect(toast.type).toBe('warning')
    expect(toast.message).toContain('CE-2026-000123')
    expect(toast.message).toContain('«Tomar control manual»')
    expect(toast.durationMs).toBeGreaterThanOrEqual(10_000)
  })

  it('stays put with the backend message when the live conversation is not named', async () => {
    reopen.mockRejectedValue(
      conflict({
        code: 'CLIENT_HAS_ACTIVE_CONVERSATION',
        message: 'El cliente ya tiene una conversación activa — ábrala desde ahí',
      }),
    )

    renderHistorial()
    await clickReopen()

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    const [toast] = useToastStore.getState().toasts
    expect(toast.type).toBe('error')
    expect(toast.message).toBe('El cliente ya tiene una conversación activa — ábrala desde ahí')
    expect(screen.queryByText(/chat abierto/)).toBeNull()
  })
})
