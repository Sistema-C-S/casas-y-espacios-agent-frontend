// Agent notifications — see docs/panel_api_reference.md § Agent Notifications.
// A notification is never an escalation: it never touches bot_activo, the
// assigned advisor or the advisor's quota.
import type { ConversationAgent, ConversationStatus } from "./index";

export type NotificationStatus = "pendiente" | "resuelta" | "descartada";
export type NotificationStatusFilter = NotificationStatus | "all";
export type NotificationCloseStatus = Exclude<NotificationStatus, "pendiente">;

// Kept open so a backend type the panel does not know yet still type-checks
// and falls back to the generic renderer instead of breaking the page.
export type NotificationType = "comprobante_pago" | (string & {});

/**
 * The message that carries one of the notification's files — "Abrir chat"
 * jumps to it, where the advisor sees the real file. Nothing the vision model
 * read from it is stored.
 */
export interface NotificationAttachment {
  wam_id: string;
}

export interface NotificationClient {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  user_name: string | null;
}

export interface NotificationConversation {
  id: string;
  case_number: string | null;
  /** Null when the backend could not join the conversation. */
  status: ConversationStatus | null;
}

export interface NotificationResolver {
  id: string;
  full_name: string;
}

export interface AgentNotification {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  title: string;
  agent: ConversationAgent;
  client: NotificationClient;
  conversation: NotificationConversation;
  /** Type-specific data; always `{}` for `comprobante_pago`. */
  payload: Record<string, unknown>;
  attachments: NotificationAttachment[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: NotificationResolver | null;
  resolution_note: string | null;
}

export interface NotificationListParams {
  status?: NotificationStatusFilter;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

export interface NotificationList {
  notifications: AgentNotification[];
  total: number;
  limit: number;
  offset: number;
  /** Always the global pending count, whatever the filters. */
  pending_count: number;
}

export interface CloseNotificationBody {
  status: NotificationCloseStatus;
  note?: string;
}

/** Payload of both `notification.new` and `notification.updated`. */
export interface WSNotificationEvent {
  notification: AgentNotification;
  pending_count: number;
}
