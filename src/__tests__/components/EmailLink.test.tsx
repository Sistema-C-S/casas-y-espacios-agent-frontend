// EmailLink used to call sonner's toast, but no <Toaster> is mounted, so the
// "copied" and "could not copy" messages never showed. It must use the app's
// own toast store, which ToastStack renders.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import { EmailLink } from '../../components/shared/EmailLink'
import { useToastStore } from '../../store/toastStore'

const EMAIL = 'cliente@example.com'

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
}

describe('EmailLink toasts', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a success toast in the toast store when the email is copied', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    stubClipboard(writeText)
    render(<EmailLink email={EMAIL} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Copiar correo ${EMAIL}` }))
    })

    expect(writeText).toHaveBeenCalledWith(EMAIL)
    const [toast] = useToastStore.getState().toasts
    expect(toast.message).toBe('Correo copiado')
    expect(toast.type).toBe('success')
  })

  it('shows an error toast in the toast store when the clipboard rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    render(<EmailLink email={EMAIL} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Copiar correo ${EMAIL}` }))
    })

    const [toast] = useToastStore.getState().toasts
    expect(toast.message).toBe('No se pudo copiar el correo')
    expect(toast.type).toBe('error')
  })
})
