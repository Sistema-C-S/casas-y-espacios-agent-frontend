// Tipos TypeScript del proyecto.
// Deben coincidir con los schemas del backend (app/api/v1/panel/schemas.py).
// Nunca definir tipos inline en componentes o hooks.

// ── ROLES Y ESTADOS ───────────────────────────────────────

export type AdvisorRole = "asesor" | "admin";
export type AdvisorArea = "administrativa" | "comercial" | "ambas";
export type AvailabilityStatus = "available" | "break" | "offline";
export type ConversationStatus = "activa" | "escalada" | "cerrada";
// The bot agent that owns the conversation (two agents behind one WhatsApp
// number — see CLAUDE.md §3.46 in the backend repo). Distinct from `channel`
// (the WhatsApp line's channel, always "administrativa" today), which the
// panel no longer uses to label a conversation. Use lib/agentLabels.ts to
// resolve/display it — it falls back to "administrative" when missing.
export type ConversationAgent = "administrative" | "commercial";
export type ConversationPriority = "baja" | "media" | "alta" | "critica";
export type MessageDirection = "inbound" | "outbound_bot" | "outbound_advisor";
export type MessageType = "text" | "image" | "video" | "document" | "audio";
export type AlertSeverity = "baja" | "media" | "alta";
export type AlertType =
  | "lenguaje_inapropiado"
  | "tono_agresivo"
  | "comportamiento_inadecuado";
export type ClientType =
  | "arrendatario"
  | "propietario"
  | "prospecto"
  | "desconocido";
// Classifies the conversation (routing), not the client — do not confuse
// with ClientType. See docs/panel_api_reference.md § ConversationIntent.
export type ConversationIntent =
  | "cartera"
  | "pagos"
  | "facturacion"
  | "disputa_cobro"
  | "mantenimiento"
  | "contratos"
  | "quejas_inmueble"
  | "comercial"
  | "faq"
  | "sin_clasificar";
export type WSStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

// ── MODELOS DE DOMINIO ────────────────────────────────────

export interface Advisor {
  id: string;
  email: string;
  full_name: string;
  role: AdvisorRole;
  area: AdvisorArea;
  specialty?: string | null;
  max_conversations: number;
  active_conversations: number;
  availability_status: AvailabilityStatus;
  status_until?: string | null;
  is_active: boolean;
  avatar_url: string | null;
  must_change_password: boolean;
}

export interface Client {
  id: string;
  /**
   * Null when the contact reached us through a WhatsApp username and has not
   * shared their number. A client always has at least one of phone_number /
   * bsuid, but either may be null — never assume this one is present.
   */
  phone_number: string | null;
  /**
   * Business-Scoped User ID — opaque per-business identifier, present when the
   * contact reached us through a WhatsApp username. Display-only: it is not a
   * phone number, is not dialable, and must never be used to build a `tel:` or
   * `wa.me` link.
   */
  bsuid: string | null;
  /**
   * Contact's public WhatsApp username handle. Null when Meta has not sent
   * a username for this contact (the common case). Not an identifier — never
   * used to look up or send to a client, only as a display label.
   */
  user_name: string | null;
  full_name: string | null;
  document_id: string | null;
  /** Correo que dio el prospecto comercial; null si no lo dio. Opcional: no mostrar si falta. */
  email?: string | null;
  client_type: ClientType;
}

export type CommercialClassification = "potencial" | "no_potencial";

export interface ClientDirectoryEntry {
  id: string;
  phone_number: string | null;
  bsuid: string | null;
  document_id: string | null;
  full_name: string | null;
  /** Optional — null when the client never gave one. Only render when present. */
  email?: string | null;
  client_type: ClientType;
  is_authenticated: boolean;
  created_at: string;
  /**
   * Null unless the client has at least one classified commercial
   * conversation (intent = "comercial"). When multiple exist, this is the
   * classification from the most recent one — see docs/panel_api_reference.md.
   */
  commercial_classification: CommercialClassification | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  wam_id: string | null;
  direction: MessageDirection;
  msg_type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  transcription: string | null;
  delivered_via: string;
  timestamp: string;
  created_at: string;
  advisor_name: string | null;
  // Optimistic-UI-only fields — populated locally by ChatInput/AudioRecorder
  // before the server confirms the message; never present in API responses.
  _localId?: string;
  _status?: "sending" | "failed";
  _fileName?: string;
}

// Only the fields every escalation.advisor payload actually carries (detail,
// list, and every WS event) — never the full Advisor shape (email, role,
// max_conversations, etc.), which the backend never sends on this field.
export interface EscalationAdvisorRef {
  id: string;
  full_name: string;
}

export interface Escalation {
  id: string;
  reason: string;
  summary: string | null;
  escalated_at: string;
  advisor: EscalationAdvisorRef | null;
  wait_seconds?: number | null;
  transfer_reason?: string | null;
}

export interface ClosedByAdvisor {
  id: string;
  full_name: string;
}

export interface ConversationLastMessage {
  msg_type: "text" | "audio" | "image" | "video" | "document";
  content: string | null;
}

export interface Conversation {
  id: string;
  status: ConversationStatus;
  bot_activo: boolean;
  has_escalation_history: boolean;
  channel: string;
  /**
   * The bot agent that owns this conversation. Optional/absent on payloads
   * that predate the dual-agent rollout — resolve with
   * lib/agentLabels.ts's resolveAgent()/agentLabel(), which falls back to
   * "administrative" rather than assuming the field is always present.
   */
  agent?: ConversationAgent;
  last_activity: string;
  intent: ConversationIntent | null;
  client: Client;
  escalation: Escalation | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  client_satisfied: "si" | "no" | "sin_confirmar" | null;
  closed_by: "asesor" | "bot" | null;
  // null for bot closures and for historical closures that could not be backfilled
  closed_by_advisor: ClosedByAdvisor | null;
  closed_at: string | null;
  // seconds between the conversation's start and closed_at; null while the conversation is still open
  duration_seconds: number | null;
  last_message: ConversationLastMessage | null;
  /**
   * When Meta's 24-hour customer service window closes, ISO-8601 UTC — or null,
   * which means UNKNOWN, never expired (conversations predating the feature, and
   * any conversation with no inbound message yet). Only sent by the two
   * endpoints that serve a full conversation: GET /conversations and
   * GET /conversations/{id}. Derive state with lib/whatsappWindow.ts — never
   * from last_activity, which advisor/bot replies also move.
   */
  whatsapp_window_expires_at: string | null;
  unread_count: number;
  priority: ConversationPriority | null;
  // null for conversations created before this field was deployed
  case_number: string | null;
}

export interface BehaviorAlert {
  id: string;
  advisor: Advisor;
  conversation_id: string;
  message_content: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  detected_at: string;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface AdvisorSchedule {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  is_active: boolean;
}

export interface DashboardMetrics {
  activas: number;
  escaladas: number;
  en_atencion: number;
  tiempo_promedio_min: number;
  bot_ok_pct: number;
  capacidad_actual: number;
  capacidad_total: number;
}

export interface AdvisorOnline {
  id: string;
  full_name: string;
  availability_status: "available" | "break" | "offline";
  area: string;
  is_panel_connected: boolean;
  // Admin-only fields:
  active_conversations?: number;
  max_conversations?: number;
}

// ── API RESPONSES ─────────────────────────────────────────
// Todos los endpoints devuelven {"data": {...}}

export interface PaginatedConversations {
  conversations: Conversation[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedMessages {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedAlerts {
  alerts: BehaviorAlert[];
  total: number;
}

export interface PaginatedClients {
  clients: ClientDirectoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ── WEBSOCKET EVENTS ──────────────────────────────────────

export interface WSEvent<T = unknown> {
  event: string;
  data: T;
}

export interface WSEscalationNew {
  conversation_id: string;
  advisor_id: string | null;
  reason: string | null;
  channel: string;
}

// Emitted once when a brand-new conversation is created (bot-handled, not
// escalated yet) — bandeja list-view refresh only, never a sound.
export interface WSConversationNew {
  conversation_id: string;
  channel: string;
  agent?: ConversationAgent;
}

export interface WSMessageNew {
  message: Message;
  conversation_id?: string;
  unread_count?: number;
  /**
   * Meta's 24h window as it stands AFTER this message — every inbound message
   * resets the clock, so the payload carries the fresh expiry and the panel
   * never has to refetch the conversation to stay correct (same reasoning as
   * `conversation_priority`). `null` means the backend could not resolve it,
   * which is UNKNOWN, never expired: keep whatever is already cached rather
   * than regressing a good countdown to unknown.
   */
  whatsapp_window_expires_at?: string | null;
  /**
   * The conversation's owning agent as it stands after this message — an
   * onboarding handoff can reassign a conversation's agent in place mid-turn,
   * so the inbox card's label updates live from this field when present
   * instead of waiting for a reload.
   */
  conversation_agent?: ConversationAgent | null;
}

export interface WSAdvisorConnected {
  advisor_id: string;
  advisor_name: string;
  advisor_role: string;
  advisor_area: string;
}

export interface WSAdvisorDisconnected {
  advisor_id: string;
  advisor_name: string;
}

export interface WSAdvisorStatusChanged {
  advisor_id: string;
  availability_status: AvailabilityStatus;
  full_name: string;
  area: string;
  specialty: string | null;
}

export interface WSEscalationAssigned {
  conversation_id: string;
  escalation_id: string;
  advisor_id: string;
  advisor_name: string;
}

export interface WSConversationReturned {
  conversation_id: string;
  advisor_id: string;
  advisor_name: string;
}

// Emitted only on a real take-control (PW-24) — never on the idempotent
// "you already had it" path.
export interface WSConversationControlTaken {
  conversation_id: string;
  escalation_id: string;
  advisor_id: string;
  advisor_name: string;
}

// Broadcast to every connected advisor (not just the one who reopened) so a
// stale "cerrada" row in someone else's history view disappears in real time.
export interface WSConversationReopened {
  conversation_id: string;
  escalation_id: string;
  advisor_id: string;
  advisor_name: string;
}

export interface WSConversationClosed {
  conversation_id: string;
  closed_by: "asesor" | "bot";
  advisor_id?: string;
  advisor_name?: string;
  resolution_type?: string;
  closed_at?: string;
  reason?: string;
}

export interface WSQueuePending {
  count: number;
  message: string;
}

// Server reply to a subscribe_conversation it did not honor. FORBIDDEN is final
// (no access); UNAVAILABLE means the access check itself failed — retry.
export interface WSSubscribeError {
  code: "FORBIDDEN" | "UNAVAILABLE";
  conversation_id?: string;
}

export interface WSBehaviorAlertEvent {
  alert_id: string;
}

export interface WSTransferAdvisorRef {
  id: string;
  full_name: string;
}

export interface WSConversationTransferred {
  conversation_id: string;
  case_number: string;
  from_advisor: WSTransferAdvisorRef | null;
  to_advisor: WSTransferAdvisorRef;
  reason: string | null;
}

export interface WSConversationPriorityUpdated {
  conversation_id: string;
  priority: ConversationPriority;
  updated_by: "bot";
}

// Emitted after a video/document/image/audio message's media_url is backfilled
// from the raw Meta media_id to a real Storage URL — happens after message.new
// already delivered the original row, since the media must be persisted before
// the download even starts. Lets an already-open chat fix the bubble live
// instead of only after a reload.
export interface WSMessageMediaUpdated {
  conversation_id: string;
  wam_id: string;
  media_url: string;
  media_mime_type: string | null;
}

export * from "./notifications";
