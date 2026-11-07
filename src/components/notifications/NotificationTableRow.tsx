import { memo } from 'react'
import { CheckCircle2, MessageSquare, XCircle } from 'lucide-react'
import type { AgentNotification, NotificationCloseStatus } from '../../types'
import { agentLabel, agentStyles } from '../../lib/agentLabels'
import {
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUS_STYLES,
  formatDateTime,
  formatRelative,
  notificationClientName,
} from '../../lib/notificationFormat'
import { CaseNumberTag } from '../shared/CaseNumberTag'
import { getNotificationType } from './types/registry'

export interface NotificationRowActions {
  onOpenConversation: (notification: AgentNotification) => void
  onRequestClose: (notification: AgentNotification, status: NotificationCloseStatus) => void
}

interface NotificationTableRowProps extends NotificationRowActions {
  notification: AgentNotification
  highlighted: boolean
  currentAdvisorId: string | null
}

// One compact line: "Abrir chat" (neutral), a divider, then the two decisions —
// Resolver solid green, Descartar a red outline — so they read as different
// kinds of action and a quick click can't land on the wrong one. Same height
// and width for every button keeps the column aligned row to row.
const BUTTON_BASE =
  'h-8 min-w-[96px] inline-flex items-center justify-center gap-1.5 px-3 rounded-control text-[11px] font-bold border transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90'
const CHAT_BUTTON = `${BUTTON_BASE} border-border-default bg-bg-main text-text-primary hover:border-brand-blue/60 hover:text-brand-blue`
const RESOLVE_BUTTON = `${BUTTON_BASE} border-success bg-success text-white hover:brightness-110 shadow-sm`
const DISCARD_BUTTON = `${BUTTON_BASE} border-error/40 bg-transparent text-error hover:bg-error/10 hover:border-error/60`
const ICON = 'w-3.5 h-3.5 shrink-0'

function NotificationTableRow({
  notification,
  highlighted,
  currentAdvisorId,
  onOpenConversation,
  onRequestClose,
}: NotificationTableRowProps) {
  const definition = getNotificationType(notification.type)
  const extraFiles = notification.attachments.length - 1
  const isPending = notification.status === 'pendiente'

  return (
    <tr
      id={`notification-row-${notification.id}`}
      className={['hover:bg-bg-tertiary/30 transition', highlighted ? 'message-focus-highlight' : ''].join(' ')}
    >
      <td className="p-4 whitespace-nowrap">
        <CaseNumberTag caseNumber={notification.conversation.case_number} className="text-xs" />
        {notification.conversation.status === 'cerrada' && (
          <span className="block text-[9px] text-text-secondary mt-0.5">Conversación cerrada</span>
        )}
      </td>

      <td className="p-4 whitespace-nowrap max-w-[180px]">
        <span className="block font-bold text-white truncate" title={notificationClientName(notification.client)}>
          {notificationClientName(notification.client)}
        </span>
        {notification.client.phone_number && (
          <span className="block text-[10px] text-text-secondary">{notification.client.phone_number}</span>
        )}
      </td>

      <td className="p-4 text-text-secondary whitespace-nowrap" title={formatDateTime(notification.created_at) ?? undefined}>
        {formatRelative(notification.created_at)}
      </td>

      <td className="p-4 min-w-[220px] max-w-[320px]">
        <span className="block font-semibold text-text-primary break-words">{definition.description}</span>
        {extraFiles > 0 && (
          <span className="block text-[10px] text-text-secondary">
            +{extraFiles} {extraFiles === 1 ? 'archivo más' : 'archivos más'}
          </span>
        )}
      </td>

      <td className="p-4 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${agentStyles(notification.agent)}`}>
          {agentLabel(notification.agent)}
        </span>
      </td>

      <td className="p-4 min-w-[160px] max-w-[240px] space-y-1">
        <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${NOTIFICATION_STATUS_STYLES[notification.status]}`}>
          {NOTIFICATION_STATUS_LABELS[notification.status]}
        </span>
        {!isPending && (
          <span className="block text-[10px] text-text-secondary" title={formatDateTime(notification.resolved_at) ?? undefined}>
            por{' '}
            {notification.resolved_by
              ? notification.resolved_by.id === currentAdvisorId
                ? 'ti'
                : notification.resolved_by.full_name
              : 'un asesor'}
          </span>
        )}
        {notification.resolution_note && (
          <span className="block text-[11px] text-text-primary break-words line-clamp-2" title={notification.resolution_note}>
            {notification.resolution_note}
          </span>
        )}
      </td>

      <td className="p-4 whitespace-nowrap">
        <div className="flex items-center gap-2" role="group" aria-label={`Acciones · ${notificationClientName(notification.client)}`}>
          <button
            type="button"
            onClick={() => onOpenConversation(notification)}
            className={CHAT_BUTTON}
            title="Abre el chat en el mensaje del archivo"
          >
            <MessageSquare className={ICON} aria-hidden="true" />
            Abrir chat
          </button>
          {isPending && (
            <>
              <span className="h-6 w-px bg-border-default" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onRequestClose(notification, 'resuelta')}
                className={RESOLVE_BUTTON}
                title="Ya quedó gestionada"
              >
                <CheckCircle2 className={ICON} aria-hidden="true" />
                Resolver
              </button>
              <button
                type="button"
                onClick={() => onRequestClose(notification, 'descartada')}
                className={DISCARD_BUTTON}
                title="No requiere acción o está duplicada"
              >
                <XCircle className={ICON} aria-hidden="true" />
                Descartar
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

export default memo(NotificationTableRow)
