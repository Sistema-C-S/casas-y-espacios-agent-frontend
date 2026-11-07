// Pure state machine for the notifications inbox page.
//
// `byId` is a cache that outlives the visible list: a notification that leaves
// the filtered list (closed while viewing "Pendientes") can still be resolved by
// id — the page needs it to explain who closed a row whose close dialog is open.
// `order` is the visible list for the active filter.
//
// `liveIds` are rows inserted by live events since the last full reload, so a
// reload whose snapshot predates them does not drop them.
//
// `serverOffset` tracks how many rows of the server's filtered result set are
// already loaded. Live inserts/removals shift that set, so it is nudged ±1 to
// keep "Cargar más" from skipping or repeating rows.
import type { AgentNotification, NotificationStatusFilter } from '../types'

export interface InboxState {
  byId: Record<string, AgentNotification>
  order: string[]
  total: number
  serverOffset: number
  filter: NotificationStatusFilter
  liveIds: string[]
}

export type InboxAction =
  | { type: 'filterChanged'; filter: NotificationStatusFilter }
  | { type: 'pageLoaded'; items: AgentNotification[]; total: number; replace: boolean }
  | { type: 'upserted'; item: AgentNotification }
  | { type: 'removed'; id: string }

export function createInboxState(filter: NotificationStatusFilter): InboxState {
  return { byId: {}, order: [], total: 0, serverOffset: 0, filter, liveIds: [] }
}

export function matchesFilter(item: AgentNotification, filter: NotificationStatusFilter): boolean {
  return filter === 'all' || item.status === filter
}

function toTime(iso: string): number {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? 0 : time
}

/**
 * Whether `incoming` should replace `existing`. Guards against out-of-order or
 * duplicated WebSocket events: an older snapshot never overwrites a newer one,
 * and a closed notification never goes back to pending (no reopening exists).
 */
export function isNewer(incoming: AgentNotification, existing: AgentNotification | undefined): boolean {
  if (!existing) return true
  if (existing.status !== 'pendiente' && incoming.status === 'pendiente') return false
  return toTime(incoming.updated_at) >= toTime(existing.updated_at)
}

function mergeById(
  byId: Record<string, AgentNotification>,
  items: AgentNotification[],
): Record<string, AgentNotification> {
  const next = { ...byId }
  for (const item of items) {
    if (isNewer(item, next[item.id])) next[item.id] = item
  }
  return next
}

// Newest first, matching the server's ordering.
function insertSorted(order: string[], byId: Record<string, AgentNotification>, item: AgentNotification): string[] {
  const created = toTime(item.created_at)
  const index = order.findIndex((id) => toTime(byId[id].created_at) < created)
  return index === -1 ? [...order, item.id] : [...order.slice(0, index), item.id, ...order.slice(index)]
}

function upsert(state: InboxState, item: AgentNotification): InboxState {
  if (!isNewer(item, state.byId[item.id])) return state

  const byId = { ...state.byId, [item.id]: item }
  const isListed = state.order.includes(item.id)
  const belongs = matchesFilter(item, state.filter)

  if (isListed && belongs) return { ...state, byId }

  if (isListed && !belongs) {
    return {
      ...state,
      byId,
      order: state.order.filter((id) => id !== item.id),
      total: Math.max(0, state.total - 1),
      serverOffset: Math.max(0, state.serverOffset - 1),
    }
  }

  if (!belongs) return { ...state, byId }

  // Joins the filtered set. If it sorts after everything loaded while more
  // pages remain, it belongs to a page not fetched yet: count it, don't show it.
  const hasMore = state.serverOffset < state.total
  const oldestLoaded = state.order[state.order.length - 1]
  const sortsBeyondWindow =
    hasMore && oldestLoaded !== undefined && toTime(item.created_at) < toTime(byId[oldestLoaded].created_at)

  if (sortsBeyondWindow) return { ...state, byId, total: state.total + 1 }

  return {
    ...state,
    byId,
    order: insertSorted(state.order, byId, item),
    total: state.total + 1,
    serverOffset: state.serverOffset + 1,
    liveIds: [...state.liveIds, item.id],
  }
}

export function inboxReducer(state: InboxState, action: InboxAction): InboxState {
  switch (action.type) {
    case 'filterChanged':
      // Keep the cache: an open close dialog may still need the row by id.
      return { ...createInboxState(action.filter), byId: state.byId }

    case 'pageLoaded': {
      const byId = mergeById(state.byId, action.items)
      // A live event may have closed a row while this request was in flight:
      // the merged (newest) copy decides, not the snapshot. Those rows already
      // left the server's filtered set, so they count neither in total nor offset.
      const pageIds = [...new Set(action.items.map((item) => item.id))]
      const visible = pageIds.filter((id) => matchesFilter(byId[id], state.filter))
      const dropped = pageIds.length - visible.length
      const total = Math.max(0, action.total - dropped)
      const consumed = Math.max(0, action.items.length - dropped)

      if (action.replace) {
        const inPage = new Set(visible)
        const live = state.liveIds.filter(
          (id) => !inPage.has(id) && byId[id] !== undefined && matchesFilter(byId[id], state.filter),
        )
        const order = live.reduce((acc, id) => insertSorted(acc, byId, byId[id]), visible)
        return { ...state, byId, order, total: total + live.length, serverOffset: consumed + live.length, liveIds: [] }
      }
      const known = new Set(state.order)
      return {
        ...state,
        byId,
        order: [...state.order, ...visible.filter((id) => !known.has(id))],
        total,
        serverOffset: state.serverOffset + consumed,
      }
    }

    case 'upserted':
      return upsert(state, action.item)

    case 'removed': {
      if (!state.byId[action.id] && !state.order.includes(action.id)) return state
      const byId = { ...state.byId }
      delete byId[action.id]
      const wasListed = state.order.includes(action.id)
      return {
        ...state,
        byId,
        order: state.order.filter((id) => id !== action.id),
        total: wasListed ? Math.max(0, state.total - 1) : state.total,
        serverOffset: wasListed ? Math.max(0, state.serverOffset - 1) : state.serverOffset,
      }
    }

    default:
      return state
  }
}

export function selectItems(state: InboxState): AgentNotification[] {
  return state.order.map((id) => state.byId[id])
}

export function selectHasMore(state: InboxState): boolean {
  return state.serverOffset < state.total
}
