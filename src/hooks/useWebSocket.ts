// Hook to manage WebSocket connection and handle real-time events.
import { useEffect, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { useWSStore } from '../store/wsStore'
import { useToastStore } from '../store/toastStore'
import { useNotificationsStore } from '../store/notificationsStore'
import { advisorsService } from '../services/advisors'
import { getValidToken, forceRefreshToken } from '../lib/axios'
import type {
  WSConversationNew,
  WSEscalationNew,
  WSEscalationAssigned,
  WSMessageNew,
  WSConversationReturned,
  WSConversationControlTaken,
  WSConversationReopened,
  WSConversationClosed,
  WSConversationTransferred,
  WSConversationPriorityUpdated,
  WSMessageMediaUpdated,
  WSQueuePending,
  WSAdvisorStatusChanged,
  WSAdvisorConnected,
  WSAdvisorDisconnected,
  WSBehaviorAlertEvent,
  WSSubscribeError,
  WSNotificationEvent,
  Advisor,
} from '../types'

// Global handlers registry to allow pages to hook into specific events without duplicate connections
interface WSHandlers {
  onConversationNew?: (data: WSConversationNew) => void
  onEscalationNew?: (data: WSEscalationNew) => void
  onEscalationAssigned?: (data: WSEscalationAssigned) => void
  onMessageNew?: (data: WSMessageNew) => void
  onMessageMediaUpdated?: (data: WSMessageMediaUpdated) => void
  onConversationReturned?: (data: WSConversationReturned) => void
  onConversationControlTaken?: (data: WSConversationControlTaken) => void
  onConversationReopened?: (data: WSConversationReopened) => void
  onConversationClosed?: (data: WSConversationClosed) => void
  onConversationTransferred?: (data: WSConversationTransferred) => void
  onConversationPriorityUpdated?: (data: WSConversationPriorityUpdated) => void
  onQueuePending?: (data: WSQueuePending) => void
  onAdvisorStatusChanged?: (data: WSAdvisorStatusChanged) => void
  onBehaviorAlert?: (data: WSBehaviorAlertEvent) => void
  onNotificationNew?: (data: WSNotificationEvent) => void
  onNotificationUpdated?: (data: WSNotificationEvent) => void
}

const _handlers: WSHandlers = {}

// Module-level singletons — exactly one socket active at any time
let socket: WebSocket | null = null
let isConnecting = false
// Set while a dial is awaiting a token but has not reached `new WebSocket()`
// yet. Without it, two dial paths firing during that async gap (mount effect +
// 'online', say) both pass the `socket || isConnecting` guard and open two
// sockets, breaking the single-socket invariant this module depends on.
let isResolvingToken = false
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
let pingInterval: ReturnType<typeof setInterval> | null = null
// True once the current session's socket has completed at least one handshake.
// Used to tell apart "still opening the first connection" (quiet) from
// "a live connection just dropped" (alarming) — both used to share the same
// 'reconnecting' status, which flashed on every login.
let hasConnectedOnce = false
// Timestamp of the last pong received — the watchdog in startPing() closes the
// socket if the server stops answering, since a dead TCP connection can sit in
// readyState OPEN for a long time (until the OS notices) without this check.
let lastPongAt = 0
// Timestamp of the oldest UNANSWERED ping. 0 while all pings are answered.
// The watchdog measures silence from here, not from lastPongAt: background
// tabs throttle the ping interval to ~1/min, so "time since last pong" grows
// past the timeout on perfectly healthy sockets that simply weren't pinged.
let lastPingSentAt = 0
const PONG_TIMEOUT_MS = 45000
// How long a probe sent on returning to the tab gets to be answered before the
// socket is given up on. Short, because the answer is a round trip on an already
// open connection — but its own window, never the pre-freeze ping's: see the
// visibilitychange handler.
const VISIBILITY_PROBE_TIMEOUT_MS = 5000
// Tracks which conversation the active advisor has open — used to gate message sounds
// and suppress unread badge increments for the chat currently visible.
let currentSubscribedConversationId: string | null = null
// Retry for a subscribe_conversation the server could not authorize because its
// access check failed (error code UNAVAILABLE — e.g. a DB hiccup on a freshly
// deployed instance). Without it the open chat stayed unsubscribed: bot-handled
// turns are routed only to subscribed connections, so it went silently deaf
// while the socket itself looked perfectly healthy.
const SUBSCRIBE_RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000]
let subscribeRetryTimeout: ReturnType<typeof setTimeout> | null = null
let subscribeRetryAttempt = 0
// Conversation IDs assigned to the current advisor — populated from BandejaPage on load
// and kept in sync via WS events. Allows sound to fire even when the chat is not open.
const myAssignedConversationIds = new Set<string>()

// Called by BandejaPage after loading conversations so the set stays in sync with the server.
// Replaces the entire set to avoid stale entries from filter/reload cycles.
export function setMyAssignedConversations(ids: string[]): void {
  myAssignedConversationIds.clear()
  ids.forEach((id) => myAssignedConversationIds.add(id))
}

// The transfer reason travels only on the `conversation.transferred` WS event —
// GET /conversations/{id} may not echo it back. The receiving advisor is almost
// never on the chat page yet when that event fires (they're in the inbox), so a
// per-page ref would miss it. Cache it here at module scope, keyed by conversation,
// so it survives until whoever opens that chat consumes it in ChatPage's loadConversation.
const pendingTransferReasons = new Map<string, string>()

export function consumePendingTransferReason(conversationId: string): string | null {
  const reason = pendingTransferReasons.get(conversationId)
  if (reason === undefined) return null
  pendingTransferReasons.delete(conversationId)
  return reason
}

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 30000]

function getBackoffDelay(attempt: number): number {
  return BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)]
}

function clearPing() {
  if (pingInterval !== null) {
    clearInterval(pingInterval)
    pingInterval = null
  }
}

function clearReconnect() {
  if (reconnectTimeout !== null) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
}

function clearSubscribeRetry() {
  if (subscribeRetryTimeout !== null) {
    clearTimeout(subscribeRetryTimeout)
    subscribeRetryTimeout = null
  }
}

function handleSubscribeError(error: WSSubscribeError): void {
  const conversationId = error.conversation_id
  // Only the conversation still open matters — a late reply for a chat the
  // advisor already left must not resubscribe to it.
  if (!conversationId || conversationId !== currentSubscribedConversationId) return

  if (error.code !== 'UNAVAILABLE') {
    console.warn('[WS] subscribe_conversation denied', { code: error.code, conversationId })
    return
  }
  if (subscribeRetryTimeout !== null) return

  const delay = SUBSCRIBE_RETRY_DELAYS[Math.min(subscribeRetryAttempt, SUBSCRIBE_RETRY_DELAYS.length - 1)]
  subscribeRetryAttempt += 1
  subscribeRetryTimeout = setTimeout(() => {
    subscribeRetryTimeout = null
    if (currentSubscribedConversationId !== conversationId) return
    sendMessage({ type: 'subscribe_conversation', conversation_id: conversationId })
  }, delay)
}

// Gives up on the current socket WITHOUT waiting for the browser to confirm the
// close. On a half-open connection (peer gone without a FIN/RST — a network
// drop, a server killed mid-deploy) close() only starts a closing handshake
// nobody answers, so onclose can take a minute or more to fire. Until then the
// UI kept saying 'connected' and no reconnect was scheduled. Dropping the
// reference first also turns that late onclose into a stale no-op
// (`socket !== ws`), so it cannot tear down the replacement.
function abandonSocket(): void {
  const dead = socket
  if (!dead) return
  clearPing()
  socket = null
  isConnecting = false
  try {
    dead.close()
  } catch {
    // Already closing — nothing else to release.
  }
  scheduleReconnect()
}

function startPing() {
  clearPing()
  lastPongAt = Date.now()
  lastPingSentAt = 0
  pingInterval = setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return

    if (lastPingSentAt > lastPongAt) {
      // A previous ping went unanswered — the network likely dropped without
      // a close frame (wifi/cable pulled, dead router). Give it one more
      // interval, then force-close so onclose can start reconnecting instead
      // of sitting "connected" forever. lastPingSentAt is NOT refreshed here,
      // so the deadline keeps counting from the first unanswered ping.
      if (Date.now() - lastPingSentAt > PONG_TIMEOUT_MS) {
        abandonSocket()
        return
      }
    } else {
      lastPingSentAt = Date.now()
    }

    socket.send(JSON.stringify({ type: 'ping' }))
  }, 30000)
}

function sendMessage(payload: object): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

// The browser fires 'offline' the instant it detects the OS has no network,
// which is much faster than waiting for the ping/pong watchdog to time out.
// Registered once at module load — this file is a singleton, never re-imported.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    if (socket) {
      console.info('[WS] browser reported offline — dropping socket')
      abandonSocket()
    }
  })

  window.addEventListener('online', () => {
    // Skip the remaining backoff delay and retry immediately once the network is back.
    if (socket || isConnecting || isResolvingToken) return
    const { token, sessionExpired } = useAuthStore.getState()
    if (!token || sessionExpired) return
    clearReconnect()
    dial()
  })

  // Returning to a throttled background tab or waking from sleep: verify the
  // connection immediately instead of waiting for the next (throttled) timer.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return

    if (socket?.readyState === WebSocket.OPEN) {
      // Always probe fresh, never judge on the ping that was outstanding when the
      // tab was hidden. A backgrounded (or frozen) tab throttles the ping timer and
      // queues its message events, so that ping can look unanswered simply because
      // its pong has not been delivered to us yet — and dropping the socket on that
      // evidence reconnected a perfectly healthy connection every time the advisor
      // came back to the panel, which is precisely when a client message had just
      // arrived (real case 2026-09-18: every close landed within seconds of an
      // inbound message, one of them a client-initiated 1005).
      probeOnReturn(socket)
      return
    }

    if (socket || isConnecting || isResolvingToken) return
    const { token, sessionExpired } = useAuthStore.getState()
    if (!token || sessionExpired) return
    clearReconnect()
    dial()
  })
}

// Ping this socket and give the answer its own short window: if nothing comes
// back, the connection really is dead and the normal reconnect chain takes over.
// No timer to clear — a late pong simply makes the check below a no-op, and a
// socket that was replaced meanwhile fails the identity check.
function probeOnReturn(ws: WebSocket): void {
  lastPingSentAt = Date.now()
  try {
    ws.send(JSON.stringify({ type: 'ping' }))
  } catch {
    abandonSocket()
    return
  }
  setTimeout(() => {
    if (socket !== ws || ws.readyState !== WebSocket.OPEN) return
    if (lastPongAt >= lastPingSentAt) return
    console.info('[WS] no pong after returning to the tab — dropping socket')
    abandonSocket()
  }, VISIBILITY_PROBE_TIMEOUT_MS)
}

// Single teardown path for the module-singleton socket — used both when a
// session ends (no reconnect wanted) and when swapping to a new token.
function closeSocket(): void {
  clearPing()
  clearReconnect()
  clearSubscribeRetry()
  if (socket) socket.close()
  socket = null
  isConnecting = false
  isResolvingToken = false
  // A new session gets a fresh auth-recovery budget (see handleAuthRejection).
  lastAuthRecoveryAt = 0

  // Clear module-level state to prevent multi-user data leaks on logout
  myAssignedConversationIds.clear()
  pendingTransferReasons.clear()
  currentSubscribedConversationId = null
}

// Single scheduling path for automatic reconnection. Keeps the retry chain
// alive even when the token refresh fails transiently (network down, backend
// restarting): a failed attempt schedules the next one instead of dying silently.
function scheduleReconnect(): void {
  if (reconnectTimeout !== null || socket || isConnecting || isResolvingToken) return

  // Session intentionally ended (logout, expired, or blocked pending
  // confirmation) — do not reconnect. Without this guard, a socket closed
  // because the session ended would reopen itself moments later.
  const { refresh_token, sessionExpired } = useAuthStore.getState()
  if (!refresh_token || sessionExpired) {
    useWSStore.getState().setStatus('disconnected')
    return
  }

  const attempt = useWSStore.getState().reconnectAttempt
  // A drop after a live connection is always alarming. Before the first
  // successful handshake, give it a couple of quiet retries (e.g. a token
  // race right after login) before treating it as a real problem too.
  const shouldAlarm = hasConnectedOnce || attempt >= 2
  useWSStore.getState().setStatus(shouldAlarm ? 'reconnecting' : 'connecting')
  useWSStore.getState().setReconnectAttempt(attempt + 1)

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null
    dial()
  }, getBackoffDelay(attempt))
}

// Single dial path: resolve a token that is actually valid, THEN open the
// socket. Every automatic and manual reconnection goes through here.
//
// L-03: the token must come from getValidToken(), never straight from the
// store. The access token is only refreshed lazily (by an HTTP request or by a
// reconnect) and lives an hour, so a panel that has been sitting on WebSocket
// pushes alone can hold an access token that expired long ago. Dialing with it
// earns a 4001 close and used to bounce the user to the login screen with a
// perfectly healthy session.
function dial(): void {
  if (socket || isConnecting || isResolvingToken) return

  // Mirrors connect()'s own status handling so the transition is visible during
  // the async token step rather than only once the socket is constructed.
  if (!hasConnectedOnce) {
    useWSStore.getState().setStatus('connecting')
  }

  isResolvingToken = true
  getValidToken()
    .then((token) => {
      isResolvingToken = false
      // Fall back to the in-memory access token: getValidToken() returns null
      // when there is no refresh token to refresh WITH, and in that case the
      // access token already in memory is the only credential available.
      const dialToken = token ?? useAuthStore.getState().token
      if (dialToken) connect(dialToken)
      else scheduleReconnect()
    })
    .catch(() => {
      isResolvingToken = false
      scheduleReconnect()
    })
}

// The server rejected our token at handshake time (close code 4001). That says
// nothing about the HTTP session: the refresh token can be perfectly valid and
// usually is, because the access token is refreshed lazily and can be stale, or
// because the browser clock runs ahead of the backend's and getValidToken()
// therefore believes a rejected token is still fresh.
//
// So: force one real refresh and redial before declaring the session dead.
// Bounded by a cooldown rather than a boolean, so a genuinely dead token cannot
// spin: the server ACCEPTS the socket and only then closes it with 4001, so
// onopen has already fired and cannot be used to reset a one-shot flag.
const AUTH_RECOVERY_COOLDOWN_MS = 60 * 1000
let lastAuthRecoveryAt = 0

function expireSession(): void {
  useWSStore.getState().setStatus('disconnected')
  useAuthStore.getState().endSession()
}

function handleAuthRejection(): void {
  // Another dial is already under way (or a socket survived this close): let it
  // play out. Checked BEFORE the cooldown is stamped — spending the window's one
  // retry on an attempt we are not going to make would send the next 4001
  // straight to the login screen, and returning here without scheduling
  // anything would leave the socket dead until an 'online' or visibility event
  // happened to wake it.
  if (socket || isConnecting || isResolvingToken) return

  const now = Date.now()
  if (now - lastAuthRecoveryAt < AUTH_RECOVERY_COOLDOWN_MS) {
    // Already spent this window's retry and the server rejected us again — the
    // session really is gone.
    expireSession()
    return
  }
  lastAuthRecoveryAt = now

  // Captured before the request goes out — mirrors refreshSession()'s own
  // guard in lib/axios.ts. If the session ends (logout, expiry, a deactivated
  // account — all bump sessionEpoch) while this recovery refresh is in
  // flight, its outcome belongs to a session that no longer exists: treating
  // "no refresh_token" as a dead session then re-fires endSession() on top of
  // an already-handled, deliberate logout ("Tu sesión ha expirado" right
  // after the user signed out on purpose).
  const epoch = useAuthStore.getState().sessionEpoch
  const isCurrent = () => useAuthStore.getState().sessionEpoch === epoch

  isResolvingToken = true
  forceRefreshToken()
    .then((token) => {
      isResolvingToken = false
      if (!isCurrent()) return
      if (token) {
        connect(token)
        return
      }
      // No token came back. That is only a dead session if the refresh actually
      // invalidated it — a transient backend fault (500/503) leaves the refresh
      // token in place, and deserves the normal backoff chain rather than a
      // login screen.
      if (useAuthStore.getState().refresh_token) scheduleReconnect()
      else expireSession()
    })
    .catch(() => {
      isResolvingToken = false
      if (!isCurrent()) return
      if (useAuthStore.getState().refresh_token) scheduleReconnect()
      else expireSession()
    })
}

function connect(token: string): void {
  if (socket || isConnecting) return

  isConnecting = true

  // Only the "recovering from a live drop" case deserves the alarming
  // 'reconnecting' banner. A first-time handshake (fresh login, or the retry
  // loop before it has ever succeeded) shows the quiet 'connecting' status instead.
  if (!hasConnectedOnce) {
    useWSStore.getState().setStatus('connecting')
  }

  const wsBaseEnv: string | undefined = import.meta.env.VITE_WS_BASE_URL
  const apiUrl: string = import.meta.env.VITE_API_URL || 'https://casasyespaciosagent.up.railway.app'
  let wsOrigin: string
  if (wsBaseEnv) {
    try {
      wsOrigin = new URL(wsBaseEnv).origin
    } catch {
      wsOrigin = apiUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
    }
  } else {
    wsOrigin = apiUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
  }
  const url = `${wsOrigin}/api/v1/panel/ws?token=${encodeURIComponent(token)}`

  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch {
    // The constructor can throw synchronously (e.g. malformed URL). Without
    // this reset, isConnecting would stay true forever and block every
    // future automatic reconnection.
    isConnecting = false
    scheduleReconnect()
    return
  }
  socket = ws

  ws.onopen = () => {
    // Stale callback from a socket that was already replaced — ignore.
    if (socket !== ws) return
    isConnecting = false
    const wasReconnecting = useWSStore.getState().reconnectAttempt > 0
    hasConnectedOnce = true
    useWSStore.getState().setStatus('connected')
    useWSStore.getState().setReconnectAttempt(0)
    startPing()

    if (wasReconnecting) {
      // Sync advisor state after backend restart or network drop
      advisorsService.getMe()
        .then(({ advisor }) => useAuthStore.getState().setAdvisor(advisor))
        .catch(() => {})
      advisorsService.getOnline()
        .then((advisors) => useWSStore.getState().setAdvisors(advisors))
        .catch(() => {})
      // Events emitted while disconnected are gone for good — tell mounted
      // pages (bandeja, open chat, alerts panel) to refetch their data so the
      // panel doesn't stay stale after the gap.
      window.dispatchEvent(new CustomEvent('ws:reconnected'))
    }

    // The server tracks subscription state per-connection, not per-advisor —
    // a fresh socket always starts at "bandeja" level. If the advisor still has
    // a chat open when the old socket drops, resubscribe on the new one so
    // bot_activo=true conversations (routed only to subscribed connections)
    // keep updating live instead of going silent until the advisor re-enters the chat.
    if (currentSubscribedConversationId) {
      sendMessage({
        type: 'subscribe_conversation',
        conversation_id: currentSubscribedConversationId,
      })
    }
  }

  ws.onmessage = (event: MessageEvent) => {
    // A replaced socket must not process events — the new socket receives
    // them too, and handling both would duplicate sounds and list updates.
    if (socket !== ws) return
    let parsed: { event?: string; type?: string; data?: unknown }
    try {
      parsed = JSON.parse(event.data as string)
    } catch {
      return
    }

    if (parsed.type === 'pong') {
      lastPongAt = Date.now()
      return
    }

    const { event: eventType, data } = parsed
    if (!eventType) return

    switch (eventType) {
      case 'advisor.connected':
        useWSStore.getState().addConnectedAdvisor(data as WSAdvisorConnected)
        break

      case 'advisor.disconnected':
        useWSStore.getState().removeConnectedAdvisor((data as WSAdvisorDisconnected).advisor_id)
        break

      case 'advisor.status_changed': {
        const statusData = data as WSAdvisorStatusChanged
        useWSStore.getState().updateAdvisorStatus(statusData)

        // If the backend job changed the current user's status, mirror it in authStore
        // so the sidebar/header indicator updates without requiring a page reload.
        const currentAdvisor = useAuthStore.getState().advisor
        if (currentAdvisor && currentAdvisor.id === statusData.advisor_id) {
          useAuthStore.getState().setAdvisor({
            ...currentAdvisor,
            availability_status: statusData.availability_status,
          })
        }

        if (_handlers.onAdvisorStatusChanged) {
          _handlers.onAdvisorStatusChanged(statusData)
        }
        break
      }

      case 'message.new': {
        // Defensive: backend may send conversation_id at data root instead of inside message
        const raw = data as WSMessageNew & { conversation_id?: string; unread_count?: number }
        const conversationId =
          raw.message?.conversation_id ?? raw.conversation_id ?? ''

        if (!raw.message?.id) {
          console.warn('[WS] message.new received with missing message.id — dropping', raw)
          break
        }
        if (!conversationId) {
          console.warn('[WS] message.new received with no conversation_id — dropping', raw)
          break
        }

        const normalizedMsg: WSMessageNew = {
          message: {
            ...raw.message,
            conversation_id: conversationId,
            // Fields absent from the inbound WS payload — default to null
            transcription: raw.message.transcription ?? null,
            advisor_name: raw.message.advisor_name ?? null,
          },
          // Meta's 24h window AFTER this message: every inbound message resets
          // the clock, and this is what spares the panel a refetch per message.
          // It travels at the ROOT of the payload, so it has to be copied over
          // explicitly — this object is rebuilt from scratch, not spread from
          // `raw`, and anything not named here is dropped before the handlers
          // ever see it.
          whatsapp_window_expires_at: raw.whatsapp_window_expires_at ?? null,
          // Same root-level rule: an onboarding handoff can reassign the agent
          // mid-turn; ChatPage/BandejaPage merge it (null = unchanged).
          conversation_agent: raw.conversation_agent ?? null,
        }

        // Sound rules:
        // - Admin: never sounds (audit-only role in Phase 1)
        // - Asesor: sounds if the message is inbound AND the conversation belongs to them.
        //   "Belongs" means either the chat is open OR the conversation is in
        //   myAssignedConversationIds (populated from BandejaPage + WS lifecycle events).
        //   This lets assigned advisors hear sounds even when navigated away from the chat.
        const { advisor } = useAuthStore.getState()
        const isAdmin = advisor?.role === 'admin'
        const convId = normalizedMsg.message.conversation_id
        const isChatOpen = convId === currentSubscribedConversationId
        const isMyConversation = isChatOpen || myAssignedConversationIds.has(convId)

        if (!isAdmin && normalizedMsg.message.direction === 'inbound' && isMyConversation) {
          playNotificationSound()
        }

        // Update unread badge on bandeja only when advisor is NOT in that chat
        if (
          normalizedMsg.message.direction === 'inbound' &&
          conversationId !== currentSubscribedConversationId
        ) {
          window.dispatchEvent(
            new CustomEvent('conversation:unread', {
              detail: { conversationId, unreadCount: raw.unread_count },
            })
          )
        }

        if (_handlers.onMessageNew) {
          _handlers.onMessageNew(normalizedMsg)
        } else {
          console.debug('[WS] message.new received but no onMessageNew handler registered', normalizedMsg.message.conversation_id)
        }
        break
      }

      case 'message.media_updated':
        if (_handlers.onMessageMediaUpdated) {
          _handlers.onMessageMediaUpdated(data as WSMessageMediaUpdated)
        }
        break

      case 'conversation.new': {
        // Bot-handled conversation just created — bandeja list-view refresh
        // only. Never a sound: this is not a personal signal, and unlike
        // escalation.new it has no advisor/area eligibility to gate on.
        if (_handlers.onConversationNew) {
          _handlers.onConversationNew(data as WSConversationNew)
        }
        break
      }

      case 'escalation.new': {
        const escData = data as WSEscalationNew
        const advisor = useAuthStore.getState().advisor
        const eligible = isEligibleForEscalation(advisor, escData)

        if (eligible) {
          playNotificationSound()
          // Feed the EscalationToast via wsStore — same eligibility gate as the sound.
          useWSStore.getState().setPendingEscalation({
            clientName: escData.channel,
            reason: escData.reason ?? '',
            conversationId: escData.conversation_id,
            advisorId: escData.advisor_id,
          })
        }

        // Bandeja queue counts are cross-area info, not a personal signal — always refresh.
        if (_handlers.onEscalationNew) {
          _handlers.onEscalationNew(escData)
        }
        break
      }

      case 'escalation.assigned': {
        const assignedData = data as WSEscalationAssigned
        useWSStore.getState().incrementAdvisorConversations(assignedData.advisor_id)
        // Keep the sound-gate set in sync: when this advisor is assigned, add the conversation
        const selfId = useAuthStore.getState().advisor?.id
        if (selfId && assignedData.advisor_id === selfId) {
          myAssignedConversationIds.add(assignedData.conversation_id)
        }
        if (_handlers.onEscalationAssigned) {
          _handlers.onEscalationAssigned(assignedData)
        }
        break
      }

      case 'conversation.returned': {
        const returnedData = data as WSConversationReturned
        useWSStore.getState().decrementAdvisorConversations(returnedData.advisor_id)
        myAssignedConversationIds.delete(returnedData.conversation_id)
        if (_handlers.onConversationReturned) {
          _handlers.onConversationReturned(returnedData)
        }
        break
      }

      case 'conversation.control_taken': {
        const takenData = data as WSConversationControlTaken
        useWSStore.getState().incrementAdvisorConversations(takenData.advisor_id)
        const selfId = useAuthStore.getState().advisor?.id
        if (selfId && takenData.advisor_id === selfId) {
          myAssignedConversationIds.add(takenData.conversation_id)
        }
        if (_handlers.onConversationControlTaken) {
          _handlers.onConversationControlTaken(takenData)
        }
        break
      }

      // Same shape and bookkeeping as control_taken — reopening also flips
      // bot_activo=false/status=escalada and assigns the reopening advisor.
      case 'conversation.reopened': {
        const reopenedData = data as WSConversationReopened
        useWSStore.getState().incrementAdvisorConversations(reopenedData.advisor_id)
        const selfId = useAuthStore.getState().advisor?.id
        if (selfId && reopenedData.advisor_id === selfId) {
          myAssignedConversationIds.add(reopenedData.conversation_id)
        }
        if (_handlers.onConversationReopened) {
          _handlers.onConversationReopened(reopenedData)
        }
        break
      }

      case 'conversation.closed': {
        const closedData = data as WSConversationClosed
        if (closedData.advisor_id) {
          useWSStore.getState().decrementAdvisorConversations(closedData.advisor_id)
        }
        myAssignedConversationIds.delete(closedData.conversation_id)
        if (_handlers.onConversationClosed) {
          _handlers.onConversationClosed(closedData)
        }
        break
      }

      case 'conversation.transferred': {
        const transferredData = data as WSConversationTransferred
        const { advisor } = useAuthStore.getState()

        if (transferredData.reason) {
          pendingTransferReasons.set(transferredData.conversation_id, transferredData.reason)
        }

        // Keep the sound-gate set in sync regardless of which page is mounted,
        // same reasoning as escalation.assigned / conversation.returned above.
        if (advisor?.id === transferredData.from_advisor?.id) {
          myAssignedConversationIds.delete(transferredData.conversation_id)
        }
        if (advisor?.id === transferredData.to_advisor.id) {
          myAssignedConversationIds.add(transferredData.conversation_id)
          // Sound + toast rule: only the receiving advisor is notified — never the
          // transferring advisor, never admins (audit-only role in Phase 1).
          if (advisor.role !== 'admin') {
            playNotificationSound()
            const fromName = transferredData.from_advisor?.full_name
            useToastStore.getState().showToast(
              fromName
                ? `${fromName} te transfirió una conversación.`
                : 'Te transfirieron una conversación.',
              'info',
            )
          }
        }

        if (_handlers.onConversationTransferred) {
          _handlers.onConversationTransferred(transferredData)
        }
        break
      }

      case 'conversation.priority_updated':
        if (_handlers.onConversationPriorityUpdated) {
          _handlers.onConversationPriorityUpdated(data as WSConversationPriorityUpdated)
        }
        break

      case 'queue.pending':
        if (_handlers.onQueuePending) {
          _handlers.onQueuePending(data as WSQueuePending)
        }
        break

      case 'behavior.alert':
        if (_handlers.onBehaviorAlert) {
          _handlers.onBehaviorAlert(data as WSBehaviorAlertEvent)
        }
        break

      case 'notification.new':
      case 'notification.updated':
        handleNotificationEvent(eventType, data)
        break

      case 'error':
        handleSubscribeError(data as WSSubscribeError)
        break

      default:
        break
    }
  }

  ws.onclose = (event: CloseEvent) => {
    // Stale callback from a socket that was already replaced (token swap,
    // manual reconnect). The CURRENT socket owns the module state — letting
    // this run would kill the new socket's ping loop, drop its reference and
    // schedule a duplicate connection alongside it.
    if (socket !== ws) return

    console.info('[WS] closed', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    })
    clearPing()
    isConnecting = false
    socket = null

    if (event.code === 4001) {
      handleAuthRejection()
      return
    }

    // scheduleReconnect() handles the intentionally-ended-session case
    // (logout / expired / blocked): it sets 'disconnected' and stops there.
    scheduleReconnect()
  }

  ws.onerror = () => {
    // onclose fires automatically after onerror — nothing else needed
  }
}

// Agent notifications (notification.new / notification.updated). The global part
// — badge, toast, sound — runs here so it works whatever page is mounted; the
// inbox page only receives the forwarded event to update its list.
// Sound and toast are for BOTH roles: unlike chat messages, a notification is
// actionable work for admins too. Only `new` alerts; `updated` (another file
// appended, or someone closed it) silently refreshes the badge.
const NOTIFICATION_SOUND_THROTTLE_MS = 3000
let lastNotificationSoundAt = 0

function isNotificationEvent(data: unknown): data is WSNotificationEvent {
  if (!data || typeof data !== 'object') return false
  const { notification, pending_count } = data as Partial<WSNotificationEvent>
  // The row reads client/conversation/attachments directly — a partial payload
  // (version skew) must be dropped here, not crash the inbox render.
  return (
    typeof pending_count === 'number' &&
    !!notification &&
    typeof notification.id === 'string' &&
    typeof notification.status === 'string' &&
    !!notification.client && typeof notification.client === 'object' &&
    !!notification.conversation && typeof notification.conversation === 'object' &&
    Array.isArray(notification.attachments)
  )
}

function handleNotificationEvent(eventType: 'notification.new' | 'notification.updated', data: unknown): void {
  if (!isNotificationEvent(data)) return
  const store = useNotificationsStore.getState()
  store.setPendingCount(data.pending_count)

  if (eventType === 'notification.new') {
    store.setIncoming(data.notification)
    const now = Date.now()
    if (now - lastNotificationSoundAt >= NOTIFICATION_SOUND_THROTTLE_MS) {
      lastNotificationSoundAt = now
      playNotificationSound()
    }
    _handlers.onNotificationNew?.(data)
  } else {
    _handlers.onNotificationUpdated?.(data)
  }
}

// Scope rule for escalation.new (sound + toast): admin never; if already
// assigned, only the assigned advisor; if queued, any advisor with capacity
// who is available. No area/channel gate — every advisor now sees every
// conversation regardless of area/specialty (backend authorizes all advisors
// on all conversations; only actual assignment is still decided server-side).
function isEligibleForEscalation(advisor: Advisor | null, escData: WSEscalationNew): boolean {
  if (!advisor || advisor.role === 'admin') return false

  if (escData.advisor_id !== null) {
    return advisor.id === escData.advisor_id
  }

  return (
    advisor.active_conversations < advisor.max_conversations &&
    advisor.availability_status === 'available'
  )
}

// I-01: Singleton AudioContext — browsers cap concurrent contexts (~6 in Chrome).
// Creating a new one per notification can silently drop sounds under heavy load.
let _audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new AudioContextClass()
    }
    return _audioCtx
  } catch {
    return null
  }
}

// Chrome/Firefox/Safari keep AudioContext 'suspended' until a real user
// gesture on the page. Without this, the first notification(s) after a
// reload silently fail to play — resume() is called on demand inside
// playNotificationSound() but its promise only resolves once a gesture
// happens, so any sound scheduled before that gesture is lost, not queued.
// Call this once on a page-wide gesture listener to unlock ahead of time.
export function unlockAudioContext(): void {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
}

/**
 * Plays a pleasant double chime notification sound using the Web Audio API.
 * This guarantees a native browser notification chime without requiring external assets.
 */
export function playNotificationSound() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const scheduleChimes = () => {
      const playChime = (time: number, freq: number, duration: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, time)

        gain.gain.setValueAtTime(0.15, time)
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)

        osc.connect(gain)
        gain.connect(ctx.destination)

        osc.start(time)
        osc.stop(time + duration)
      }

      const now = ctx.currentTime
      playChime(now, 587.33, 0.4)        // D5
      playChime(now + 0.12, 880, 0.5)   // A5
    }

    // AudioContext starts suspended in Chrome until a user gesture unlocks it
    if (ctx.state === 'suspended') {
      ctx.resume().then(scheduleChimes).catch(() => {})
    } else {
      scheduleChimes()
    }
  } catch (e) {
    console.error('Failed to play notification sound:', {
      message: e instanceof Error ? e.message : 'unknown',
      type: e instanceof Error ? e.name : typeof e,
    })
  }
}

export function useWebSocket(handlers?: WSHandlers) {
  const accessToken = useAuthStore((s) => s.token)
  const sessionExpired = useAuthStore((s) => s.sessionExpired)
  const setStatus = useWSStore((s) => s.setStatus)

  // M-03: track each handler function individually instead of the whole object.
  // Passing `handlers` (an object literal) as a single dep re-runs this effect on
  // every render because a new object reference is created each time. Destructuring
  // individual function refs means the effect only fires when a specific handler changes.
  const {
    onConversationNew,
    onEscalationNew,
    onEscalationAssigned,
    onMessageNew,
    onMessageMediaUpdated,
    onConversationReturned,
    onConversationControlTaken,
    onConversationReopened,
    onConversationClosed,
    onConversationTransferred,
    onConversationPriorityUpdated,
    onQueuePending,
    onAdvisorStatusChanged,
    onBehaviorAlert,
    onNotificationNew,
    onNotificationUpdated,
  } = handlers ?? {}

  useEffect(() => {
    if (onConversationNew)   _handlers.onConversationNew    = onConversationNew
    if (onEscalationNew)      _handlers.onEscalationNew      = onEscalationNew
    if (onEscalationAssigned) _handlers.onEscalationAssigned = onEscalationAssigned
    if (onMessageNew)         _handlers.onMessageNew         = onMessageNew
    if (onMessageMediaUpdated) _handlers.onMessageMediaUpdated = onMessageMediaUpdated
    if (onConversationReturned) _handlers.onConversationReturned = onConversationReturned
    if (onConversationControlTaken) _handlers.onConversationControlTaken = onConversationControlTaken
    if (onConversationReopened) _handlers.onConversationReopened = onConversationReopened
    if (onConversationClosed) _handlers.onConversationClosed = onConversationClosed
    if (onConversationTransferred) _handlers.onConversationTransferred = onConversationTransferred
    if (onConversationPriorityUpdated) _handlers.onConversationPriorityUpdated = onConversationPriorityUpdated
    if (onQueuePending)       _handlers.onQueuePending       = onQueuePending
    if (onAdvisorStatusChanged) _handlers.onAdvisorStatusChanged = onAdvisorStatusChanged
    if (onBehaviorAlert)      _handlers.onBehaviorAlert      = onBehaviorAlert
    if (onNotificationNew)    _handlers.onNotificationNew    = onNotificationNew
    if (onNotificationUpdated) _handlers.onNotificationUpdated = onNotificationUpdated

    return () => {
      if (onConversationNew   && _handlers.onConversationNew    === onConversationNew)    delete _handlers.onConversationNew
      if (onEscalationNew      && _handlers.onEscalationNew      === onEscalationNew)      delete _handlers.onEscalationNew
      if (onEscalationAssigned && _handlers.onEscalationAssigned === onEscalationAssigned) delete _handlers.onEscalationAssigned
      if (onMessageNew         && _handlers.onMessageNew         === onMessageNew)         delete _handlers.onMessageNew
      if (onMessageMediaUpdated && _handlers.onMessageMediaUpdated === onMessageMediaUpdated) delete _handlers.onMessageMediaUpdated
      if (onConversationReturned && _handlers.onConversationReturned === onConversationReturned) delete _handlers.onConversationReturned
      if (onConversationControlTaken && _handlers.onConversationControlTaken === onConversationControlTaken) delete _handlers.onConversationControlTaken
      if (onConversationReopened && _handlers.onConversationReopened === onConversationReopened) delete _handlers.onConversationReopened
      if (onConversationClosed && _handlers.onConversationClosed === onConversationClosed) delete _handlers.onConversationClosed
      if (onConversationTransferred && _handlers.onConversationTransferred === onConversationTransferred) delete _handlers.onConversationTransferred
      if (onConversationPriorityUpdated && _handlers.onConversationPriorityUpdated === onConversationPriorityUpdated) delete _handlers.onConversationPriorityUpdated
      if (onQueuePending       && _handlers.onQueuePending       === onQueuePending)       delete _handlers.onQueuePending
      if (onAdvisorStatusChanged && _handlers.onAdvisorStatusChanged === onAdvisorStatusChanged) delete _handlers.onAdvisorStatusChanged
      if (onBehaviorAlert      && _handlers.onBehaviorAlert      === onBehaviorAlert)      delete _handlers.onBehaviorAlert
      if (onNotificationNew    && _handlers.onNotificationNew    === onNotificationNew)    delete _handlers.onNotificationNew
      if (onNotificationUpdated && _handlers.onNotificationUpdated === onNotificationUpdated) delete _handlers.onNotificationUpdated
    }
  }, [
    onConversationNew, onEscalationNew, onEscalationAssigned, onMessageNew, onMessageMediaUpdated, onConversationReturned,
    onConversationControlTaken, onConversationReopened, onConversationClosed, onConversationTransferred,
    onConversationPriorityUpdated, onQueuePending, onAdvisorStatusChanged, onBehaviorAlert,
    onNotificationNew, onNotificationUpdated,
  ])

  // Open the connection when a session exists; close it whenever there is no
  // valid session (no token, or blocked pending confirmation).
  //
  // IMPORTANT: a live socket is NEVER torn down because the access token
  // changed. The token is only validated at handshake time — the server never
  // re-checks it on an open connection — so recycling the socket on every
  // refresh produced visible reconnect churn in the panel (each token refresh
  // closed and reopened both advisors' sockets during the 2026-07-17 demo).
  // Reconnect paths (watchdog, onclose, online/visibility) already fetch a
  // fresh token via getValidToken() before dialing.
  useEffect(() => {
    if (!accessToken || sessionExpired) {
      setStatus('disconnected')
      closeSocket()
      hasConnectedOnce = false
      return
    }

    // A socket is already open, connecting, or scheduled to reconnect — leave
    // it alone; it keeps working regardless of which token it connected with.
    if (socket || isConnecting || isResolvingToken || reconnectTimeout !== null) return

    dial()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, sessionExpired])

  const reconnect = useCallback(() => {
    if (useAuthStore.getState().sessionExpired) return
    if (!useAuthStore.getState().token) return
    closeSocket()
    dial()
  }, [])

  const subscribeConversation = useCallback((conversationId: string) => {
    if (currentSubscribedConversationId !== conversationId) subscribeRetryAttempt = 0
    clearSubscribeRetry()
    currentSubscribedConversationId = conversationId
    sendMessage({ type: 'subscribe_conversation', conversation_id: conversationId })
  }, [])

  const unsubscribeConversation = useCallback(() => {
    clearSubscribeRetry()
    subscribeRetryAttempt = 0
    currentSubscribedConversationId = null
    sendMessage({ type: 'unsubscribe_conversation' })
  }, [])

  return { reconnect, subscribeConversation, unsubscribeConversation }
}
