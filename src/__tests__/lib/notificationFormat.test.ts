import { describe, it, expect } from 'vitest'
import {
  formatBadgeCount,
  formatRelative,
  notificationClientName,
  parseStatusFilter,
} from '../../lib/notificationFormat'
import { buildCloseNoteSchema, NOTE_MAX_LENGTH } from '../../lib/notificationNote'
import { buildChatUrl, buildNotificationsUrl } from '../../lib/notificationRoutes'
import { getNotificationType } from '../../components/notifications/types/registry'

describe('notificationFormat', () => {
  it('clamps future timestamps to "now" for relative time', () => {
    const now = new Date('2026-10-04T15:00:00Z')
    expect(formatRelative('2026-10-04T15:05:00Z', now)).toMatch(/segundos/)
    expect(formatRelative('not-a-date')).toBeNull()
  })

  it('falls back full_name → user_name → phone → generic label', () => {
    expect(notificationClientName({ id: '1', full_name: 'Ana', user_name: 'an', phone_number: '+57' })).toBe('Ana')
    expect(notificationClientName({ id: '1', full_name: null, user_name: 'an', phone_number: '+57' })).toBe('an')
    expect(notificationClientName({ id: '1', full_name: 'Cliente', user_name: null, phone_number: '+57' })).toBe('+57')
    expect(notificationClientName({ id: '1', full_name: null, user_name: null, phone_number: null })).toBe(
      'Cliente sin identificar',
    )
  })

  it('parses the status filter, defaulting to pendiente', () => {
    expect(parseStatusFilter('all')).toBe('all')
    expect(parseStatusFilter('bogus')).toBe('pendiente')
    expect(parseStatusFilter(null)).toBe('pendiente')
  })

  it('caps the badge at 99+', () => {
    expect(formatBadgeCount(7)).toBe('7')
    expect(formatBadgeCount(120)).toBe('99+')
  })
})

describe('buildCloseNoteSchema', () => {
  it('requires a note only when discarding', () => {
    expect(buildCloseNoteSchema('resuelta').safeParse('   ').success).toBe(true)
    expect(buildCloseNoteSchema('descartada').safeParse('   ').success).toBe(false)
    expect(buildCloseNoteSchema('descartada').safeParse(' duplicado ').data).toBe('duplicado')
  })

  it('rejects notes over the limit', () => {
    expect(buildCloseNoteSchema('resuelta').safeParse('x'.repeat(NOTE_MAX_LENGTH + 1)).success).toBe(false)
  })
})

describe('notification routes', () => {
  it('builds inbox and chat URLs', () => {
    expect(buildNotificationsUrl()).toBe('/notificaciones')
    expect(buildNotificationsUrl({ status: 'resuelta', id: 'n-1' })).toBe('/notificaciones?status=resuelta&id=n-1')
    expect(buildChatUrl('conv-1')).toBe('/chat/conv-1')
  })
})

describe('notification type registry', () => {
  it('falls back to a generic definition for unknown types', () => {
    expect(getNotificationType('comprobante_pago').description).toBe('Comprobante de pago enviado por el cliente')
    expect(getNotificationType('algo_nuevo').toastTitle).toBe('Nueva notificación')
    expect(getNotificationType('toString').toastTitle).toBe('Nueva notificación')
  })
})
