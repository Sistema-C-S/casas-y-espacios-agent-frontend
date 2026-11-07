import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AxiosError, type AxiosResponse } from 'axios'
import type { Advisor, WSNotificationEvent } from '../../types'
import { notification } from '../fixtures/notifications'

const wsHandlers: {
  onNotificationNew?: (data: WSNotificationEvent) => void
  onNotificationUpdated?: (data: WSNotificationEvent) => void
} = {}

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: (handlers?: typeof wsHandlers) => {
    Object.assign(wsHandlers, handlers)
    return { reconnect: vi.fn() }
  },
}))

const list = vi.fn()
const getById = vi.fn()
const close = vi.fn()

vi.mock('../../services/notifications', () => ({
  notificationsService: {
    list: (...args: unknown[]) => list(...args),
    getById: (...args: unknown[]) => getById(...args),
    close: (...args: unknown[]) => close(...args),
  },
}))

import NotificationsPage from '../../pages/NotificationsPage'
import { useAuthStore } from '../../store/authStore'
import { useToastStore } from '../../store/toastStore'
import { useNotificationsStore } from '../../store/notificationsStore'

function apiError(status: number, code?: string) {
  return new AxiosError('error', String(status), undefined, undefined, {
    status,
    data: code ? { detail: { code, message: '' } } : {},
  } as AxiosResponse)
}

function ChatProbe() {
  const location = useLocation()
  return <pre data-testid="chat-state">{JSON.stringify({ path: location.pathname, state: location.state })}</pre>
}

function renderPage(entry = '/notificaciones') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/notificaciones" element={<NotificationsPage />} />
        <Route path="/chat/:id" element={<ChatProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

const pendingA = notification({ id: 'a', title: 'Comprobante A', created_at: '2026-10-04T15:00:00Z' })
const pendingB = notification({
  id: 'b',
  title: 'Comprobante B',
  created_at: '2026-10-04T14:00:00Z',
  conversation: { id: 'conv-b', case_number: 'CE-777', status: 'cerrada' },
})

const closedBy = (name: string, status: 'resuelta' | 'descartada' = 'resuelta') => ({
  ...pendingA,
  status,
  updated_at: '2026-10-04T16:00:00Z',
  resolved_by: { id: 'adv-2', full_name: name },
})

async function rowOf(caseNumber: string): Promise<HTMLElement> {
  return (await screen.findByText(caseNumber)).closest('tr') as HTMLElement
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key as keyof typeof wsHandlers]
    useToastStore.setState({ toasts: [] })
    useNotificationsStore.getState().reset()
    useAuthStore.setState({ advisor: { id: 'adv-1', full_name: 'Ana' } as unknown as Advisor })
    list.mockResolvedValue({ notifications: [pendingA, pendingB], total: 2, limit: 20, offset: 0, pending_count: 2 })
  })

  it('loads pending notifications as table rows and updates the badge', async () => {
    renderPage()
    const row = await rowOf('CE-777')
    expect(within(row).getByText('Conversación cerrada')).toBeInTheDocument()
    expect(within(row).getByText('Juan Pérez')).toBeInTheDocument()
    expect(within(row).getByText('Comprobante de pago enviado por el cliente')).toBeInTheDocument()
    // Only what the notification is — never the machine-read payment data.
    expect(within(row).queryByText(/1\.850\.000|Canon|Bancolombia|123456/)).not.toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({ status: 'pendiente', limit: 20, offset: 0 }, expect.any(AbortSignal))
    expect(useNotificationsStore.getState().pendingCount).toBe(2)
  })

  it('renders a row whose conversation status is null (the backend join was missing)', async () => {
    const orphan = notification({
      id: 'z',
      conversation: { id: 'conv-z', case_number: 'CE-555', status: null },
    })
    list.mockResolvedValue({ notifications: [orphan], total: 1, limit: 20, offset: 0, pending_count: 1 })
    renderPage()
    const row = await rowOf('CE-555')
    expect(within(row).queryByText('Conversación cerrada')).not.toBeInTheDocument()
  })

  it('resolves a notification from its row and drops it from the pending tab', async () => {
    close.mockResolvedValue({ notification: { ...closedBy('Ana'), resolved_by: { id: 'adv-1', full_name: 'Ana' } } })
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Juan Pérez · Comprobante de pago enviado por el cliente')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Registrado' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar como resuelta' }))

    await waitFor(() => expect(close).toHaveBeenCalledWith('a', { status: 'resuelta', note: 'Registrado' }, { silent: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useToastStore.getState().toasts[0].message).toBe('Notificación marcada como resuelta.')
    expect(screen.queryByText('CE-123')).not.toBeInTheDocument()
  })

  it('decrements the badge locally when a pending notification is closed, and converges with the WS event', async () => {
    close.mockResolvedValue({ notification: { ...closedBy('Ana'), resolved_by: { id: 'adv-1', full_name: 'Ana' } } })
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar como resuelta' }))
    await waitFor(() => expect(useNotificationsStore.getState().pendingCount).toBe(1))

    // The authoritative event lands after the local decrement: same number, not 0.
    act(() => {
      // useWebSocket applies pending_count to the store before calling the page handler.
      useNotificationsStore.getState().setPendingCount(1)
      wsHandlers.onNotificationUpdated?.({ notification: closedBy('Ana'), pending_count: 1 })
    })
    expect(useNotificationsStore.getState().pendingCount).toBe(1)
  })

  it('does not decrement twice when the WS event arrives before the PATCH response', async () => {
    let resolveClose!: (value: unknown) => void
    close.mockReturnValue(new Promise((resolve) => { resolveClose = resolve }))
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar como resuelta' }))
    await waitFor(() => expect(close).toHaveBeenCalled())

    act(() => {
      // useWebSocket applies pending_count to the store before calling the page handler.
      useNotificationsStore.getState().setPendingCount(1)
      wsHandlers.onNotificationUpdated?.({ notification: closedBy('Ana'), pending_count: 1 })
    })
    expect(useNotificationsStore.getState().pendingCount).toBe(1)
    await act(async () => {
      resolveClose({ notification: { ...closedBy('Ana'), resolved_by: { id: 'adv-1', full_name: 'Ana' } } })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useNotificationsStore.getState().pendingCount).toBe(1)
  })

  it('requires a note to discard', async () => {
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Descartar' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }))
    expect(await within(dialog).findByText('Indica por qué descartas esta notificación.')).toBeInTheDocument()
    expect(close).not.toHaveBeenCalled()
  })

  it('on 409 refetches the row and says who closed it', async () => {
    close.mockRejectedValue(apiError(409, 'NOTIFICATION_ALREADY_CLOSED'))
    getById.mockResolvedValue({ notification: closedBy('Laura Gómez') })
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar como resuelta' }))

    await waitFor(() => expect(getById).toHaveBeenCalledWith('a', expect.any(AbortSignal), { silent: true }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Laura Gómez ya cerró esta notificación.'),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open when a 503 close cannot be confirmed', async () => {
    close.mockRejectedValue(apiError(503, 'SUPABASE_ERROR'))
    getById.mockResolvedValue({ notification: pendingA })
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar como resuelta' }))
    expect(await screen.findByText('No se pudo confirmar el cierre. Intenta de nuevo.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('sends the close and its follow-up refetch silently so the interceptor does not stack a second toast', async () => {
    close.mockRejectedValue(apiError(503, 'SUPABASE_ERROR'))
    getById.mockResolvedValue({ notification: pendingA })
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar como resuelta' }))
    await screen.findByText('No se pudo confirmar el cierre. Intenta de nuevo.')
    expect(close).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'resuelta' }), { silent: true })
    expect(getById).toHaveBeenCalledWith('a', expect.any(AbortSignal), { silent: true })
  })

  it('on 503 does not claim a close that another advisor made', async () => {
    close.mockRejectedValue(apiError(503, 'SUPABASE_ERROR'))
    getById.mockResolvedValue({ notification: closedBy('Laura Gómez', 'descartada') })
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Marcar como resuelta' }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Laura Gómez ya cerró esta notificación.'),
    )
    expect(useToastStore.getState().toasts.map((t) => t.message)).not.toContain('Notificación marcada como resuelta.')
  })

  it('inserts a live notification at the top of the table', async () => {
    renderPage()
    await rowOf('CE-123')
    act(() => {
      wsHandlers.onNotificationNew?.({
        notification: notification({
          id: 'c',
          created_at: '2026-10-04T17:00:00Z',
          conversation: { id: 'conv-c', case_number: 'CE-999', status: 'activa' },
        }),
        pending_count: 3,
      })
    })
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(within(bodyRows[0]).getByText('CE-999')).toBeInTheDocument()
  })

  it('drops the dialog when another advisor closes the notification first', async () => {
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Resolver' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => {
      wsHandlers.onNotificationUpdated?.({ notification: closedBy('Laura Gómez', 'descartada'), pending_count: 1 })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Laura Gómez ya cerró esta notificación.')
  })

  it('shows who closed a notification and the note in the resolved tab', async () => {
    list.mockResolvedValue({
      notifications: [{ ...closedBy('Laura Gómez'), resolution_note: 'En SIMI' }],
      total: 1,
      limit: 20,
      offset: 0,
      pending_count: 0,
    })
    renderPage('/notificaciones?status=resuelta')
    const row = await rowOf('CE-123')
    expect(within(row).getByText(/Laura Gómez/)).toBeInTheDocument()
    expect(within(row).getByText('En SIMI')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument()
  })

  it('opens the chat on the receipt message with a way back', async () => {
    renderPage()
    fireEvent.click(within(await rowOf('CE-123')).getByRole('button', { name: 'Abrir chat' }))
    const probe = JSON.parse((await screen.findByTestId('chat-state')).textContent ?? '{}')
    expect(probe.path).toBe('/chat/conv-1')
    expect(probe.state).toEqual({
      fromNotification: { id: 'a', title: 'Comprobante de pago enviado por el cliente', status: 'pendiente' },
      focusWamId: 'wamid.ATTACH1',
    })
  })
})
