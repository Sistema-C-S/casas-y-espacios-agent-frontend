import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useNotificationsStore } from '../../store/notificationsStore'
import { ROUTES } from '../../constants/routes'
import { buildNotificationsUrl } from '../../lib/notificationRoutes'
import { notificationClientName } from '../../lib/notificationFormat'
import { getNotificationType } from '../notifications/types/registry'

const AUTO_DISMISS_MS = 12000

// Fed by notification.new (useWebSocket → notificationsStore.incoming). On the
// notifications page itself the row already appears at the top of the list, so
// the toast is suppressed there and only the sound plays.
export default function NotificationToast() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const incoming = useNotificationsStore((s) => s.incoming)
  const onNotificationsPage = pathname === ROUTES.NOTIFICACIONES

  useEffect(() => {
    if (!incoming) return
    const { clearIncoming } = useNotificationsStore.getState()
    if (onNotificationsPage) {
      clearIncoming()
      return
    }
    const timer = setTimeout(clearIncoming, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [incoming, onNotificationsPage])

  if (!incoming || onNotificationsPage) return null

  const definition = getNotificationType(incoming.type)
  const Icon = definition.icon

  const dismiss = () => useNotificationsStore.getState().clearIncoming()
  const open = () => {
    navigate(buildNotificationsUrl({ status: 'pendiente', id: incoming.id }))
    dismiss()
  }

  return (
    <div
      id="new-notification-toast"
      role="status"
      aria-live="polite"
      // Bottom-right: the escalation toast and ToastStack both own top-24 right-4.
      className="fixed bottom-4 right-4 bg-bg-secondary border-l-4 border-l-warning border border-border-default rounded-r-lg shadow-md p-3.5 w-80 max-w-[calc(100vw-2rem)] z-[998] pointer-events-auto animate-slide-in-right"
    >
      <div className="flex items-start gap-3">
        <div className="bg-warning/10 p-2 rounded-lg text-warning shrink-0">
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 text-xs">
          <div className="flex justify-between items-start gap-2">
            <h5 className="font-bold text-white">{definition.toastTitle}</h5>
            <button
              type="button"
              onClick={dismiss}
              className="text-text-secondary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 transition"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-text-secondary mt-1 truncate">
            Cliente: <strong className="text-white">{notificationClientName(incoming.client)}</strong>
          </p>
          <p className="text-[11px] text-text-secondary truncate">{definition.description}</p>
          <div className="mt-2.5 flex justify-end gap-2 text-[10px]">
            <button
              type="button"
              onClick={dismiss}
              className="px-2 py-1 hover:bg-bg-tertiary text-text-secondary rounded-control font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 transition"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={open}
              className="bg-brand-blue text-white px-2.5 py-1 rounded-control font-bold hover:bg-brand-blue-hover transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
            >
              Ver
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
