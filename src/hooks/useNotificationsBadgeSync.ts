// Keeps the sidebar's pending-notifications badge in sync with the backend.
//
// Live updates arrive on the WebSocket (`pending_count` in every notification
// event, handled in useWebSocket). This hook covers what events cannot: the
// initial value when a session starts, and the gap after a reconnect, when any
// event emitted while offline is gone for good. Mounted once, in ProtectedRoute.
import { useEffect } from 'react'
import { notificationsService } from '../services/notifications'
import { useNotificationsStore } from '../store/notificationsStore'

export function useNotificationsBadgeSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let controller = new AbortController()

    const sync = () => {
      controller.abort()
      controller = new AbortController()
      const { signal } = controller
      const startedAt = Date.now()
      notificationsService
        .list({ status: 'pendiente', limit: 1 }, signal, { silent: true })
        .then((result) => {
          if (!signal.aborted) useNotificationsStore.getState().setPendingCountSnapshot(result.pending_count, startedAt)
        })
        .catch(() => {
          // The request is `silent` (no interceptor toast) too: an older backend
          // without the route (404) or a missing table (503) must not nag on every
          // login/reconnect. The badge keeps its last value; the next event or
          // reconnect corrects it.
        })
    }

    sync()
    window.addEventListener('ws:reconnected', sync)
    return () => {
      window.removeEventListener('ws:reconnected', sync)
      controller.abort()
    }
  }, [enabled])
}
