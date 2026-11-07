import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const list = vi.fn()
vi.mock('../../services/notifications', () => ({
  notificationsService: { list: (...args: unknown[]) => list(...args) },
}))

import { useNotificationsBadgeSync } from '../../hooks/useNotificationsBadgeSync'
import { useNotificationsStore } from '../../store/notificationsStore'

describe('useNotificationsBadgeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNotificationsStore.getState().reset()
    list.mockResolvedValue({ notifications: [], total: 0, limit: 1, offset: 0, pending_count: 4 })
  })

  it('loads the pending count when enabled and again after a reconnect', async () => {
    renderHook(() => useNotificationsBadgeSync(true))
    await waitFor(() => expect(useNotificationsStore.getState().pendingCount).toBe(4))
    expect(list).toHaveBeenCalledWith({ status: 'pendiente', limit: 1 }, expect.any(AbortSignal), { silent: true })

    list.mockResolvedValue({ notifications: [], total: 0, limit: 1, offset: 0, pending_count: 6 })
    act(() => {
      window.dispatchEvent(new CustomEvent('ws:reconnected'))
    })
    await waitFor(() => expect(useNotificationsStore.getState().pendingCount).toBe(6))
  })

  it('does nothing without a session and aborts on unmount', async () => {
    const { rerender, unmount } = renderHook(({ on }) => useNotificationsBadgeSync(on), {
      initialProps: { on: false },
    })
    expect(list).not.toHaveBeenCalled()
    rerender({ on: true })
    const signal = list.mock.calls[0][1] as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
