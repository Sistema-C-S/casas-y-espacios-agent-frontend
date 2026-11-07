// The client's email is optional — only commercial prospects are asked for it.
// These pin both halves of the contract: a prospect who gave one gets a
// clickable "Correo" row, and a client without one renders exactly as before
// (no row, no "No registrado" placeholder).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import ClientPanel from '../../components/chat/ClientPanel'
import type { Client } from '../../types'
import {
  PROSPECT_EMAIL,
  clientWithEmail,
  clientWithoutEmail,
  conversationFor,
} from '../fixtures/clients'

function renderPanel(client: Client) {
  return render(
    <ClientPanel
      conversation={conversationFor(client, { status: 'activa' })}
      variant="bot"
      onTake={() => {}}
      onReturnBot={() => {}}
      isTaking={false}
      isReturning={false}
    />,
  )
}

describe('ClientPanel — client email', () => {
  it('shows a "Correo" row with a copy button when the client has an email', () => {
    renderPanel(clientWithEmail())

    expect(screen.getByText('Correo')).toBeInTheDocument()
    const link = screen.getByRole('button', { name: `Copiar correo ${PROSPECT_EMAIL}` })
    expect(link).toHaveTextContent(PROSPECT_EMAIL)
    expect(link).toHaveTextContent(PROSPECT_EMAIL)
  })

  it('does not render the row when the email is null', () => {
    renderPanel(clientWithoutEmail())

    expect(screen.queryByText('Correo')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Enviar correo/ })).not.toBeInTheDocument()
    // The rest of the card is untouched.
    expect(screen.getByText('Documento')).toBeInTheDocument()
  })

  it('does not render the row when the field is absent or empty', () => {
    const { unmount } = renderPanel(clientWithoutEmail({ email: undefined }))
    expect(screen.queryByText('Correo')).not.toBeInTheDocument()
    unmount()

    renderPanel(clientWithoutEmail({ email: '' }))
    expect(screen.queryByText('Correo')).not.toBeInTheDocument()
  })
})
