import type { Conversation } from "../../types";
import { useAuthStore } from "../../store/authStore";
import { agentLabel, agentStyles } from "../../lib/agentLabels";
import { EmailLink } from "../shared/EmailLink";

export type ChatVariant = "assigned" | "unassigned" | "bot" | "monitoring";

interface ClientPanelProps {
  conversation: Conversation;
  variant: ChatVariant;
  onTake: () => void;
  onReturnBot: () => void;
  isTaking: boolean;
  isReturning: boolean;
  isAdmin?: boolean;
  onClose?: () => void;
  onCloseConversation?: () => void;
  onTransfer?: () => void;
}

const CLIENT_TYPE_LABELS: Record<string, string> = {
  arrendatario: "Arrendatario",
  propietario: "Propietario",
  prospecto: "Prospecto",
  desconocido: "Sin clasificar",
};

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export default function ClientPanel({
  conversation,
  variant,
  onTake,
  onReturnBot,
  isTaking,
  isReturning,
  isAdmin = false,
  onClose,
  onCloseConversation,
  onTransfer,
}: ClientPanelProps) {
  const { client, escalation } = conversation;
  const currentAdvisor = useAuthStore((s) => s.advisor);

  // An `escalation` object is only ever included in the conversation payload
  // when it is unresolved (resolved_at IS NULL) — see docs/panel_api_reference.md.
  // Do not gate on `status === 'activa'`: the docs disagree on whether an
  // assigned conversation can still carry status 'escalada' (the "en_atención"
  // state). Whether it's actually assigned is `escalation.advisor` being set —
  // same source of truth ConversationCard.tsx already uses for the inbox.
  const showTransfer =
    conversation.bot_activo === false &&
    !!escalation?.advisor &&
    (escalation.advisor.id === currentAdvisor?.id || isAdmin);

  return (
    <aside
      id="chat-right-aside"
      className="app-scroll flex fixed lg:relative top-0 bottom-0 right-0 w-80 lg:w-[320px] bg-bg-secondary border-l border-border-default p-4 space-y-4 overflow-y-auto shrink-0 flex-col justify-between h-full lg:h-auto z-40"
    >
      <div className="space-y-4">
        {/* Mobile close */}
        <div className="lg:hidden flex justify-between items-center pb-2 border-b border-border-default">
          <span className="text-label text-text-primary uppercase">
            Ficha de Información
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-white p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 transition"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Client data card */}
        <div className="bg-bg-tertiary/40 border border-border-default rounded-xl overflow-hidden shadow-sm">
          <div className="flex flex-col items-center text-center px-4 pt-6 pb-5 bg-gradient-to-b from-brand-blue/10 to-transparent">
            <div className="w-16 h-16 rounded-full bg-brand-blue/15 border-2 border-brand-blue/40 text-brand-blue font-bold text-xl flex items-center justify-center shrink-0">
              {getInitials(client.full_name)}
            </div>
            <h4 className="mt-3 text-h3 text-text-primary leading-tight max-w-full truncate">
              {client.full_name ?? "Sin identificar"}
            </h4>
            <span
              className={`mt-2 text-label px-2.5 py-1 rounded-full uppercase ${agentStyles(conversation.agent)}`}
            >
              {agentLabel(conversation.agent)}
            </span>
          </div>

          <div className="divide-y divide-border-default/70 border-t border-border-default">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-border-default/60 flex items-center justify-center shrink-0">
                <svg
                  className="w-4 h-4 text-text-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
              </div>
              {/*
                phone_number is null for a contact who reached us through a
                WhatsApp username and has not shared their number. Falling back
                to user_name keeps a readable handle on screen instead of a
                blank field — the label switches so it is never mistaken for a
                dialable number.
              */}
              <div className="min-w-0">
                <p className="text-label text-text-secondary uppercase">
                  {client.phone_number ? "Celular" : "Usuario de WhatsApp"}
                </p>
                <p className="text-white font-mono text-xs truncate">
                  {client.phone_number || client.user_name || "No registrado"}
                </p>
              </div>
            </div>

            {/*
              Email is optional — only commercial prospects are asked for it.
              A client without one renders exactly as before: no row, no
              "No registrado" placeholder.
            */}
            {client.email && (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="w-8 h-8 rounded-lg bg-border-default/60 flex items-center justify-center shrink-0">
                  <svg
                    className="w-4 h-4 text-text-secondary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-label text-text-secondary uppercase">
                    Correo
                  </p>
                  <EmailLink
                    email={client.email}
                    className="text-white font-mono text-xs"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-border-default/60 flex items-center justify-center shrink-0">
                <svg
                  className="w-4 h-4 text-text-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-label text-text-secondary uppercase">
                  Documento
                </p>
                <p className="text-white font-mono text-xs truncate">
                  {client.document_id ?? "No registrada"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-8 h-8 rounded-lg bg-border-default/60 flex items-center justify-center shrink-0">
                <svg
                  className="w-4 h-4 text-text-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-label text-text-secondary uppercase">
                  Tipo de cliente
                </p>
                <p className="text-white font-medium text-xs truncate">
                  {CLIENT_TYPE_LABELS[client.client_type] ??
                    client.client_type ??
                    "Sin clasificar"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* AI escalation summary */}
        {escalation && (
          <div className="bg-error/[0.06] border border-error/40 rounded-xl p-3.5 space-y-2.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-error text-label uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
              <span>Análisis de escalado IA</span>
            </div>

            <div className="bg-bg-main p-2.5 rounded-lg border border-border-default">
              <p className="text-white/90 font-medium leading-relaxed text-[11.5px]">
                {escalation.summary ??
                  "El asesor ha tomado el control de la conversación, por lo que el resumen de escalado ya no está disponible."}
              </p>
            </div>

            {escalation.transfer_reason && (
              <div className="bg-brand-blue/10 border border-brand-blue/30 rounded-lg p-2.5">
                <p className="text-label text-brand-blue uppercase mb-1">
                  Motivo de transferencia
                </p>
                <p className="text-white/80 text-[11px] leading-relaxed">
                  {escalation.transfer_reason}
                </p>
              </div>
            )}

            <div className="flex justify-between text-[9px] text-text-secondary">
              <span>
                Escalado:{" "}
                <strong className="text-white font-semibold">
                  {new Date(escalation.escalated_at).toLocaleTimeString(
                    "es-CO",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </strong>
              </span>
              <span className="font-mono">
                ID: {escalation.id.slice(0, 8).toUpperCase()}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="space-y-2 mt-4 lg:mt-0">
        {variant === "unassigned" && !isAdmin && (
          <button
            type="button"
            onClick={onTake}
            disabled={isTaking}
            className="w-full bg-brand-blue hover:bg-brand-blue-hover text-white py-3 px-3 h-12 rounded-control text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
          >
            {isTaking ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            )}
            <span>Tomar Conversación</span>
          </button>
        )}

        {variant === "assigned" && (
          <>
            <button
              type="button"
              onClick={onReturnBot}
              disabled={isReturning}
              className="w-full bg-error/10 hover:bg-error/20 border border-error/30 hover:border-error text-error py-3 px-3 h-12 rounded-control text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              {isReturning ? (
                <div className="w-4 h-4 border-2 border-error border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              )}
              <span>Devolver al Bot</span>
            </button>
            <button
              type="button"
              onClick={onCloseConversation}
              className="w-full h-12 border border-error/20 text-error/60 text-xs font-semibold rounded-control hover:border-error/40 hover:text-error transition mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              Cerrar conversación
            </button>
          </>
        )}

        {showTransfer && (
          <button
            type="button"
            onClick={onTransfer}
            className="w-full h-12 border border-brand-blue/20 hover:border-brand-blue/40 hover:bg-brand-blue/10 text-brand-blue hover:text-white text-xs font-semibold rounded-control transition mt-2 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
          >
            <svg
              className="w-4.5 h-4.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
            <span>Transferir</span>
          </button>
        )}
      </div>
    </aside>
  );
}
