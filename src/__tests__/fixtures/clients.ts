import type { Client, ClientDirectoryEntry, Conversation } from '../../types'

// Two shapes on purpose: a commercial prospect who gave an email, and an
// administrative client who never did (the common case). `email` is optional
// on the wire — the "without" fixture carries an explicit null, which is what
// the backend sends.
export const PROSPECT_EMAIL = 'laura.gomez@example.com'

export function clientWithEmail(overrides: Partial<Client> = {}): Client {
  return {
    id: 'cli-email',
    phone_number: '+573001112233',
    bsuid: null,
    user_name: null,
    full_name: 'Laura Gómez',
    document_id: null,
    email: PROSPECT_EMAIL,
    client_type: 'prospecto',
    ...overrides,
  }
}

export function clientWithoutEmail(overrides: Partial<Client> = {}): Client {
  return {
    id: 'cli-no-email',
    phone_number: '+573004445566',
    bsuid: null,
    user_name: null,
    full_name: 'Carlos Rodríguez',
    document_id: '1020304050',
    email: null,
    client_type: 'propietario',
    ...overrides,
  }
}

export function directoryEntry(
  client: Client,
  overrides: Partial<ClientDirectoryEntry> = {},
): ClientDirectoryEntry {
  return {
    id: client.id,
    phone_number: client.phone_number,
    bsuid: client.bsuid,
    document_id: client.document_id,
    full_name: client.full_name,
    email: client.email,
    client_type: client.client_type,
    is_authenticated: false,
    created_at: '2026-10-01T10:00:00+00:00',
    commercial_classification: null,
    ...overrides,
  }
}

export function conversationFor(
  client: Client,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: `conv-${client.id}`,
    status: 'cerrada',
    bot_activo: true,
    has_escalation_history: false,
    channel: 'administrativa',
    agent: 'administrative',
    last_activity: '2026-10-01T10:00:00+00:00',
    intent: null,
    client,
    escalation: null,
    resolution_type: 'otro',
    resolution_notes: null,
    client_satisfied: 'sin_confirmar',
    closed_by: 'bot',
    closed_by_advisor: null,
    closed_at: '2026-10-01T10:00:00+00:00',
    duration_seconds: 120,
    last_message: null,
    whatsapp_window_expires_at: null,
    unread_count: 0,
    priority: 'baja',
    case_number: `CE-${client.id}`,
    ...overrides,
  }
}
