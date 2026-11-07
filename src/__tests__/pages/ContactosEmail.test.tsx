// Contactos shows the email under the client's name only when it exists. A
// client without one must not leave an empty label or a "—" behind.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'

const list = vi.fn()

vi.mock('../../services/clients', () => ({
  clientsService: {
    list: (...args: unknown[]) => list(...args),
  },
}))

import ContactosPage from '../../pages/ContactosPage'
import {
  PROSPECT_EMAIL,
  clientWithEmail,
  clientWithoutEmail,
  directoryEntry,
} from '../fixtures/clients'

async function rowFor(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

beforeEach(() => {
  list.mockReset()
  list.mockResolvedValue({
    total: 2,
    clients: [directoryEntry(clientWithEmail()), directoryEntry(clientWithoutEmail())],
  })
})

describe('ContactosPage — client email', () => {
  it('shows the email as a copy button when the client has one', async () => {
    render(<ContactosPage />)

    const row = await rowFor('Laura Gómez')
    const link = within(row).getByRole('button', { name: `Copiar correo ${PROSPECT_EMAIL}` })
    expect(link).toHaveTextContent(PROSPECT_EMAIL)
  })

  it('leaves no empty label behind when the client has no email', async () => {
    render(<ContactosPage />)

    const row = await rowFor('Carlos Rodríguez')
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    await waitFor(() => {
      // Only the name paragraph lives in the name cell — no second, empty line.
      const nameCell = within(row).getByText('Carlos Rodríguez').closest('td')
      expect(nameCell?.children).toHaveLength(1)
    })
  })
})
