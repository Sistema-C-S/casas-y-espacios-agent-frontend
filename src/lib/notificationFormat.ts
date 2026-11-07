// Display helpers for agent notifications. Pure functions — no React, no stores.
import { format, formatDistanceStrict, isValid, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { NotificationClient, NotificationStatus, NotificationStatusFilter } from '../types'
import { clientDisplayName } from './clientName'

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pendiente: 'Pendiente',
  resuelta: 'Resuelta',
  descartada: 'Descartada',
}

export const NOTIFICATION_STATUS_STYLES: Record<NotificationStatus, string> = {
  pendiente: 'bg-warning/15 text-warning',
  resuelta: 'bg-success/15 text-success',
  descartada: 'bg-text-secondary/15 text-text-secondary',
}

export const NOTIFICATION_FILTERS: readonly NotificationStatusFilter[] = [
  'pendiente',
  'resuelta',
  'descartada',
  'all',
] as const

export const NOTIFICATION_FILTER_LABELS: Record<NotificationStatusFilter, string> = {
  pendiente: 'Pendientes',
  resuelta: 'Resueltas',
  descartada: 'Descartadas',
  all: 'Todas',
}

export function parseStatusFilter(value: string | null): NotificationStatusFilter {
  return NOTIFICATION_FILTERS.includes(value as NotificationStatusFilter)
    ? (value as NotificationStatusFilter)
    : 'pendiente'
}

/** "hace 12 minutos" for ISO-8601 UTC timestamps. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const date = parseISO(iso)
  if (!isValid(date)) return null
  // Clock skew can put a fresh server timestamp slightly in the future.
  const safe = date > now ? now : date
  return formatDistanceStrict(safe, now, { addSuffix: true, locale: es })
}

/** "4 oct 2026, 10:02" in the viewer's local time. */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = parseISO(iso)
  return isValid(date) ? format(date, "d MMM yyyy, HH:mm", { locale: es }) : null
}

/** full_name → user_name → phone_number → generic label. */
export function notificationClientName(client: NotificationClient | null | undefined): string {
  return (
    clientDisplayName(client?.full_name) ??
    clientDisplayName(client?.user_name) ??
    client?.phone_number ??
    'Cliente sin identificar'
  )
}

export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}
