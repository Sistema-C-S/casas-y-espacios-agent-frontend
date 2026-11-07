import { ROUTES } from '../constants/routes'
import type { NotificationStatusFilter } from '../types'

/** The URL drives the inbox: `?status=` is the tab, `?id=` the row to highlight. */
export function buildNotificationsUrl(params: { status?: NotificationStatusFilter; id?: string | null } = {}): string {
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  if (params.id) search.set('id', params.id)
  const query = search.toString()
  return query ? `${ROUTES.NOTIFICACIONES}?${query}` : ROUTES.NOTIFICACIONES
}

export function buildChatUrl(conversationId: string): string {
  return ROUTES.CHAT.replace(':id', encodeURIComponent(conversationId))
}
