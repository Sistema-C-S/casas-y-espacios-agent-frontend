// Data layer of the notifications page: loading, pagination, live updates and
// closing. All list state goes through the pure inboxReducer
// (lib/notificationInbox.ts); this hook only does I/O and wiring.
import { useCallback, useEffect, useReducer, useRef } from 'react'
import { notificationsService } from '../services/notifications'
import { useNotificationsStore } from '../store/notificationsStore'
import { useAuthStore } from '../store/authStore'
import { useWebSocket } from './useWebSocket'
import { useAbortableLoad } from './useAbortableLoad'
import { getApiErrorInfo, isAbortError } from '../lib/apiError'
import {
  createInboxState,
  inboxReducer,
  selectHasMore,
  selectItems,
} from '../lib/notificationInbox'
import type {
  AgentNotification,
  NotificationCloseStatus,
  NotificationStatusFilter,
  WSNotificationEvent,
} from '../types'

export const NOTIFICATIONS_PAGE_SIZE = 20

// The close and its follow-up refetch report their own outcome (dialog message
// or toast); the interceptor's generic toast would stack a second, vaguer one.
const SILENT = { silent: true } as const

export type CloseOutcome =
  | { kind: 'closed'; notification: AgentNotification }
  | { kind: 'already_closed'; notification: AgentNotification | null }
  | { kind: 'not_found' }
  // 503 / network: the close may or may not have happened and the refetch
  // could not prove it did — the caller keeps the dialog open for a retry.
  | { kind: 'unconfirmed' }
  | { kind: 'invalid' }

type RefetchOutcome =
  | { kind: 'found'; notification: AgentNotification }
  | { kind: 'not_found' }
  | { kind: 'error' }

// Request lifecycle, kept apart from the data reducer (lib/notificationInbox.ts).
// Load and "load more" errors are kept apart so one never clears or overwrites
// the other (a stale page settling after a tab change, say).
interface RequestState {
  isLoading: boolean
  isLoadingMore: boolean
  loadError: string | null
  moreError: string | null
}

type RequestAction =
  | { type: 'loadStarted' }
  | { type: 'loadFinished'; error?: string }
  | { type: 'moreStarted' }
  | { type: 'moreFinished'; error?: string }

const INITIAL_REQUEST_STATE: RequestState = { isLoading: true, isLoadingMore: false, loadError: null, moreError: null }

function requestReducer(state: RequestState, action: RequestAction): RequestState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, isLoading: true, isLoadingMore: false, loadError: null, moreError: null }
    case 'loadFinished':
      return { ...state, isLoading: false, loadError: action.error ?? null }
    case 'moreStarted':
      return { ...state, isLoadingMore: true, moreError: null }
    case 'moreFinished':
      return { ...state, isLoadingMore: false, moreError: action.error ?? null }
    default:
      return state
  }
}

export function useNotificationsInbox(filter: NotificationStatusFilter) {
  const [state, dispatch] = useReducer(inboxReducer, filter, createInboxState)
  const [request, dispatchRequest] = useReducer(requestReducer, INITIAL_REQUEST_STATE)
  const { getSignal, isMounted } = useAbortableLoad()

  // Every list request gets a ticket; a response whose ticket is stale (the
  // filter changed, or a reload superseded it) is dropped.
  const requestIdRef = useRef(0)
  const filterRef = useRef(filter)

  const loadFirstPage = useCallback(
    async (activeFilter: NotificationStatusFilter) => {
      const requestId = ++requestIdRef.current
      const startedAt = Date.now()
      dispatchRequest({ type: 'loadStarted' })
      try {
        const result = await notificationsService.list(
          { status: activeFilter, limit: NOTIFICATIONS_PAGE_SIZE, offset: 0 },
          getSignal(),
        )
        if (!isMounted() || requestId !== requestIdRef.current) return
        dispatch({ type: 'pageLoaded', items: result.notifications, total: result.total, replace: true })
        dispatchRequest({ type: 'loadFinished' })
        useNotificationsStore.getState().setPendingCountSnapshot(result.pending_count, startedAt)
      } catch (err) {
        if (isAbortError(err) || !isMounted() || requestId !== requestIdRef.current) return
        dispatchRequest({ type: 'loadFinished', error: 'No se pudieron cargar las notificaciones.' })
      }
    },
    [getSignal, isMounted],
  )

  useEffect(() => {
    filterRef.current = filter
    dispatch({ type: 'filterChanged', filter })
    void loadFirstPage(filter)
  }, [filter, loadFirstPage])

  const { serverOffset } = state
  const { isLoadingMore } = request
  const loadMore = useCallback(async () => {
    if (isLoadingMore) return
    const requestId = requestIdRef.current
    const startedAt = Date.now()
    dispatchRequest({ type: 'moreStarted' })
    // A reload/filter change superseded this page: drop it entirely — data,
    // error and loading flag all belong to the new first page now.
    const isCurrent = () => isMounted() && requestId === requestIdRef.current
    try {
      const result = await notificationsService.list(
        { status: filterRef.current, limit: NOTIFICATIONS_PAGE_SIZE, offset: serverOffset },
        getSignal(),
      )
      if (!isCurrent()) return
      dispatch({ type: 'pageLoaded', items: result.notifications, total: result.total, replace: false })
      dispatchRequest({ type: 'moreFinished' })
      useNotificationsStore.getState().setPendingCountSnapshot(result.pending_count, startedAt)
    } catch (err) {
      if (!isCurrent()) return
      dispatchRequest({
        type: 'moreFinished',
        error: isAbortError(err) ? undefined : 'No se pudieron cargar más notificaciones.',
      })
    }
  }, [isLoadingMore, serverOffset, getSignal, isMounted])

  const retry = useCallback(() => {
    void loadFirstPage(filterRef.current)
  }, [loadFirstPage])

  // Events lost while the socket was down never come back: reload the tab.
  useEffect(() => {
    const onReconnected = () => void loadFirstPage(filterRef.current)
    window.addEventListener('ws:reconnected', onReconnected)
    return () => window.removeEventListener('ws:reconnected', onReconnected)
  }, [loadFirstPage])

  // Stable identities (Rule 5): `dispatch` never changes.
  const onNotificationEvent = useCallback((data: WSNotificationEvent) => {
    dispatch({ type: 'upserted', item: data.notification })
  }, [])
  useWebSocket({ onNotificationNew: onNotificationEvent, onNotificationUpdated: onNotificationEvent })

  // Re-reads one row after a failed close, to tell who closed it (409) or
  // whether the close actually landed (503 / network).
  const refetch = useCallback(
    async (id: string): Promise<RefetchOutcome> => {
      try {
        const { notification } = await notificationsService.getById(id, getSignal(), SILENT)
        if (!isMounted()) return { kind: 'error' }
        dispatch({ type: 'upserted', item: notification })
        return { kind: 'found', notification }
      } catch (err) {
        if (!isMounted() || isAbortError(err)) return { kind: 'error' }
        const { status, code } = getApiErrorInfo(err)
        if (status === 404 || code === 'NOTIFICATION_NOT_FOUND') {
          dispatch({ type: 'removed', id })
          return { kind: 'not_found' }
        }
        return { kind: 'error' }
      }
    },
    [getSignal, isMounted],
  )

  const close = useCallback(
    async (id: string, status: NotificationCloseStatus, note: string): Promise<CloseOutcome> => {
      const startedAt = Date.now()
      try {
        const { notification } = await notificationsService.close(id, { status, note }, SILENT)
        // The PATCH carries no pending_count; the WS event will set the
        // authoritative one, which this converges with rather than adds to.
        useNotificationsStore.getState().decrementPendingAfterClose(startedAt)
        if (isMounted()) dispatch({ type: 'upserted', item: notification })
        return { kind: 'closed', notification }
      } catch (err) {
        const info = getApiErrorInfo(err)
        if (info.code === 'NOTIFICATION_ALREADY_CLOSED' || info.status === 409) {
          const refreshed = await refetch(id)
          return { kind: 'already_closed', notification: refreshed.kind === 'found' ? refreshed.notification : null }
        }
        if (info.code === 'NOTIFICATION_NOT_FOUND' || info.status === 404) {
          dispatch({ type: 'removed', id })
          return { kind: 'not_found' }
        }
        if (info.status === 422) return { kind: 'invalid' }
        // 503 or network: the contract says the close may have happened —
        // refetch before letting the advisor retry.
        const refreshed = await refetch(id)
        if (refreshed.kind === 'not_found') return { kind: 'not_found' }
        if (refreshed.kind !== 'found' || refreshed.notification.status === 'pendiente') return { kind: 'unconfirmed' }
        // Closed, but only ours if it was this advisor and the status asked for.
        const advisorId = useAuthStore.getState().advisor?.id
        const ours = refreshed.notification.resolved_by?.id === advisorId && refreshed.notification.status === status
        return ours
          ? { kind: 'closed', notification: refreshed.notification }
          : { kind: 'already_closed', notification: refreshed.notification }
      }
    },
    [refetch, isMounted],
  )

  const getItem = useCallback((id: string | null) => (id ? state.byId[id] ?? null : null), [state.byId])

  return {
    items: selectItems(state),
    hasMore: selectHasMore(state),
    isLoading: request.isLoading,
    isLoadingMore: request.isLoadingMore,
    error: request.loadError ?? request.moreError,
    loadMore,
    retry,
    getItem,
    close,
  }
}
