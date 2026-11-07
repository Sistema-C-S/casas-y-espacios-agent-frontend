import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import NotificationToast from '../../components/shared/NotificationToast'
import { useNotificationsStore } from '../../store/notificationsStore'
import { notification } from '../fixtures/notifications'

function Where() {
  const location = useLocation()
  return <span data-testid="where">{location.pathname + location.search}</span>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationToast />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotificationToast', () => {
  beforeEach(() => {
    useNotificationsStore.getState().reset()
  })

  it('announces a new receipt and opens it in the inbox', () => {
    useNotificationsStore.getState().setIncoming(notification({ id: 'n-9' }))
    renderAt('/')

    expect(screen.getByText('Nuevo comprobante de pago')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Comprobante de pago enviado por el cliente')).toBeInTheDocument()
    expect(screen.queryByText(/1\.850\.000/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(screen.getByTestId('where').textContent).toBe('/notificaciones?status=pendiente&id=n-9')
    expect(useNotificationsStore.getState().incoming).toBeNull()
  })

  it('stays hidden on the notifications page and clears the pending toast', () => {
    useNotificationsStore.getState().setIncoming(notification())
    renderAt('/notificaciones')
    expect(screen.queryByText('Nuevo comprobante de pago')).not.toBeInTheDocument()
    expect(useNotificationsStore.getState().incoming).toBeNull()
  })
})
