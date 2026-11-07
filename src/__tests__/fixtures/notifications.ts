import type { AgentNotification, NotificationAttachment } from '../../types'

export function attachment(overrides: Partial<NotificationAttachment> = {}): NotificationAttachment {
  return {
    wam_id: 'wamid.ATTACH1',
    ...overrides,
  }
}

export function notification(overrides: Partial<AgentNotification> = {}): AgentNotification {
  return {
    id: 'notif-1',
    type: 'comprobante_pago',
    status: 'pendiente',
    title: 'Comprobante de pago',
    agent: 'administrative',
    client: { id: 'cli-1', full_name: 'Juan Pérez', phone_number: '+573001112233', user_name: 'Juan' },
    conversation: { id: 'conv-1', case_number: 'CE-123', status: 'activa' },
    payload: {},
    attachments: [attachment()],
    created_at: '2026-10-04T15:02:11.456789+00:00',
    updated_at: '2026-10-04T15:02:11.456789+00:00',
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    ...overrides,
  }
}
