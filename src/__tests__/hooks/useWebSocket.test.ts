import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Hoisted so the mock factory below (itself hoisted to the top of the file by
// vitest) can reference them. Only useWebSocket's two named imports from this
// module are mocked — it never touches the default apiClient export.
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
import type { Advisor } from '../../types'

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no proactively-refreshed token, so dial() falls back to the
    // in-memory access token already in the store (set below) — same shape
    // as a real "token still looks fresh" call. Individual tests override
    // this when they need to drive the auth-recovery path explicitly.
    mockGetValidToken.mockResolvedValue(null)
    mockForceRefreshToken.mockResolvedValue(null)

    useAuthStore.setState({
      token: 'test-token',
      refresh_token: 'test-refresh-token',
      expires_at: Date.now() + 3600000,
      advisor: { id: 'advisor-1', role: 'asesor' } as any,
      sessionExpired: false,
    })

    useWSStore.setState({
      status: 'disconnected',
      reconnectAttempt: 0,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('connection lifecycle', () => {
    // With a valid, non-expired token in the store, mounting the hook triggers
    // an immediate connection attempt (see useWebSocket.ts's main effect) —
    // status goes to 'connecting' synchronously, not 'disconnected'. It only
    // stays 'disconnected' when there's no token or the session is expired.
    it('should initialize with connecting status when a valid session exists', () => {
      const { unmount } = renderHook(() => useWebSocket())

      expect(useWSStore.getState().status).toBe('connecting')
      unmount()
    })

    // No status assertion here on purpose: useWebSocket's socket/isConnecting
    // bookkeeping is a module-level singleton with no reset between tests (by
    // design — "exactly one socket active at any time" per the hook's own
    // comments), so the resulting status after a second mount in the same
    // file legitimately depends on whatever the previous test's connection
    // attempt left behind. This test only guards against mount/unmount itself
    // throwing.
    it('mounts and unmounts a second time without throwing', () => {
      const { unmount } = renderHook(() => useWebSocket())
      unmount()
    })
  })

  describe('reconnection logic', () => {
    it('should not reconnect when session is expired', async () => {
      useAuthStore.setState({ sessionExpired: true })
      const { unmount } = renderHook(() => useWebSocket())

      expect(useWSStore.getState().status).toBe('disconnected')
      unmount()
    })

    // refresh_token is only consulted by scheduleReconnect() (used after a live
    // drop, or when the initial WebSocket handshake itself throws) — the mount
    // effect only gates on accessToken/sessionExpired, so with a valid access
    // token still in memory it attempts the initial connection regardless.
    it('attempts to connect using the in-memory access token even without a refresh_token', async () => {
      useAuthStore.setState({ refresh_token: null })
      const { unmount } = renderHook(() => useWebSocket())

      expect(useWSStore.getState().status).toBe('connecting')
      unmount()
    })
  })

  describe('handler registration', () => {
    it('should register onConversationNew handler', () => {
      const handler = vi.fn()
      const { unmount } = renderHook(() => useWebSocket({ onConversationNew: handler }))

      unmount()
    })

    it('should register onEscalationNew handler', () => {
      const handler = vi.fn()
      const { unmount } = renderHook(() => useWebSocket({ onEscalationNew: handler }))

      unmount()
    })

    it('should register onMessageNew handler', () => {
      const handler = vi.fn()
      const { unmount } = renderHook(() => useWebSocket({ onMessageNew: handler }))

      unmount()
    })

    it('should register multiple handlers simultaneously', () => {
      const handlers = {
        onEscalationNew: vi.fn(),
        onMessageNew: vi.fn(),
        onConversationClosed: vi.fn(),
      }
      const { unmount } = renderHook(() => useWebSocket(handlers))

      unmount()
    })
  })

  describe('reconnect method', () => {
    it('should not reconnect if session is expired', () => {
      useAuthStore.setState({ sessionExpired: true })
      const { result, unmount } = renderHook(() => useWebSocket())

      act(() => {
        result.current.reconnect()
      })

      expect(useWSStore.getState().status).toBe('disconnected')
      unmount()
    })

    it('should not reconnect if no token', () => {
      useAuthStore.setState({ token: null })
      const { result, unmount } = renderHook(() => useWebSocket())

      act(() => {
        result.current.reconnect()
      })

      expect(useWSStore.getState().status).toBe('disconnected')
      unmount()
    })
  })

  describe('conversation subscription', () => {
    it('should support subscribing to conversation messages', () => {
      const { result, unmount } = renderHook(() => useWebSocket())

      act(() => {
        result.current.subscribeConversation('conv-123')
      })

      unmount()
    })

    it('should support unsubscribing from conversation', () => {
      const { result, unmount } = renderHook(() => useWebSocket())

      act(() => {
        result.current.subscribeConversation('conv-123')
        result.current.unsubscribeConversation()
      })

      unmount()
    })
  })
})

// jsdom has no native WebSocket implementation, so every test above lets
// connect()'s `new WebSocket(...)` throw and fall into its catch branch —
// none of them ever reach a live socket. This suite stubs a controllable
// WebSocket so the 4001 (auth-rejection) recovery path can actually be
// exercised. Kept as its own top-level describe, appended last, so the
// module-level socket singleton it drives to 'open' cannot bleed backwards
// into the assertions above (see the shared-singleton note in the main
// describe block).
describe('useWebSocket — auth-rejection recovery races a concurrent logout', () => {
  class MockSocket {
    static readonly OPEN = 1
    readyState = MockSocket.OPEN
    onopen: (() => void) | null = null
    onclose: ((event: { code: number }) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    close = vi.fn()
    send = vi.fn()
  }

  let sockets: MockSocket[] = []

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
      }
    )

    mockGetValidToken.mockResolvedValue('test-token')

    useAuthStore.setState({
      token: 'test-token',
      refresh_token: 'test-refresh-token',
      expires_at: Date.now() + 3600000,
      advisor: { id: 'advisor-1', role: 'asesor' } as unknown as Advisor,
      sessionExpired: false,
      sessionNotice: null,
    })

    useWSStore.setState({ status: 'disconnected', reconnectAttempt: 0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not show a bogus "session expired" notice for a WS auth-recovery refresh that settles after a deliberate logout', async () => {
    let resolveForceRefresh!: (token: string | null) => void
    mockForceRefreshToken.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveForceRefresh = resolve
      })
    )

    const { result, unmount } = renderHook(() => useWebSocket())

    // The module-level socket/reconnectTimeout are a singleton shared across
    // every test in this file (see the main describe block's own comments) —
    // an earlier test's real `new WebSocket()` (thrown on, jsdom has none)
    // can leave a pending backoff timer that blocks the mount effect's own
    // dial(). reconnect() bypasses that guard directly, giving each test in
    // this describe a clean, deterministic dial regardless of run order.
    act(() => {
      result.current.reconnect()
    })

    // Flush dial()'s getValidToken() microtask and the mock socket's onopen.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const ws = sockets[sockets.length - 1]
    expect(ws).toBeDefined()

    // Server rejects the token at handshake time — kicks off handleAuthRejection().
    act(() => {
      ws.onclose?.({ code: 4001 })
    })

    // The recovery refresh is now in flight. The user logs out manually
    // before it settles — clearSession() nulls refresh_token and bumps
    // sessionEpoch, exactly like a real "Cerrar sesión" click.
    act(() => {
      useAuthStore.getState().clearSession()
    })

    // The in-flight recovery finally resolves with no token — before the
    // fix, this branch read refresh_token (now null) and called
    // endSession(), overwriting the deliberate logout with a bogus
    // "Tu sesión ha expirado" notice.
    await act(async () => {
      resolveForceRefresh(null)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useAuthStore.getState().sessionExpired).toBe(false)
    expect(useAuthStore.getState().sessionNotice).toBeNull()

    unmount()
  })

  it('still ends the session when the recovery refresh fails with no logout in between', async () => {
    let rejectForceRefresh!: (err: unknown) => void
    mockForceRefreshToken.mockReturnValue(
      new Promise<string | null>((_resolve, reject) => {
        rejectForceRefresh = reject
      })
    )

    const { result, unmount } = renderHook(() => useWebSocket())

    // See the previous test — clears any leftover reconnectTimeout from an
    // earlier test in this shared-singleton module before dialing.
    act(() => {
      result.current.reconnect()
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const ws = sockets[sockets.length - 1]
    expect(ws).toBeDefined()

    act(() => {
      ws.onclose?.({ code: 4001 })
    })

    // No logout this time — the refresh_token in the store is still the
    // original one, so a failed recovery genuinely means a dead session.
    useAuthStore.setState({ refresh_token: null })

    await act(async () => {
      rejectForceRefresh(new Error('network error'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useAuthStore.getState().sessionExpired).toBe(true)
    expect(useAuthStore.getState().sessionNotice).not.toBeNull()

    unmount()
  })
})

describe('useWebSocket — dead sockets and deaf chats', () => {
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

  const sentFrames = (ws: MockSocket) =>
    ws.send.mock.calls.map(([raw]) => JSON.parse(raw as string) as Record<string, unknown>)

  const serverSends = (ws: MockSocket, payload: object) => {
    act(() => {
      ws.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
    })
  }

  // Dials a fresh socket through reconnect() (see the auth-recovery describe
  // above for why: the module singleton may hold a leftover backoff timer).
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
      }
    )
    mockGetValidToken.mockResolvedValue('test-token')
    useAuthStore.setState({
      token: 'test-token',
      refresh_token: 'test-refresh-token',
      expires_at: Date.now() + 3600000,
      advisor: { id: 'advisor-1', role: 'asesor' } as unknown as Advisor,
      sessionExpired: false,
      sessionNotice: null,
    })
    useWSStore.setState({ status: 'disconnected', reconnectAttempt: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('watchdog drops an unanswered socket immediately instead of waiting for onclose', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const { result, unmount } = renderHook(() => useWebSocket())
    const ws = await openSocket(result)
    expect(useWSStore.getState().status).toBe('connected')

    // First ping at 30s goes unanswered (the server vanished without a close
    // frame); the next ticks find it past PONG_TIMEOUT_MS.
    act(() => {
      vi.advanceTimersByTime(90_000)
    })

    expect(ws.close).toHaveBeenCalled()
    // No onclose from the browser yet — the UI must not keep saying 'connected'.
    expect(useWSStore.getState().status).toBe('reconnecting')

    // Backoff fires and a replacement socket is dialed without that onclose.
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sockets.length).toBeGreaterThanOrEqual(2)
    const replacement = sockets[sockets.length - 1]

    // The dead socket's late onclose is a stale no-op: it must not tear down
    // the replacement.
    act(() => {
      ws.onclose?.({ code: 1006 })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(replacement.close).not.toHaveBeenCalled()

    unmount()
  })

  it('retries subscribe_conversation when the server reports UNAVAILABLE', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const { result, unmount } = renderHook(() => useWebSocket())
    const ws = await openSocket(result)

    act(() => {
      result.current.subscribeConversation('conv-1')
    })
    ws.send.mockClear()

    serverSends(ws, { event: 'error', data: { code: 'UNAVAILABLE', conversation_id: 'conv-1' } })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(sentFrames(ws)).toContainEqual({ type: 'subscribe_conversation', conversation_id: 'conv-1' })

    act(() => {
      result.current.unsubscribeConversation()
    })
    unmount()
  })

  // message.new is rebuilt field by field in the handler, not spread from the
  // raw frame — so a new root-level field is dropped on the floor unless it is
  // copied over by name. Meta's 24h window rides there (every inbound message
  // resets it), and losing it means the chat counts its stale expiry down to
  // zero and disables its own composer on a conversation the client just
  // reopened.
  it('carries the 24h window from message.new through to the handler', async () => {
    const onMessageNew = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket({ onMessageNew }))
    const ws = await openSocket(result)

    const expiresAt = '2026-09-21T18:30:00+00:00'
    serverSends(ws, {
      event: 'message.new',
      data: {
        conversation_id: 'conv-1',
        conversation_priority: 'media',
        whatsapp_window_expires_at: expiresAt,
        message: {
          id: 'msg-1',
          conversation_id: 'conv-1',
          direction: 'inbound',
          msg_type: 'text',
          content: 'hola',
          created_at: '2026-09-20T18:30:00+00:00',
        },
      },
    })

    expect(onMessageNew).toHaveBeenCalledTimes(1)
    expect(onMessageNew.mock.calls[0][0].whatsapp_window_expires_at).toBe(expiresAt)

    unmount()
  })

  // Same root-level trap: an onboarding handoff reassigns the conversation's
  // agent mid-turn, and ChatPage/BandejaPage merge it from this field.
  it('carries conversation_agent from message.new through to the handler', async () => {
    const onMessageNew = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket({ onMessageNew }))
    const ws = await openSocket(result)

    serverSends(ws, {
      event: 'message.new',
      data: {
        conversation_id: 'conv-1',
        conversation_agent: 'commercial',
        message: {
          id: 'msg-3',
          conversation_id: 'conv-1',
          direction: 'inbound',
          msg_type: 'text',
          content: 'hola',
          created_at: '2026-09-20T18:30:00+00:00',
        },
      },
    })

    expect(onMessageNew).toHaveBeenCalledTimes(1)
    expect(onMessageNew.mock.calls[0][0].conversation_agent).toBe('commercial')

    unmount()
  })

  it('passes a missing window as null rather than omitting the field', async () => {
    // An older backend, or a lookup the backend could not resolve. Consumers
    // read null as "no fresh information, keep what is cached" — they must not
    // have to tell undefined from null to get there.
    const onMessageNew = vi.fn()
    const { result, unmount } = renderHook(() => useWebSocket({ onMessageNew }))
    const ws = await openSocket(result)

    serverSends(ws, {
      event: 'message.new',
      data: {
        conversation_id: 'conv-1',
        message: {
          id: 'msg-2',
          conversation_id: 'conv-1',
          direction: 'inbound',
          msg_type: 'text',
          content: 'hola',
          created_at: '2026-09-20T18:30:00+00:00',
        },
      },
    })

    expect(onMessageNew).toHaveBeenCalledTimes(1)
    expect(onMessageNew.mock.calls[0][0]).toHaveProperty('whatsapp_window_expires_at', null)

    unmount()
  })

  it('does not retry a FORBIDDEN subscription, nor one for a chat already left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useWebSocket())
    const ws = await openSocket(result)

    act(() => {
      result.current.subscribeConversation('conv-1')
    })
    ws.send.mockClear()

    serverSends(ws, { event: 'error', data: { code: 'FORBIDDEN', conversation_id: 'conv-1' } })
    // A late UNAVAILABLE for a conversation that is no longer open.
    serverSends(ws, { event: 'error', data: { code: 'UNAVAILABLE', conversation_id: 'conv-old' } })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(sentFrames(ws).filter((f) => f.type === 'subscribe_conversation')).toEqual([])

    warn.mockRestore()
    act(() => {
      result.current.unsubscribeConversation()
    })
    unmount()
  })
})

// Returning to the panel is exactly when a client message has just arrived — and
// every WS close observed in DEV on 2026-09-18 landed within seconds of one, one
// of them a client-initiated 1005. The old handler judged the socket on the ping
// that was outstanding when the tab was hidden; a throttled or frozen tab queues
// its pong, so that ping looks unanswered on a perfectly healthy connection.
describe('useWebSocket — returning to a hidden tab', () => {
  class MockSocket {
    static readonly OPEN = 1
    readyState = MockSocket.OPEN
    onopen: (() => void) | null = null
    onclose: ((event: { code: number }) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    close = vi.fn()
    send = vi.fn()
  }

  let sockets: MockSocket[] = []
  let visibility = 'visible'

  const sentPings = (ws: MockSocket) =>
    ws.send.mock.calls.filter(([raw]) => JSON.parse(raw as string).type === 'ping')

  const becomeVisible = () => {
    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
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

  beforeEach(() => {
    vi.clearAllMocks()
    sockets = []
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
    vi.stubGlobal(
      'WebSocket',
      class extends MockSocket {
        constructor() {
          super()
          sockets.push(this)
          queueMicrotask(() => this.onopen?.())
        }
      }
    )
    mockGetValidToken.mockResolvedValue('test-token')
    useAuthStore.setState({
      token: 'test-token',
      refresh_token: 'test-refresh-token',
      expires_at: Date.now() + 3600000,
      advisor: { id: 'advisor-1', role: 'asesor' } as unknown as Advisor,
      sessionExpired: false,
      sessionNotice: null,
    })
    useWSStore.setState({ status: 'disconnected', reconnectAttempt: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('probes instead of dropping a socket whose pong was still queued', async () => {
    const { result, unmount } = renderHook(() => useWebSocket())
    const ws = await openSocket(result)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

    // A ping went out and the tab was hidden long enough for it to look stale.
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    ws.send.mockClear()

    becomeVisible()

    // A fresh probe, not a close.
    expect(sentPings(ws)).toHaveLength(1)
    expect(ws.close).not.toHaveBeenCalled()
    expect(useWSStore.getState().status).toBe('connected')

    // The queued pong lands right after: the socket stays.
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'pong' }) } as MessageEvent)
    })
    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(ws.close).not.toHaveBeenCalled()
    expect(useWSStore.getState().status).toBe('connected')

    unmount()
  })

  it('drops the socket when the probe itself goes unanswered', async () => {
    const { result, unmount } = renderHook(() => useWebSocket())
    const ws = await openSocket(result)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

    // Past the pong recorded when the socket opened, so the probe is newer.
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    becomeVisible()
    expect(ws.close).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5_100)
    })

    expect(ws.close).toHaveBeenCalled()
    expect(useWSStore.getState().status).toBe('reconnecting')

    unmount()
  })
})
