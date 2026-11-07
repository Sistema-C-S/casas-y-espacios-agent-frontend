import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { conversationsService } from "../services/conversations";
import { useToastStore } from "../store/toastStore";
import { useAuthStore } from "../store/authStore";
import { useWSStore } from "../store/wsStore";
import type {
  Conversation,

  Message,
  WSMessageNew,
  WSConversationClosed,
  WSEscalationNew,
  WSEscalationAssigned,
  WSConversationTransferred,
  WSConversationControlTaken,
  WSConversationReopened,
  WSMessageMediaUpdated,
} from "../types";
import MessageFeed from "../components/chat/MessageFeed";
import ChatInput from "../components/chat/ChatInput";
import ClientPanel, { type ChatVariant } from "../components/chat/ClientPanel";
import TransferModal from "../components/chat/TransferModal";
import CloseConversationModal, { type CloseData } from "../components/modals/CloseConversationModal";
import ReturnBotModal from "../components/modals/ReturnBotModal";
import { useWebSocket, consumePendingTransferReason } from "../hooks/useWebSocket";
import { useAbortableLoad } from "../hooks/useAbortableLoad";
import { useWhatsAppWindow } from "../hooks/useWhatsAppWindow";
import { formatWindowCountdown, windowCountdownHint } from "../lib/whatsappWindow";
import { agentLabel } from "../lib/agentLabels";
import { ROUTES } from "../constants/routes";
import { useFocusMessage } from "../hooks/useFocusMessage";
import { buildChatUrl, buildNotificationsUrl } from "../lib/notificationRoutes";
import { extractActiveConversation, notifyActiveConversation } from "../lib/reopenConflict";
import type { ChatLocationState } from "../types/navigation";

function getInitials(name: string): string {
  try {
    const clean = name.trim();
    if (!clean) return "C";
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } catch {
    return "C";
  }
}

// ── Header status dot color ───────────────────────────────

const STATUS_DOT: Record<ChatVariant, string> = {
  assigned: "bg-warning",
  unassigned: "bg-error",
  bot: "bg-success",
  monitoring: "bg-warning",
};

// Generic farewell sent when the advisor closes a conversation without
// having said goodbye themselves — must stay neutral since it's used across
// every resolution type, not just successfully resolved cases.
const FAREWELL_MESSAGE =
  "¡Gracias por contactarnos! Damos por finalizada esta conversación. Si necesitas algo más, no dudes en escribirnos de nuevo. ¡Que tengas un excelente día! 👋";

// ── Page ──────────────────────────────────────────────────

export default function ChatPage() {
  const { id: conversationId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const advisor = useAuthStore((s) => s.advisor);
  const role = useAuthStore((s) => s.role);
  // Cancels this page's reads on unmount and gates every write that follows one.
  const { getSignal, isMounted } = useAbortableLoad();

  const locationState = (location.state ?? {}) as ChatLocationState;
  const fromAlert: boolean = locationState.fromAlert ?? false;
  const alertAdvisorName: string | undefined = locationState.advisorName;
  const fromNotification = locationState.fromNotification ?? null;
  const focusWamId = locationState.focusWamId ?? null;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [isTakingControl, setIsTakingControl] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showReturnedPill, setShowReturnedPill] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const feedRef = useRef<HTMLDivElement>(null);
  // Tracks how many messages (counted back from the most recent one) have been
  // loaded so far. offset=0 on the API means "the latest window", so this ref
  // doubles as the offset to request on the next "load older" page.
  const apiOffsetRef = useRef(0);
  const totalRef = useRef(0);
  // True after the first successful loadConversation — distinguishes the initial
  // load (where apiOffsetRef has no prior value worth preserving) from a WS-triggered
  // refresh (where the user may have already scrolled further back than the fresh fetch).
  const initializedRef = useRef(false);

  const loadConversation = useCallback(async () => {
    if (!conversationId) return;
    setIsLoading(true);
    try {
      const limit = fromAlert ? 100 : 50;
      const {
        conversation: conv,
        messages: msgs,
        total_messages: total,
      } = await conversationsService.getById(conversationId, limit, getSignal());
      if (!isMounted()) return;
      // offset=0 returns the most recent `limit` messages (server orders DESC
      // internally, then reverses to ASC for display) — no extra fetch needed.

      setConversation(conv);
      // Backend may not echo transfer_reason back on a plain GET — fall back to
      // whatever the conversation.transferred WS event cached for this conversation.
      if (conv.escalation && !conv.escalation.transfer_reason) {
        const cachedReason = consumePendingTransferReason(conv.id)
        if (cachedReason) {
          setConversation((prev) =>
            prev && prev.escalation && !prev.escalation.transfer_reason
              ? { ...prev, escalation: { ...prev.escalation, transfer_reason: cachedReason } }
              : prev
          )
        }
      }
      setShowReturnedPill(conv.bot_activo && conv.has_escalation_history);
      // Merge instead of replace. `msgs` is only the fresh window this call fetched
      // (the latest messages) — it does NOT include older history the user already
      // loaded via infinite scroll, nor messages added locally/via WS that the
      // fetch raced against. Preserve anything from `prev` that falls outside the
      // fresh window (older than its first message, or newer than its last) so a
      // WS-triggered refresh (escalation assigned/returned/new) never drops
      // already-visible messages.
      setMessages((prev) => {
        if (prev.length === 0) return msgs
        const serverIds = new Set(msgs.map((m) => m.id))
        const oldestNewTs = msgs.length
          ? new Date(msgs[0].created_at).getTime()
          : Infinity
        const newestNewTs = msgs.length
          ? new Date(msgs[msgs.length - 1].created_at).getTime()
          : -Infinity
        const preserved = prev.filter((m) => {
          if (serverIds.has(m.id)) return false
          const ts = new Date(m.created_at).getTime()
          return ts < oldestNewTs || ts > newestNewTs
        })
        if (preserved.length === 0) return msgs
        return [...preserved, ...msgs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      })
      totalRef.current = total;
      // On a refresh (not the initial load), keep the deepest point already
      // reached instead of resetting it back to just this fresh window's size.
      apiOffsetRef.current = initializedRef.current
        ? Math.max(msgs.length, apiOffsetRef.current)
        : msgs.length;
      initializedRef.current = true;
    } catch (err: unknown) {
      if (!isMounted()) return;
      // CONVERSATION_NOT_FOUND is in LOCAL_ERROR_CODES (shared with take-control/
      // reopen, where it's handled inline) so the interceptor stays silent here —
      // without this branch a deleted/inaccessible conversation would fail to
      // load with zero feedback instead of the generic toast it used to get.
      const code = extractErrorCode(err);
      if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", 'error');
        navigate(ROUTES.BANDEJA);
      }
      // any other code: interceptor already showed the error toast (a cancelled request shows none)
    } finally {
      if (isMounted()) setIsLoading(false);
    }
  }, [conversationId, fromAlert, getSignal, isMounted, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversation();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadConversation]);

  // Messages emitted while the WS was down are lost — refetch on reconnection
  // so the open chat doesn't miss anything from the gap.
  useEffect(() => {
    const handleReconnected = () => {
      loadConversation();
    };
    window.addEventListener('ws:reconnected', handleReconnected);
    return () => window.removeEventListener('ws:reconnected', handleReconnected);
  }, [loadConversation]);

  // Ticks every minute so the "esperando respuesta" indicator in ChatInput stays live
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Reset unread count when the ASSIGNED ADVISOR opens this conversation.
  // Admin is excluded: admin viewing the chat must not clear the badge
  // that belongs to the assigned advisor.
  useEffect(() => {
    if (!conversationId || role === 'admin') return
    conversationsService.markAsSeen(conversationId)
      .then(() => {
        window.dispatchEvent(
          new CustomEvent('conversation:unread', {
            detail: { conversationId, unreadCount: 0 },
          })
        )
      })
      .catch(() => {})
  }, [conversationId, role])

  // Scroll to bottom after initial load — deferred to after paint so scrollHeight is correct
  useEffect(() => {
    if (isLoading) return;
    const raf = requestAnimationFrame(() => {
      if (feedRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [isLoading]);

  // Resolves to how many older messages were added (0 when there was nothing
  // to load or the request failed), or null when a load was already in flight
  // — useFocusMessage tells "busy" apart from "no older history".
  async function loadMoreMessages(): Promise<number | null> {
    if (isLoadingMore) return null;
    if (apiOffsetRef.current >= totalRef.current) return 0;
    const container = feedRef.current;
    const prevScrollHeight = container ? container.scrollHeight : 0;
    setIsLoadingMore(true);
    try {
      // offset counts back from the most recent message, so requesting the next
      // page at the current offset returns the window immediately preceding
      // (older than) what's already loaded.
      const { messages: older } = await conversationsService.getMessages(
        conversationId!,
        { limit: 100, offset: apiOffsetRef.current },
        getSignal(),
      );
      if (!isMounted()) return 0;
      apiOffsetRef.current += older.length;
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const filteredOlder = older.filter((m) => !existingIds.has(m.id));
        return [...filteredOlder, ...prev];
      });
      setTimeout(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      }, 0);
      return older.length;
    } catch {
      // silently fail
      return 0;
    } finally {
      if (isMounted()) setIsLoadingMore(false);
    }
  }

  // Deep link from a notification attachment: scroll to the receipt message.
  const highlightedWamId = useFocusMessage({
    focusWamId,
    conversationId,
    messages,
    isReady: !isLoading && conversation !== null,
    feedRef,
    loadOlder: loadMoreMessages,
    canLoadOlder: () => apiOffsetRef.current < totalRef.current,
  });

  // WS handlers — called by useWebSocket hook
  const onNewMessage = useCallback(
    (event: WSMessageNew) => {
      if (event.message.conversation_id === conversationId) {
        setMessages((prev) => {
          // Guard against duplicates: the HTTP response already appended outbound messages
          if (prev.some((m) => m.id === event.message.id)) return prev;
          return [...prev, event.message];
        });

        // Every INBOUND message restarts Meta's 24h window, and the event
        // carries the fresh expiry precisely so this page does not fire an HTTP
        // request per message to learn it. Without this merge the chat keeps
        // counting down the expiry it loaded with, reaches zero, and disables
        // its own composer on a conversation the client just reopened for
        // another 24 hours — fail-closed, on the most common event there is.
        //
        // A null is NOT applied: the window only ever moves forward, so null
        // here means the backend could not resolve it (or an older backend that
        // does not send the field), and overwriting a known expiry with
        // "unknown" would throw away a countdown that is still correct.
        if (event.whatsapp_window_expires_at) {
          const freshExpiry = event.whatsapp_window_expires_at;
          setConversation((prev) =>
            prev ? { ...prev, whatsapp_window_expires_at: freshExpiry } : prev,
          );
        }

        // An onboarding handoff can reassign a conversation's agent in place
        // mid-turn — merge it so the header label updates live instead of
        // waiting for a reload. `null`/absent means unchanged, never a reset.
        if (event.conversation_agent) {
          const freshAgent = event.conversation_agent;
          setConversation((prev) =>
            prev ? { ...prev, agent: freshAgent } : prev,
          );
        }

        // If the advisor is in the chat and the message is inbound, mark it as seen immediately
        if (event.message.direction === 'inbound' && role !== 'admin') {
          conversationsService.markAsSeen(conversationId)
            .then(() => {
              window.dispatchEvent(
                new CustomEvent('conversation:unread', {
                  detail: { conversationId, unreadCount: 0 },
                })
              );
            })
            .catch(() => {});
        }
      }
    },
    [conversationId, role],
  );

  // Backfill for video/document/image/audio messages: describe_image/
  // transcribe_audio/handle_unsupported_media's background download finishes
  // AFTER the message was already rendered with the raw Meta media_id (real
  // incident 2026-09-15 — a video only played after a manual reload because
  // nothing patched the already-open chat's stale bubble). Match by wam_id,
  // the one stable identifier shared between the WS event and Message.
  const onMessageMediaUpdated = useCallback(
    (event: WSMessageMediaUpdated) => {
      if (event.conversation_id !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.wam_id === event.wam_id
            ? { ...m, media_url: event.media_url, media_mime_type: event.media_mime_type }
            : m,
        ),
      );
    },
    [conversationId],
  );

  const onConversationReturned = useCallback(
    (event: { conversation_id: string }) => {
      if (event.conversation_id === conversationId) {
        setShowReturnedPill(true);
        loadConversation();
      }
    },
    [conversationId, loadConversation],
  );

  // Another advisor/admin took control while this chat is open. Our own
  // take-control action is already reflected via the HTTP response (see
  // handleTakeControl) — patch directly from the event payload instead of
  // refetching, same reasoning as onEscalationAssigned not needing one.
  const onConversationControlTaken = useCallback(
    (event: WSConversationControlTaken) => {
      if (event.conversation_id !== conversationId) return;
      const selfId = useAuthStore.getState().advisor?.id;
      if (event.advisor_id === selfId) return;
      setShowReturnedPill(false);
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              bot_activo: false,
              escalation: {
                id: event.escalation_id,
                reason: "control_manual_directo",
                summary: null,
                escalated_at: new Date().toISOString(),
                advisor: { id: event.advisor_id, full_name: event.advisor_name },
              },
            }
          : prev,
      );
    },
    [conversationId],
  );

  // Another advisor reopened this closed conversation while it was open here
  // (e.g. from HistorialPage in another tab). Same merge shape as control-taken,
  // plus status flips to "escalada" — reopen is the only action that changes it.
  const onConversationReopened = useCallback(
    (event: WSConversationReopened) => {
      if (event.conversation_id !== conversationId) return;
      const selfId = useAuthStore.getState().advisor?.id;
      if (event.advisor_id === selfId) return;
      setShowReturnedPill(false);
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              bot_activo: false,
              status: "escalada",
              escalation: {
                id: event.escalation_id,
                reason: "control_manual_directo",
                summary: null,
                escalated_at: new Date().toISOString(),
                advisor: { id: event.advisor_id, full_name: event.advisor_name },
              },
            }
          : prev,
      );
    },
    [conversationId],
  );

  const onConversationClosed = useCallback(
    (event: WSConversationClosed) => {
      if (event.conversation_id !== conversationId) return;
      // The window-expiry job closes conversations at any hour, unlike every
      // other bot close (which is gated by office hours) — so this can yank the
      // advisor out of a chat she is reading. Say why instead of just navigating.
      if (event.reason === "window_expired") {
        useToastStore
          .getState()
          .showToast(
            "La ventana de 24 horas de WhatsApp venció y la conversación se cerró automáticamente.",
            "warning",
          );
      }
      navigate(ROUTES.BANDEJA);
    },
    [conversationId, navigate],
  );

  const onEscalationAssigned = useCallback(
    (event: WSEscalationAssigned) => {
      if (event.conversation_id === conversationId) {
        loadConversation();
      }
    },
    [conversationId, loadConversation],
  );

  const onConversationTransferred = useCallback(
    (event: WSConversationTransferred) => {
      if (event.conversation_id === conversationId) {
        const selfId = useAuthStore.getState().advisor?.id;
        const isAdmin = useAuthStore.getState().advisor?.role === "admin";
        if (selfId && event.from_advisor?.id === selfId && !isAdmin) {
          navigate(ROUTES.BANDEJA);
        } else {
          loadConversation();
        }
      }
    },
    [conversationId, navigate, loadConversation],
  );

  const handleTransfer = useCallback(
    async (targetAdvisorId: string, reason: string | null) => {
      if (!conversationId) return;
      const result = await conversationsService.transfer(conversationId, {
        target_advisor_id: targetAdvisorId,
        reason,
      });
      setShowTransferModal(false);
      if (result?.escalation?.transfer_reason) {
        setConversation((prev) =>
          prev && prev.escalation
            ? { ...prev, escalation: { ...prev.escalation, transfer_reason: result.escalation.transfer_reason } }
            : prev
        );
      }
      useToastStore.getState().showToast(
        reason
          ? `Conversación transferida: "${reason.length > 60 ? reason.slice(0, 60) + '...' : reason}"`
          : "Conversación transferida exitosamente.",
        "success"
      );
      navigate(ROUTES.BANDEJA);
    },
    [conversationId, navigate]
  );

  // Covers auto-assign on escalation creation: the backend may emit a single
  // `escalation.new` with `advisor_id` already set, with no follow-up
  // `escalation.assigned` event, so this chat must also refresh on that event.
  const onEscalationNew = useCallback(
    (event: WSEscalationNew) => {
      if (event.conversation_id === conversationId) {
        loadConversation();
      }
    },
    [conversationId, loadConversation],
  );

  // Stable handlers object — prevents useWebSocket's effect from re-running on every render
  const wsHandlers = useMemo(
    () => ({
      onMessageNew: onNewMessage,
      onMessageMediaUpdated: onMessageMediaUpdated,
      onEscalationNew: onEscalationNew,
      onConversationReturned: onConversationReturned,
      onConversationControlTaken: onConversationControlTaken,
      onConversationReopened: onConversationReopened,
      onConversationClosed: onConversationClosed,
      onEscalationAssigned: onEscalationAssigned,
      onConversationTransferred: onConversationTransferred,
    }),
    [
      onNewMessage,
      onMessageMediaUpdated,
      onEscalationNew,
      onConversationReturned,
      onConversationControlTaken,
      onConversationReopened,
      onConversationClosed,
      onEscalationAssigned,
      onConversationTransferred,
    ],
  );

  // Hook up real-time websocket updates
  const { subscribeConversation, unsubscribeConversation } =
    useWebSocket(wsHandlers);

  // Subscribe to the conversation when it's known; unsubscribe on unmount or id change.
  // On unmount, call markAsSeen so messages that arrived while reading are cleared
  // server-side — otherwise BandejaPage refetches a stale unread_count > 0.
  useEffect(() => {
    if (!conversationId) return;
    subscribeConversation(conversationId);
    return () => {
      unsubscribeConversation();
      if (role !== 'admin') {
        conversationsService.markAsSeen(conversationId).catch(() => {})
      }
    };
  }, [conversationId, role, subscribeConversation, unsubscribeConversation]);

  // Re-send the subscription once the socket is actually 'connected'. The effect
  // above can fire while the socket is still mid-handshake (just opened this tab,
  // or a deploy/network drop is mid-reconnect) — sendMessage() drops the
  // subscribe_conversation frame silently in that state (useWebSocket.ts), and
  // nothing else in this component would ever retry it, leaving this chat "deaf"
  // to that client's live messages until a full page reload remounted everything
  // after the socket was already open. wsStatus flips to 'connected' synchronously
  // in the same onopen that already resends the LAST subscribed conversation from
  // module state, so this is a second, React-driven guarantee for the conversation
  // this specific page instance cares about — a harmless duplicate send at worst.
  const wsStatus = useWSStore((s) => s.status);
  useEffect(() => {
    if (!conversationId || wsStatus !== 'connected') return;
    subscribeConversation(conversationId);
  }, [conversationId, wsStatus, subscribeConversation]);

  // Auto-scroll when a new message is appended (not when old messages are prepended)
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMsg.id;
      if (feedRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    }
  }, [messages]);

  // ── Optimistic UI helpers ──────────────────────────────────
  // ChatInput/AudioRecorder append a local placeholder message the instant the
  // advisor hits send (before the HTTP round-trip to Meta/Storage completes),
  // then reconcile it once the server responds. Matched by `_localId` since the
  // placeholder doesn't have a real message id yet.

  const addOptimisticMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m._localId && m._localId === msg._localId);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = msg;
        return next;
      }
      return [...prev, msg];
    });
  }, []);

  const confirmOptimisticMessage = useCallback(
    (localId: string, serverMessage: Message) => {
      setMessages((prev) => {
        // The WS `message.new` event may have already appended the real message
        // (race with the HTTP response) — drop the placeholder instead of duplicating.
        if (prev.some((m) => m.id === serverMessage.id)) {
          return prev.filter((m) => m._localId !== localId);
        }
        return prev.map((m) => (m._localId === localId ? serverMessage : m));
      });
    },
    [],
  );

  // ChatInput owns the payloads of unconfirmed messages, so it hands the page a
  // retry function; the bubble's "Reintentar" button reaches it through here.
  const retryHandlerRef = useRef<((localId: string) => void) | null>(null);
  const registerRetryHandler = useCallback((retry: ((localId: string) => void) | null) => {
    retryHandlerRef.current = retry;
  }, []);
  const retryMessage = useCallback((localId: string) => {
    retryHandlerRef.current?.(localId);
  }, []);

  const failOptimisticMessage = useCallback((localId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m._localId === localId ? { ...m, _status: "failed" as const } : m)),
    );
  }, []);

  function extractErrorCode(err: unknown): string | undefined {
    const e = err as { response?: { data?: { detail?: { code?: string } } } };
    return e.response?.data?.detail?.code;
  }

  function extractErrorMessage(err: unknown): string | undefined {
    const e = err as {
      response?: { data?: { detail?: { message?: string } } };
    };
    return e.response?.data?.detail?.message;
  }


  async function handleTake() {
    if (!conversationId) return;
    setIsAssigning(true);
    try {
      await conversationsService.assign(conversationId);
      await loadConversation();
    } catch (err: unknown) {
      const code = extractErrorCode(err);
      if (code === "ALREADY_ASSIGNED") {
        useToastStore.getState().showToast("Otro asesor ya tomó esta conversación.", 'error');
        await loadConversation();
      } else if (code === "MAX_CONVERSATIONS_REACHED") {
        useToastStore.getState().showToast(
          extractErrorMessage(err) ??
            "Has alcanzado el límite de conversaciones simultáneas.",
          'error',
        );
      } else if (code === "CONVERSATION_NOT_ESCALATED") {
        useToastStore.getState().showToast("La conversación no está en estado escalado.", 'error');
      } else if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", 'error');
      }
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleTakeControl() {
    if (!conversationId) return;
    setIsTakingControl(true);
    try {
      const result = await conversationsService.takeControl(conversationId);
      // A manual take-control is the opposite of a bot return — clear the
      // "returned to bot" pill so it doesn't render alongside the new
      // escalation banner below (stale otherwise until the next full reload).
      setShowReturnedPill(false);
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              bot_activo: result.conversation.bot_activo,
              status: result.conversation.status,
              escalation: {
                id: result.escalation.id,
                reason: "control_manual_directo",
                summary: null,
                // The PATCH response doesn't echo escalated_at — close enough,
                // it only matters for the queued/unassigned wait indicator,
                // which never shows once escalation.advisor is set.
                escalated_at: new Date().toISOString(),
                advisor: { id: result.escalation.advisor_id, full_name: result.escalation.advisor_name },
              },
            }
          : prev,
      );
    } catch (err: unknown) {
      const code = extractErrorCode(err);
      if (code === "CONTROL_ALREADY_TAKEN") {
        useToastStore.getState().showToast(
          extractErrorMessage(err) ?? "Otro asesor ya tiene el control de esta conversación.",
          'error',
        );
        await loadConversation();
      } else if (code === "CONVERSATION_NOT_ACTIVE") {
        useToastStore.getState().showToast("Esta conversación ya está cerrada.", 'error');
        await loadConversation();
      } else if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", 'error');
      }
    } finally {
      setIsTakingControl(false);
    }
  }

  async function handleReopen() {
    if (!conversationId) return;
    setIsReopening(true);
    try {
      const result = await conversationsService.reopen(conversationId);
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              bot_activo: result.conversation.bot_activo,
              status: result.conversation.status,
              escalation: {
                id: result.escalation.id,
                reason: result.escalation.reason,
                summary: null,
                escalated_at: new Date().toISOString(),
                advisor: { id: result.escalation.advisor_id, full_name: result.escalation.advisor_name },
              },
            }
          : prev,
      );
      useToastStore.getState().showToast("Conversación reabierta.", "success");
    } catch (err: unknown) {
      const code = extractErrorCode(err);
      if (code === "CONTROL_ALREADY_TAKEN") {
        useToastStore.getState().showToast(
          extractErrorMessage(err) ?? "Otro asesor ya tiene el control de esta conversación.",
          'error',
        );
        await loadConversation();
      } else if (code === "CONVERSATION_NOT_CLOSED") {
        useToastStore.getState().showToast("Esta conversación ya no está cerrada.", 'error');
        await loadConversation();
      } else if (code === "WINDOW_EXPIRED") {
        useToastStore.getState().showToast(
          extractErrorMessage(err) ?? "La ventana de WhatsApp ya venció — hay que usar un template.",
          'error',
        );
      } else if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", 'error');
      } else if (code === "CLIENT_HAS_ACTIVE_CONVERSATION") {
        // The client wrote again after the close and already has a live
        // conversation — open that one instead of leaving the advisor
        // retrying this one (see lib/reopenConflict.ts).
        const active = extractActiveConversation(err);
        if (active) {
          notifyActiveConversation(active);
          navigate(buildChatUrl(active.id));
        } else {
          useToastStore.getState().showToast(
            extractErrorMessage(err) ??
              "El cliente ya tiene una conversación activa — ábrala desde ahí en vez de reabrir esta.",
            'error',
          );
        }
      }
    } finally {
      setIsReopening(false);
    }
  }

  async function handleReturnBot() {
    if (!conversationId) return;
    setIsReturning(true);
    try {
      await conversationsService.returnToBot(conversationId);
      setShowReturnModal(false);
      await loadConversation();
    } catch (err: unknown) {
      const code = extractErrorCode(err);
      setShowReturnModal(false);
      if (code === "BOT_ALREADY_ACTIVE") {
        useToastStore.getState().showToast("El bot ya controla esta conversación.", 'info');
        await loadConversation();
      } else if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", 'error');
      }
    } finally {
      setIsReturning(false);
    }
  }

  async function handleClose(data: CloseData) {
    if (!conversationId) return;
    setIsClosing(true);
    try {
      // Best-effort farewell — a send failure must never block the close itself.
      if (!data.alreadySaidGoodbye) {
        try {
          await conversationsService.replyText(conversationId, FAREWELL_MESSAGE);
        } catch {
          // interceptor already showed the error toast; closing continues regardless
        }
      }
      const { resolution_type, resolution_notes, client_satisfied } = data;
      await conversationsService.close(conversationId, { resolution_type, resolution_notes, client_satisfied });
      setShowCloseModal(false);
      navigate("/");
    } catch (err: unknown) {
      const code = extractErrorCode(err);
      if (code === "ALREADY_CLOSED") {
        useToastStore.getState().showToast("Esta conversación ya fue cerrada.", 'error');
      } else if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", 'error');
      }
    } finally {
      setIsClosing(false);
    }
  }

  function getChatVariant(): ChatVariant {
    if (!conversation) return "unassigned";
    const { bot_activo, escalation } = conversation;
    const isAdmin = role === "admin";
    const yoTengoControl = !bot_activo && escalation?.advisor?.id === advisor?.id;
    if (yoTengoControl) return "assigned";
    // Admin bypass: the backend lets any admin act (reply/return-bot/close) on
    // a conversation someone else manually controls — mirror that here so the
    // UI doesn't lock admins out of a permission they actually have.
    if (isAdmin && !bot_activo && !!escalation?.advisor) return "assigned";
    if (bot_activo) return "bot";
    if (!bot_activo && escalation?.advisor) return "monitoring";
    return "unassigned";
  }

  const variant = getChatVariant();
  const isReadonly =
    variant === "unassigned" || variant === "bot" || variant === "monitoring";
  const clientName = conversation?.client.full_name ?? "Cliente";
  const agentDisplay = agentLabel(conversation?.agent);

  // Ticks locally against the absolute expiry the backend sent — see
  // lib/whatsappWindow.ts. `null` renders as an open window, never as closed.
  const whatsappWindow = useWhatsAppWindow(conversation?.whatsapp_window_expires_at);

  // A 409 WINDOW_EXPIRED means the window closed between our last fetch and this
  // send. Mark it closed locally (merging, never replacing) so the composer locks
  // immediately instead of waiting for the next refetch.
  const handleWindowExpired = useCallback(() => {
    setConversation((prev) =>
      prev ? { ...prev, whatsapp_window_expires_at: new Date().toISOString() } : prev,
    );
  }, []);

  // Reopen is fail-closed on the window, the opposite of reply's fail-open: an
  // "unknown" (null) expiry means we cannot tell the window is still alive, so
  // the button stays disabled instead of defaulting to enabled like the composer
  // does. The backend re-validates on click regardless — this only avoids a
  // click we already know will fail.
  const canReopenNow = conversation?.status === "cerrada" &&
    (whatsappWindow.state === "open" || whatsappWindow.state === "closing");
  const reopenDisabledReason =
    whatsappWindow.state === "unknown"
      ? "Ventana desconocida — no se puede reabrir sin template"
      : "Ventana vencida";

  // A tab opened straight on /chat/{id} — the WhatsApp notification button, the
  // escalation email, a pasted link, a reload — has nothing of the panel behind
  // it, and navigate(-1) is then a silent no-op. React Router keeps the entry's
  // index in history.state.idx; it stays 0 through the login round-trip too,
  // because both of those redirects replace instead of push (location.key does
  // not survive that, which is why it is not used here).
  const handleBack = () => {
    const hasPanelHistory = (window.history.state?.idx ?? 0) > 0;
    if (hasPanelHistory) {
      navigate(-1);
      return;
    }
    navigate(conversation?.status === "cerrada" ? "/historial" : ROUTES.BANDEJA, {
      replace: true,
    });
  };

  const waitSeconds = conversation?.escalation?.escalated_at
    ? Math.floor((now - new Date(conversation.escalation.escalated_at).getTime()) / 1000)
    : (conversation?.escalation?.wait_seconds ?? null);
  const hasAdvisor = !!conversation?.escalation?.advisor;
  const waitMinutes: number | null = hasAdvisor ? null : (waitSeconds !== null ? Math.floor(waitSeconds / 60) : null);

  return (
    <section
      id="screen-chat"
      className="flex-1 flex flex-col lg:flex-row relative min-h-0"
    >
      {/* ── Central column ── */}
      <div className="flex-1 flex flex-col bg-bg-main border-r border-border-default min-w-0 min-h-0">
        {/* Header */}
        <div className="bg-bg-secondary px-4 py-3 border-b border-border-default flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-tertiary hover:bg-border-default border border-border-default rounded-control text-xs font-semibold text-text-secondary hover:text-white transition active:scale-[0.98] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              <span className="hidden sm:inline">Volver</span>
            </button>

            {/* Avatar del Cliente con Iniciales */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-blue to-success flex items-center justify-center text-xs font-extrabold text-white shrink-0 shadow-lg border border-border-default/35 select-none">
              {getInitials(clientName)}
            </div>

            <div>
              <h3 className="text-h3 text-text-primary flex items-center gap-1.5">
                {clientName}
                <span
                  id="chat-header-status-dot"
                  className={`w-2 h-2 rounded-full inline-block ${STATUS_DOT[variant]} ring-2 ring-bg-secondary`}
                  title={`Estado: ${variant}`}
                />
              </h3>
              <p className="text-[9px] text-text-secondary flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500/20 border border-green-500/40 inline-block" />
                WhatsApp: {agentDisplay}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 24h window countdown — omitted entirely when the expiry is unknown.
                Shown on closed conversations too, so the advisor can see whether
                "Reabrir" is worth clicking before she does. */}
            {whatsappWindow.msLeft !== null && (
              <div
                id="chat-window-pill"
                title={windowCountdownHint(clientName)}
                className={`hidden sm:flex items-center gap-1 text-[10px] px-2.5 py-1 rounded font-black border ${
                  whatsappWindow.state === "closed"
                    ? "bg-error/15 text-error border-error/30"
                    : whatsappWindow.state === "closing"
                      ? "bg-warning/15 text-warning border-warning/30"
                      : "bg-bg-tertiary text-text-secondary border-border-default"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  {whatsappWindow.state === "closed"
                    ? "Ventana cerrada"
                    : `Ventana 24 h · ${formatWindowCountdown(whatsappWindow.msLeft)}`}
                </span>
              </div>
            )}

            {/* Reabrir — closed conversations only. No template needed while the
                24h WhatsApp window is still alive; the backend re-validates it
                on click regardless of what this button shows. */}
            {conversation && conversation.status === "cerrada" && (
              canReopenNow ? (
                <button
                  type="button"
                  id="reopen-button"
                  onClick={handleReopen}
                  disabled={isReopening}
                  title={windowCountdownHint(clientName)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-brand-blue hover:bg-brand-blue-hover text-white rounded-control text-xs font-bold shadow-md shadow-brand-blue/30 transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
                >
                  {isReopening ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  )}
                  <span>Reabrir</span>
                </button>
              ) : (
                <div
                  id="reopen-disabled-pill"
                  title={reopenDisabledReason}
                  className="text-[10px] px-2.5 py-1 rounded font-black border bg-bg-tertiary text-text-secondary border-border-default flex items-center gap-1 cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Reabrir</span>
                </div>
              )
            )}

            {/* Control toggle — hidden on closed conversations (no action makes sense there) */}
            {conversation && conversation.status !== "cerrada" && (
              conversation.bot_activo ? (
                <button
                  type="button"
                  id="take-control-button"
                  onClick={handleTakeControl}
                  disabled={isTakingControl}
                  className="flex items-center gap-2 px-4 py-2.5 bg-brand-blue hover:bg-brand-blue-hover text-white rounded-control text-xs font-bold shadow-md shadow-brand-blue/30 transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
                >
                  {isTakingControl ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  )}
                  <span>Tomar control manual</span>
                </button>
              ) : (
                conversation.escalation?.advisor && (
                  <div
                    id="control-status-pill"
                    className={`text-[10px] px-2.5 py-1 rounded font-black border flex items-center gap-1 ${
                      conversation.escalation.advisor.id === advisor?.id
                        ? "bg-success/15 text-success border-success/30"
                        : "bg-warning/15 text-warning border-warning/30"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                    <span>
                      {conversation.escalation.reason === "control_manual_directo"
                        ? `Control manual — ${conversation.escalation.advisor.full_name}`
                        : `Asignada — ${conversation.escalation.advisor.full_name}`}
                    </span>
                  </div>
                )
              )
            )}

            {/* Mobile details toggle */}
            <button
              type="button"
              onClick={() => setRightPanelOpen(true)}
              className="lg:hidden flex items-center gap-1 px-2.5 py-1.5 bg-bg-tertiary hover:bg-border-default border border-border-default rounded-control text-xs font-semibold text-text-secondary hover:text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              <svg
                className="w-4 h-4 text-brand-blue"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>Detalles</span>
            </button>
          </div>
        </div>

        {fromNotification && (
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-[11px] text-warning">
            <span className="min-w-0 truncate">
              Viniste desde la notificación <strong className="font-bold">«{fromNotification.title}»</strong>
            </span>
            <button
              type="button"
              onClick={() =>
                navigate(buildNotificationsUrl({ status: fromNotification.status, id: fromNotification.id }))
              }
              className="shrink-0 font-bold underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              ← Volver a la notificación
            </button>
          </div>
        )}

        {/* Message feed */}
        <MessageFeed
          messages={messages}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          showEscalationEvent={conversation?.status === "escalada"}
          showReturnedEvent={showReturnedPill}
          advisorName={fromAlert ? alertAdvisorName : advisor?.full_name}
          clientName={conversation?.client.full_name}
          onScrollTop={loadMoreMessages}
          feedRef={feedRef}
          highlightedWamId={highlightedWamId}
          onRetryMessage={retryMessage}
        />

        {/* Input area or banners */}
        {!isReadonly ? (
          <ChatInput
            conversationId={conversationId!}
            clientName={clientName}
            agentDisplay={agentDisplay}
            waitMinutes={waitMinutes}
            currentAdvisorName={advisor?.full_name}
            onOptimisticMessage={addOptimisticMessage}
            onMessageConfirmed={confirmOptimisticMessage}
            onMessageFailed={failOptimisticMessage}
            whatsappWindow={whatsappWindow}
            onWindowExpired={handleWindowExpired}
            onRegisterRetry={registerRetryHandler}
          />
        ) : (
          <div className="p-3 bg-bg-secondary border-t border-border-default shrink-0">
            {variant === "unassigned" && (
              <div
                id="chat-banner-readonly"
                className="p-2.5 bg-bg-tertiary text-center border border-border-default rounded text-xs text-warning font-semibold"
              >
                ⚠️ Modo de Solo Lectura • Debes tomar la conversación para
                responder.
              </div>
            )}
            {variant === "monitoring" && (
              <div
                id="chat-banner-monitoring"
                className="p-2.5 bg-warning/5 text-center border border-warning/20 rounded text-xs text-warning font-semibold"
              >
                {conversation?.escalation?.advisor
                  ? `🔒 ${conversation.escalation.advisor.full_name} tiene el control manual de esta conversación.`
                  : "👁️ Modo de solo lectura."}
              </div>
            )}
            {variant === "bot" && (
              <div
                id="chat-banner-bot"
                className="p-2.5 bg-success/10 text-center border border-success/30 rounded text-xs text-success font-semibold"
              >
                {conversation?.has_escalation_history
                  ? "🤖 El bot retomó esta conversación."
                  : "🤖 El bot está gestionando esta conversación."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Mobile backdrop ── */}
      {rightPanelOpen && (
        <div
          className="fixed inset-0 bg-black/75 z-30 lg:hidden"
          onClick={() => setRightPanelOpen(false)}
        />
      )}

      {/* ── Right panel ── */}
      {conversation && (
        <div className={`${rightPanelOpen ? "flex" : "hidden"} lg:flex`}>
          <ClientPanel
            conversation={conversation}
            variant={variant}
            onTake={handleTake}
            onReturnBot={() => setShowReturnModal(true)}
            onCloseConversation={() => setShowCloseModal(true)}
            onTransfer={() => setShowTransferModal(true)}
            isTaking={isAssigning}
            isReturning={isReturning}
            isAdmin={role === 'admin'}
            onClose={() => setRightPanelOpen(false)}
          />
        </div>
      )}

      {/* ── Return-bot modal ── */}
      {showReturnModal && (
        <ReturnBotModal
          onConfirm={handleReturnBot}
          onCancel={() => setShowReturnModal(false)}
          isReturning={isReturning}
        />
      )}

      {/* ── Close conversation modal ── */}
      {showCloseModal && (
        <CloseConversationModal
          onConfirm={handleClose}
          onCancel={() => setShowCloseModal(false)}
          isClosing={isClosing}
        />
      )}

      {/* ── Transfer conversation modal ── */}
      {showTransferModal && (
        <TransferModal
          onConfirm={handleTransfer}
          onCancel={() => setShowTransferModal(false)}
          currentAssignedAdvisorId={conversation?.escalation?.advisor?.id}
        />
      )}
    </section>
  );
}
