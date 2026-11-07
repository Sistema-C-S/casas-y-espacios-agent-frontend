// Global state for agent notifications — only what must live outside the
// notifications page: the pending count (sidebar badge) and the latest
// incoming notification (global toast). The inbox list itself is page state.

import { create } from 'zustand'
import type { AgentNotification } from '../types'
import { useAuthStore } from './authStore'

interface NotificationsState {
  pendingCount: number
  /** When a live (WebSocket) count last arrived. */
  liveCountAt: number
  incoming: AgentNotification | null

  /** Live count from a WebSocket event. */
  setPendingCount: (count: number) => void
  /** Count from an HTTP response; ignored if a live count arrived after the request started. */
  setPendingCountSnapshot: (count: number, requestStartedAt: number) => void
  /**
   * One pending notification was closed by this advisor (the PATCH response has
   * no count). Ignored if a live count arrived after the request started: that
   * count is authoritative and already includes the close.
   */
  decrementPendingAfterClose: (requestStartedAt: number) => void
  setIncoming: (notification: AgentNotification) => void
  clearIncoming: () => void
  reset: () => void
}

const INITIAL_STATE = { pendingCount: 0, liveCountAt: 0, incoming: null }

function toCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  ...INITIAL_STATE,

  setPendingCount: (count) => set({ pendingCount: toCount(count), liveCountAt: Date.now() }),
  setPendingCountSnapshot: (count, requestStartedAt) =>
    set((state) => (state.liveCountAt > requestStartedAt ? state : { pendingCount: toCount(count) })),
  decrementPendingAfterClose: (requestStartedAt) =>
    set((state) =>
      state.liveCountAt > requestStartedAt ? state : { pendingCount: toCount(state.pendingCount - 1) },
    ),
  setIncoming: (incoming) => set({ incoming }),
  clearIncoming: () => set({ incoming: null }),
  reset: () => set(INITIAL_STATE),
}))

// sessionEpoch only moves when a session ENDS (logout, expiry, account switch).
// Resetting here keeps one advisor's badge/toast from leaking into the next
// session without making authStore depend on this store.
useAuthStore.subscribe((state, prev) => {
  if (state.sessionEpoch !== prev.sessionEpoch) {
    useNotificationsStore.getState().reset()
  }
})
