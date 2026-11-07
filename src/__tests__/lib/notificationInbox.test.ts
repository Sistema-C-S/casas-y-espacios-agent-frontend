import { describe, it, expect } from 'vitest'
import {
  createInboxState,
  inboxReducer,
  isNewer,
  matchesFilter,
  selectHasMore,
  selectItems,
  type InboxState,
} from '../../lib/notificationInbox'
import { notification } from '../fixtures/notifications'

const at = (minute: number) => `2026-10-04T15:${String(minute).padStart(2, '0')}:00.000000+00:00`

function loaded(filter: InboxState['filter'], items = [notification()], total = items.length): InboxState {
  return inboxReducer(createInboxState(filter), { type: 'pageLoaded', items, total, replace: true })
}

describe('matchesFilter', () => {
  it('matches every status for "all" and only its own otherwise', () => {
    expect(matchesFilter(notification({ status: 'resuelta' }), 'all')).toBe(true)
    expect(matchesFilter(notification({ status: 'resuelta' }), 'pendiente')).toBe(false)
    expect(matchesFilter(notification({ status: 'pendiente' }), 'pendiente')).toBe(true)
  })
})

describe('isNewer', () => {
  it('accepts anything over a missing row and equal timestamps (idempotent replays)', () => {
    expect(isNewer(notification(), undefined)).toBe(true)
    expect(isNewer(notification(), notification())).toBe(true)
  })

  it('rejects an older snapshot', () => {
    expect(isNewer(notification({ updated_at: at(1) }), notification({ updated_at: at(5) }))).toBe(false)
  })

  it('never lets a closed notification go back to pending', () => {
    const closed = notification({ status: 'resuelta', updated_at: at(1) })
    expect(isNewer(notification({ status: 'pendiente', updated_at: at(9) }), closed)).toBe(false)
  })
})

describe('inboxReducer', () => {
  it('replaces the list on a first page and dedupes appended pages', () => {
    const first = loaded('pendiente', [notification({ id: 'a' }), notification({ id: 'b' })], 3)
    expect(first.order).toEqual(['a', 'b'])
    expect(first.serverOffset).toBe(2)
    expect(selectHasMore(first)).toBe(true)

    const next = inboxReducer(first, {
      type: 'pageLoaded',
      items: [notification({ id: 'b' }), notification({ id: 'c' })],
      total: 3,
      replace: false,
    })
    expect(next.order).toEqual(['a', 'b', 'c'])
    expect(next.serverOffset).toBe(4)
  })

  it('inserts a new matching notification at the top and shifts the offset', () => {
    const state = loaded('pendiente', [notification({ id: 'old', created_at: at(1) })])
    const next = inboxReducer(state, { type: 'upserted', item: notification({ id: 'new', created_at: at(9) }) })
    expect(next.order).toEqual(['new', 'old'])
    expect(next.total).toBe(2)
    expect(next.serverOffset).toBe(2)
  })

  it('caches but does not list a notification outside the active filter', () => {
    const state = loaded('resuelta', [])
    const next = inboxReducer(state, { type: 'upserted', item: notification({ id: 'x' }) })
    expect(next.order).toEqual([])
    expect(next.byId.x).toBeDefined()
    expect(next.total).toBe(0)
  })

  it('removes a row that left the filter but keeps it readable in the cache', () => {
    const state = loaded('pendiente', [notification({ id: 'a', updated_at: at(1) })])
    const closed = notification({ id: 'a', status: 'resuelta', updated_at: at(5) })
    const next = inboxReducer(state, { type: 'upserted', item: closed })
    expect(next.order).toEqual([])
    expect(next.byId.a.status).toBe('resuelta')
    expect(next.total).toBe(0)
    expect(next.serverOffset).toBe(0)
  })

  it('ignores an out-of-order event', () => {
    const state = loaded('all', [notification({ id: 'a', status: 'resuelta', updated_at: at(5) })])
    const stale = notification({ id: 'a', status: 'pendiente', updated_at: at(1) })
    expect(inboxReducer(state, { type: 'upserted', item: stale })).toBe(state)
  })

  it('counts but does not show a row that sorts after the loaded window while pages remain', () => {
    const state = loaded('resuelta', [notification({ id: 'recent', status: 'resuelta', created_at: at(9) })], 5)
    const oldClosed = notification({ id: 'old', status: 'resuelta', created_at: at(1), updated_at: at(10) })
    const next = inboxReducer(state, { type: 'upserted', item: oldClosed })
    expect(next.order).toEqual(['recent'])
    expect(next.total).toBe(6)
    expect(next.serverOffset).toBe(1)
  })

  it('keeps the cache when the filter changes', () => {
    const state = loaded('pendiente', [notification({ id: 'a' })])
    const next = inboxReducer(state, { type: 'filterChanged', filter: 'resuelta' })
    expect(next.order).toEqual([])
    expect(next.filter).toBe('resuelta')
    expect(next.byId.a).toBeDefined()
  })

  it('does not list a row a live event closed while the page was in flight', () => {
    const live = inboxReducer(createInboxState('pendiente'), {
      type: 'upserted',
      item: notification({ id: 'a', status: 'resuelta', updated_at: at(9) }),
    })
    const next = inboxReducer(live, {
      type: 'pageLoaded',
      items: [notification({ id: 'a', updated_at: at(1) }), notification({ id: 'b' })],
      total: 2,
      replace: true,
    })
    expect(next.order).toEqual(['b'])
    expect(next.total).toBe(1)
    expect(next.serverOffset).toBe(1)
  })

  it('keeps a live-inserted row that a reload snapshot predates', () => {
    const state = loaded('pendiente', [notification({ id: 'old', created_at: at(1) })])
    const withLive = inboxReducer(state, { type: 'upserted', item: notification({ id: 'new', created_at: at(9) }) })
    const reloaded = inboxReducer(withLive, {
      type: 'pageLoaded',
      items: [notification({ id: 'old', created_at: at(1) })],
      total: 1,
      replace: true,
    })
    expect(reloaded.order).toEqual(['new', 'old'])
    expect(reloaded.total).toBe(2)
    expect(reloaded.liveIds).toEqual([])
  })

  it('drops a removed notification from list and cache', () => {
    const state = loaded('pendiente', [notification({ id: 'a' })])
    const next = inboxReducer(state, { type: 'removed', id: 'a' })
    expect(selectItems(next)).toEqual([])
    expect(next.byId.a).toBeUndefined()
    expect(next.total).toBe(0)
  })
})
