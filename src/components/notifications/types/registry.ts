// One entry per notification `type`. Adding a type = one entry here; the page,
// store and WebSocket stay untouched. Unknown types resolve to
// GENERIC_DEFINITION so a newer backend never breaks the panel.
//
// The panel deliberately shows only WHAT the notification is, never the data
// the agent read from it (amount, payment kind, reference…) nor the backend
// `title`, which embeds the amount: the advisor checks the real file in the
// conversation.
import { Bell, Receipt, type LucideIcon } from 'lucide-react'
import type { NotificationType } from '../../../types'

export interface NotificationTypeDefinition {
  icon: LucideIcon
  toastTitle: string
  /** What happened, without details, e.g. "Comprobante de pago enviado por el cliente". */
  description: string
}

const GENERIC_DEFINITION: NotificationTypeDefinition = {
  icon: Bell,
  toastTitle: 'Nueva notificación',
  description: 'Notificación del asistente de IA',
}

const NOTIFICATION_TYPES: Record<string, NotificationTypeDefinition> = {
  comprobante_pago: {
    icon: Receipt,
    toastTitle: 'Nuevo comprobante de pago',
    description: 'Comprobante de pago enviado por el cliente',
  },
}

export function getNotificationType(type: NotificationType): NotificationTypeDefinition {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type)
    ? NOTIFICATION_TYPES[type]
    : GENERIC_DEFINITION
}
