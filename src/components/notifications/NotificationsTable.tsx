import type { AgentNotification, NotificationStatusFilter } from '../../types'
import NotificationTableRow, { type NotificationRowActions } from './NotificationTableRow'

const EMPTY_MESSAGES: Record<NotificationStatusFilter, string> = {
  pendiente: 'No hay notificaciones pendientes.',
  resuelta: 'Todavía no hay notificaciones resueltas.',
  descartada: 'No hay notificaciones descartadas.',
  all: 'Todavía no hay notificaciones.',
}

const COLUMNS = ['N° de Caso', 'Cliente', 'Recibida', 'Notificación', 'Agente', 'Estado', 'Acciones']

interface NotificationsTableProps extends NotificationRowActions {
  items: AgentNotification[]
  filter: NotificationStatusFilter
  highlightedId: string | null
  currentAdvisorId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: string | null
  onLoadMore: () => void
  onRetry: () => void
}

// Same table pattern as the historial: sticky header, rows scroll inside the
// box, horizontal scroll on narrow screens.
export default function NotificationsTable({
  items,
  filter,
  highlightedId,
  currentAdvisorId,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onLoadMore,
  onRetry,
  ...actions
}: NotificationsTableProps) {
  if (isLoading && items.length === 0) {
    return (
      <div className="flex-1 space-y-2" aria-busy="true" aria-label="Cargando notificaciones">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-14 rounded-control border border-border-default bg-bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="app-scroll flex-1 min-h-0 w-full bg-bg-secondary border border-border-default rounded-xl overflow-auto">
        <table id="notifications-table" className="w-full text-left text-xs text-text-primary">
          <thead className="sticky top-0 z-10 bg-bg-tertiary border-b border-border-default text-text-secondary text-label uppercase">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} className="p-4 whitespace-nowrap">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length}>
                  <div className="text-center py-12 space-y-2">
                    <p className={`text-sm ${error ? 'text-error' : 'text-text-secondary'}`}>
                      {error ?? EMPTY_MESSAGES[filter]}
                    </p>
                    {error && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="text-[11px] font-bold text-text-primary underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
                      >
                        Reintentar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              items.map((notification) => (
                <NotificationTableRow
                  key={notification.id}
                  notification={notification}
                  highlighted={notification.id === highlightedId}
                  currentAdvisorId={currentAdvisorId}
                  {...actions}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {items.length > 0 && error && <p className="text-[11px] text-error text-center">{error}</p>}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="shrink-0 w-full py-2 text-[11px] font-bold border border-border-default text-text-secondary rounded-control hover:text-text-primary hover:border-text-secondary transition disabled:opacity-60 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
        >
          {isLoadingMore && (
            <span className="w-3 h-3 border-2 border-text-secondary border-t-transparent rounded-full animate-spin" />
          )}
          Cargar más
        </button>
      )}
    </div>
  )
}
