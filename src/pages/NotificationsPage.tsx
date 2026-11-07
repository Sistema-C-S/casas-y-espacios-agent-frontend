// Agent notifications inbox (both roles). A table like the historial: each row
// carries its own actions (open the conversation, resolve or discard) —
// there is no per-notification detail view.
//
// The URL drives the view: `?status=` is the tab; `?id=` only highlights a row
// (links from the global toast and from the chat's "back" banner).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useNotificationsStore } from '../store/notificationsStore'
import { useToastStore } from '../store/toastStore'
import { useNotificationsInbox, type CloseOutcome } from '../hooks/useNotificationsInbox'
import { FOCUS_HIGHLIGHT_MS } from '../hooks/useFocusMessage'
import { notificationClientName, parseStatusFilter } from '../lib/notificationFormat'
import { buildChatUrl } from '../lib/notificationRoutes'
import NotificationTabs from '../components/notifications/NotificationTabs'
import NotificationsTable from '../components/notifications/NotificationsTable'
import CloseNotificationDialog from '../components/notifications/CloseNotificationDialog'
import { getNotificationType } from '../components/notifications/types/registry'
import type { ChatLocationState } from '../types/navigation'
import type { AgentNotification, NotificationCloseStatus, NotificationStatusFilter } from '../types'

const CLOSE_SUCCESS_MESSAGES: Record<NotificationCloseStatus, string> = {
  resuelta: 'Notificación marcada como resuelta.',
  descartada: 'Notificación descartada.',
}

function alreadyClosedMessage(notification: AgentNotification | null | undefined): string {
  const who = notification?.resolved_by?.full_name ?? 'Otro asesor'
  return `${who} ya cerró esta notificación.`
}

function describe(notification: AgentNotification): string {
  const { description } = getNotificationType(notification.type)
  return `${notificationClientName(notification.client)} · ${description}`
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseStatusFilter(searchParams.get('status'))
  const targetId = searchParams.get('id')

  const advisorId = useAuthStore((s) => s.advisor?.id ?? null)
  const pendingCount = useNotificationsStore((s) => s.pendingCount)
  const inbox = useNotificationsInbox(filter)
  const { items, getItem, close } = inbox

  const [closeTarget, setCloseTarget] = useState<{ id: string; status: NotificationCloseStatus } | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const closeItem = closeTarget ? getItem(closeTarget.id) : null
  // Someone else closed it while the dialog was open (the row updated live via
  // notification.updated): the dialog disappears on its own. While our own
  // close is in flight it stays, so its outcome can be shown.
  const closedElsewhere = closeItem !== null && closeItem.status !== 'pendiente' && !isClosing
  const showCloseDialog = closeTarget !== null && closeItem !== null && !closedElsewhere

  const handleFilterChange = useCallback(
    (status: NotificationStatusFilter) => {
      setSearchParams({ status }, { replace: true })
    },
    [setSearchParams],
  )

  // `?id=` → scroll to that row and flash it once it is in the loaded list.
  const highlightedOnceRef = useRef<string | null>(null)
  useEffect(() => {
    if (!targetId || highlightedOnceRef.current === targetId) return
    if (!items.some((item) => item.id === targetId)) return
    highlightedOnceRef.current = targetId
    const frame = requestAnimationFrame(() => {
      document.getElementById(`notification-row-${targetId}`)?.scrollIntoView({ block: 'center' })
      setHighlightedId(targetId)
    })
    return () => cancelAnimationFrame(frame)
  }, [targetId, items])

  useEffect(() => {
    if (!highlightedId) return
    const timer = setTimeout(() => setHighlightedId(null), FOCUS_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightedId])

  // Tell who closed it — once per dialog. Also covers an event that landed
  // during our own in-flight close: it fires as soon as that close settles.
  const toastedCloseRef = useRef<typeof closeTarget>(null)
  useEffect(() => {
    if (!closedElsewhere || toastedCloseRef.current === closeTarget) return
    toastedCloseRef.current = closeTarget
    useToastStore.getState().showToast(alreadyClosedMessage(closeItem), 'info')
  }, [closedElsewhere, closeTarget, closeItem])

  const handleOpenConversation = useCallback(
    (notification: AgentNotification) => {
      const focusWamId = notification.attachments[0]?.wam_id
      const state: ChatLocationState = {
        fromNotification: { id: notification.id, title: getNotificationType(notification.type).description, status: filter },
        ...(focusWamId ? { focusWamId } : {}),
      }
      navigate(buildChatUrl(notification.conversation.id), { state })
    },
    [filter, navigate],
  )

  const handleRequestClose = useCallback((notification: AgentNotification, status: NotificationCloseStatus) => {
    setCloseError(null)
    setCloseTarget({ id: notification.id, status })
  }, [])

  const handleCancelClose = useCallback(() => {
    if (!isClosing) setCloseTarget(null)
  }, [isClosing])

  const applyCloseOutcome = useCallback((outcome: CloseOutcome, status: NotificationCloseStatus) => {
    const { showToast } = useToastStore.getState()
    switch (outcome.kind) {
      case 'closed':
        setCloseTarget(null)
        showToast(CLOSE_SUCCESS_MESSAGES[status], 'success')
        break
      case 'already_closed':
        setCloseTarget(null)
        showToast(alreadyClosedMessage(outcome.notification), 'info')
        break
      case 'not_found':
        setCloseTarget(null)
        showToast('La notificación ya no existe.', 'warning')
        break
      case 'invalid':
        setCloseError('Revisa la nota: no es válida o supera los 500 caracteres.')
        break
      case 'unconfirmed':
        setCloseError('No se pudo confirmar el cierre. Intenta de nuevo.')
        break
    }
  }, [])

  const handleConfirmClose = useCallback(
    async (note: string) => {
      if (!closeTarget || isClosing) return
      const { id, status } = closeTarget
      setIsClosing(true)
      setCloseError(null)
      try {
        applyCloseOutcome(await close(id, status, note), status)
      } finally {
        setIsClosing(false)
      }
    },
    [closeTarget, isClosing, close, applyCloseOutcome],
  )

  return (
    <section id="screen-notificaciones" className="flex-1 flex flex-col min-h-0 p-4 md:p-6 gap-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border-default pb-4">
        <div>
          <h2 className="text-h2 text-text-primary">Notificaciones</h2>
          <p className="text-xs text-text-secondary">Notificaciones generadas por el asistente de IA por gestionar</p>
        </div>
        <NotificationTabs value={filter} pendingCount={pendingCount} onChange={handleFilterChange} />
      </div>

      <NotificationsTable
        items={items}
        filter={filter}
        highlightedId={highlightedId}
        currentAdvisorId={advisorId}
        isLoading={inbox.isLoading}
        isLoadingMore={inbox.isLoadingMore}
        hasMore={inbox.hasMore}
        error={inbox.error}
        onLoadMore={inbox.loadMore}
        onRetry={inbox.retry}
        onOpenConversation={handleOpenConversation}
        onRequestClose={handleRequestClose}
      />

      {showCloseDialog && closeTarget && closeItem && (
        <CloseNotificationDialog
          key={`${closeTarget.id}-${closeTarget.status}`}
          status={closeTarget.status}
          context={describe(closeItem)}
          isSubmitting={isClosing}
          error={closeError}
          onConfirm={handleConfirmClose}
          onCancel={handleCancelClose}
        />
      )}

    </section>
  )
}
