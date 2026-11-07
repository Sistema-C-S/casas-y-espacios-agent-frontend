import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { mockGetValidToken, mockForceRefreshToken } = vi.hoisted(() => ({
  mockGetValidToken: vi.fn(),
  mockForceRefreshToken: vi.fn(),
}))

vi.mock('../../lib/axios', () => ({
  getValidToken: mockGetValidToken,
  forceRefreshToken: mockForceRefreshToken,
}))

import { useWebSocket } from '../../hooks/useWebSocket'
import { useAuthStore } from '../../store/authStore'
import { useWSStore } from '../../store/wsStore'
import { useNotificationsStore } from '../../store/notificationsStore'
import type { Advisor } from '../../types'
import { notification } from '../fixtures/notifications'

class MockSocket {
  static readonly OPEN = 1
  readyState = MockSocket.OPEN
  onopen: (() => void) | null = null
  onclose: ((event: { code: number; reason?: string; wasClean?: boolean }) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  send = vi.fn()
}

let sockets: MockSocket[] = []

const serverSends = (ws: MockSocket, payload: object) => {
  act(() => {
    ws.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  })
}

async function openSocket(result: { current: ReturnType<typeof useWebSocket> }) {
  act(() => {
    result.current.reconnect()
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return sockets[sockets.length - 1]
}

describe('useWebSocket — agent notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sockets = []
    vi.stubGlobal(
      'WebSocket',
      class extends MockSocket {
        constructor() {
          super()
          sockets.push(this)
          queueMicrotask(() => this.onopen?.())
        }
      },
    )
    mockGetValidToken.mockResolvedValue('test-token')
    useAuthStore.setState({
      token: 'test-token',
      refresh_token: 'test-refresh-token',
      expires_at: Date.now() + 3600000,
      advisor: { id: 'advisor-1', role: 'admin' } as unknown as Advisor,
      sessionExpired: false,
      sessionNotice: null,
    })
    useWSStore.setState({ status: 'disconnected', reconnectAttempt: 0 })
    useNotificationsStore.getState().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('notification.new updates the badge, queues the toast and reaches the page handler', async () => {
    const onNotificationNew = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket({ onNotificationNew }))
    const ws = await openSocket(result)

    const item = notification({ id: 'n-new' })
    serverSends(ws, { event: 'notification.new', data: { notification: item, pending_count: 8 } })

    expect(useNotificationsStore.getState().pendingCount).toBe(8)
    expect(useNotificationsStore.getState().incoming?.id).toBe('n-new')
    expect(onNotificationNew).toHaveBeenCalledWith({ notification: item, pending_count: 8 })
    unmount()
  })

  it('notification.updated only updates the badge and the page — no toast', async () => {
    const onNotificationUpdated = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket({ onNotificationUpdated }))
    const ws = await openSocket(result)

    const item = notification({ id: 'n-1', status: 'resuelta' })
    serverSends(ws, { event: 'notification.updated', data: { notification: item, pending_count: 2 } })

    expect(useNotificationsStore.getState().pendingCount).toBe(2)
    expect(useNotificationsStore.getState().incoming).toBeNull()
    expect(onNotificationUpdated).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('ignores a malformed payload without touching the store', async () => {
    const onNotificationNew = vi.fn()
    useNotificationsStore.getState().setPendingCount(5)
    const { result, unmount } = renderHook(() => useWebSocket({ onNotificationNew }))
    const ws = await openSocket(result)

    serverSends(ws, { event: 'notification.new', data: { pending_count: 'x' } })
    serverSends(ws, { event: 'notification.new', data: null })

    expect(useNotificationsStore.getState().pendingCount).toBe(5)
    expect(onNotificationNew).not.toHaveBeenCalled()
    unmount()
  })
})

describe('notificationsStore', () => {
  it('resets when the session ends', () => {
    useNotificationsStore.getState().setPendingCount(4)
    useNotificationsStore.getState().setIncoming(notification())
    act(() => {
      useAuthStore.setState((s) => ({ sessionEpoch: s.sessionEpoch + 1 }))
    })
    expect(useNotificationsStore.getState().pendingCount).toBe(0)
    expect(useNotificationsStore.getState().incoming).toBeNull()
  })

  it('ignores an HTTP count that started before a fresher live count', () => {
    const requestStartedAt = Date.now() - 1000
    useNotificationsStore.getState().setPendingCount(9)
    useNotificationsStore.getState().setPendingCountSnapshot(4, requestStartedAt)
    expect(useNotificationsStore.getState().pendingCount).toBe(9)
    useNotificationsStore.getState().setPendingCountSnapshot(3, Date.now() + 1000)
    expect(useNotificationsStore.getState().pendingCount).toBe(3)
  })

  it('drops a partial notification payload instead of passing it on', async () => {
    const onNotificationNew = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket({ onNotificationNew }))
    const ws = await openSocket(result)
    serverSends(ws, {
      event: 'notification.new',
      data: { notification: { ...notification(), client: null }, pending_count: 1 },
    })
    expect(onNotificationNew).not.toHaveBeenCalled()
    unmount()
  })

  it('never stores a negative or non-numeric count', () => {
    useNotificationsStore.getState().setPendingCount(-3)
    expect(useNotificationsStore.getState().pendingCount).toBe(0)
    useNotificationsStore.getState().setPendingCount(Number.NaN)
    expect(useNotificationsStore.getState().pendingCount).toBe(0)
  })
})
