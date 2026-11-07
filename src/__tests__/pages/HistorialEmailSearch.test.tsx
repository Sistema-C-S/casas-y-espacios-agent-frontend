// The history search is client-side over the loaded set. A prospect's email is
// one of the things an advisor searches by, so it has to match too.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const list = vi.fn()

vi.mock('../../services/conversations', () => ({
  conversationsService: {
    list: (...args: unknown[]) => list(...args),
  },
}))

import HistorialPage from '../../pages/HistorialPage'
import { clientWithEmail, clientWithoutEmail, conversationFor } from '../fixtures/clients'

function renderedCaseNumbers(): string[] {
  return Array.from(document.querySelectorAll('#history-table-body tr')).map(
    (row) => row.querySelector('td')?.textContent?.trim() ?? '',
  )
}

beforeEach(() => {
  list.mockReset()
  list.mockResolvedValue({
    total: 2,
    conversations: [
      conversationFor(clientWithEmail(), { case_number: 'CE-0101' }),
      conversationFor(clientWithoutEmail(), { case_number: 'CE-0102' }),
    ],
  })
})

describe('HistorialPage — search by client email', () => {
  it('finds the conversation whose client email matches, case-insensitively', async () => {
    render(
      <MemoryRouter>
        <HistorialPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(renderedCaseNumbers()).toHaveLength(2))

    fireEvent.change(screen.getByPlaceholderText(/Buscar por cliente/i), {
      target: { value: 'LAURA.GOMEZ@' },
    })

    await waitFor(() => expect(renderedCaseNumbers()).toEqual(['CE-0101']))
  })
})
