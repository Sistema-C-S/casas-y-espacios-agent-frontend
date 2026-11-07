import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  format,
  parseISO,
  isToday,
  isYesterday,
  isValid,
  startOfDay,
  subDays,
} from "date-fns";
import { conversationsService } from "../services/conversations";
import { useAbortableLoad } from "../hooks/useAbortableLoad";
import { CaseNumberTag } from "../components/shared/CaseNumberTag";
import { resolutionLabel } from "../constants/resolutions";
import { useToastStore } from "../store/toastStore";
import { getWhatsAppWindow, formatWindowCountdown } from "../lib/whatsappWindow";
import { useWebSocket } from "../hooks/useWebSocket";
import { buildChatUrl } from "../lib/notificationRoutes";
import { extractActiveConversation, notifyActiveConversation } from "../lib/reopenConflict";
import type { Conversation, ConversationIntent, WSConversationReopened } from "../types";

// ── Helpers ───────────────────────────────────────────────

// TODO: The backend has a known bug where closed_at can return null
// even if the conversation is closed. last_activity is used as the fallback.
function formatClosedDate(iso: string): string {
  const date = parseISO(iso);
  // format() throws RangeError on an unparseable date, and one bad row inside
  // the table body takes the whole page down with it — render a dash instead.
  if (!isValid(date)) return "—";
  if (isToday(date)) return `Hoy, ${format(date, "hh:mm aa")}`;
  if (isYesterday(date)) return `Ayer, ${format(date, "hh:mm aa")}`;
  return format(date, "dd/MM/yyyy");
}

// Sort key for the "Fecha de Cierre" column. Same source the column renders
// (closed_at with the last_activity fallback), so the visible order always
// matches the visible dates. Rows with a missing or unparseable date sink to
// the bottom instead of poisoning the comparator with NaN.
function closedTimestamp(conv: Conversation): number {
  const raw = conv.closed_at ?? conv.last_activity;
  if (!raw) return 0;
  const time = parseISO(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  // Under a minute, "0 min" tells the auditor nothing — show the seconds instead.
  if (seconds < 60) return `${seconds} seg`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours} h ${remainingMinutes} min`;
  const days = Math.floor(hours / 24);
  return `${days} día${days === 1 ? "" : "s"}`;
}

// Classifies the conversation's routing intent (conversaciones.intent) —
// distinct from ClientType (clients.client_type, shown in Contactos).
// Grouped by the specialty each intent routes to; see docs/panel_api_reference.md.
const INTENT_LABEL: Record<ConversationIntent, string> = {
  cartera: "Cartera",
  pagos: "Pagos",
  facturacion: "Facturación",
  disputa_cobro: "Disputa de Cobro",
  mantenimiento: "Mantenimiento",
  contratos: "Contratos",
  quejas_inmueble: "Quejas de Inmueble",
  comercial: "Comercial",
  faq: "FAQ",
  sin_clasificar: "Sin Clasificar",
};

const INTENT_CHIP: Record<ConversationIntent, string> = {
  cartera: "bg-brand-blue/10 text-brand-blue border border-brand-blue/20",
  pagos: "bg-brand-blue/10 text-brand-blue border border-brand-blue/20",
  facturacion: "bg-brand-blue/10 text-brand-blue border border-brand-blue/20",
  disputa_cobro: "bg-brand-blue/10 text-brand-blue border border-brand-blue/20",
  mantenimiento: "bg-warning/10 text-warning border border-warning/20",
  contratos: "bg-warning/10 text-warning border border-warning/20",
  quejas_inmueble: "bg-warning/10 text-warning border border-warning/20",
  comercial: "bg-success/10 text-success border border-success/20",
  faq: "bg-border-default text-text-secondary border border-border-default",
  sin_clasificar: "bg-error/10 text-error border border-error/20",
};

function IntentBadge({ intent }: { intent: ConversationIntent | null }) {
  if (intent === null) return <span className="text-text-secondary text-xs">—</span>;
  return (
    <span
      className={[
        "text-[9px] px-2 py-0.5 rounded font-black uppercase",
        INTENT_CHIP[intent],
      ].join(" ")}
    >
      {INTENT_LABEL[intent]}
    </span>
  );
}

// closed_by_advisor is null for bot closures and for historical
// closures that could not be backfilled — fall back to "Asesor".
function resolutorLabel(conv: Conversation): string | null {
  if (conv.closed_by === "bot") return "Bot";
  if (conv.closed_by === "asesor") {
    return conv.closed_by_advisor?.full_name ?? "Asesor";
  }
  return null;
}

// ── Skeleton ──────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="flex-1 min-h-0 w-full bg-bg-secondary border border-border-default rounded-xl overflow-hidden animate-pulse">
      <div className="h-10 bg-bg-tertiary/60 border-b border-border-default" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex gap-4 p-4 border-b border-border-default last:border-0"
        >
          <div className="h-3 bg-bg-tertiary rounded w-32" />
          <div className="h-3 bg-bg-tertiary rounded w-20" />
          <div className="h-3 bg-bg-tertiary rounded w-20" />
          <div className="h-3 bg-bg-tertiary rounded w-24" />
          <div className="h-3 bg-bg-tertiary rounded flex-1" />
          <div className="h-3 bg-bg-tertiary rounded w-24" />
          <div className="h-3 bg-bg-tertiary rounded w-14" />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────

export default function HistorialPage() {
  const navigate = useNavigate();
  // Cancels this page's reads on unmount and gates every write that follows one.
  const { getSignal, isMounted } = useAbortableLoad();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchText, setSearchText] = useState("");
  const [intentFilter, setIntentFilter] = useState<string>("todos");
  const [dateFilter, setDateFilter] = useState<string>("todos");

  const [reopeningIds, setReopeningIds] = useState<Record<string, boolean>>({});
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>(
    {},
  );

  // Ticks the "Reabrir" eligibility check against the wall clock, same 30s
  // cadence as useWhatsAppWindow — without this, a row computed once at mount
  // or the last filter change would keep showing an enabled button past the
  // real expiry until something else happened to force a re-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const toggleNote = (id: string) => {
    setExpandedNotes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Another advisor may have this history view open when a third one reopens a
  // conversation from her own chat/history — without this, that row would sit
  // here as "cerrada" even though it no longer is. Broadcast, not self-only.
  const onConversationReopened = useCallback((event: WSConversationReopened) => {
    setConversations((prev) => prev.filter((c) => c.id !== event.conversation_id));
  }, []);
  useWebSocket({ onConversationReopened });

  useEffect(() => {
    let cancelled = false;
    // GET /conversations caps `limit` server-side at 100 (le=100) — anything
    // above that 422s. That 422 was silently swallowed by the per-page catch
    // below, breaking the loop on page 0 with zero rows collected (incident:
    // "no hay conversaciones cerradas" right after this pagination shipped).
    const PAGE_SIZE = 100;
    // Hard cap so a wrong/stale `total` from the backend can never turn this
    // into a runaway loop — 80 pages already covers 8,000 closed
    // conversations, far beyond what this page needs to handle today.
    const MAX_PAGES = 80;

    async function loadAllClosed() {
      const all: Conversation[] = [];
      let offset = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        let result;
        try {
          result = await conversationsService.list({
            status: "cerrada",
            limit: PAGE_SIZE,
            offset,
          }, getSignal());
        } catch (err) {
          // Cancelled by unmount: stop paging and stay silent — there is no
          // table left to render into, and it is not a backend failure.
          if (axios.isCancel(err) || !isMounted()) return;
          // A later page failing (network blip, timeout) shouldn't discard
          // the pages already fetched — show what loaded so far instead of
          // silently emptying the whole table. Logged (not swallowed
          // entirely) so a request-shape bug like PAGE_SIZE exceeding the
          // backend's `limit` cap shows up in the console instead of just
          // rendering an empty table with no trace of why.
          console.error("HistorialPage: failed to load a page of closed conversations", err);
          break;
        }
        if (cancelled) return;

        all.push(...result.conversations);
        // Kept fewer than limit or already have everything the backend
        // reports — nothing left to page through.
        if (result.conversations.length < PAGE_SIZE || all.length >= result.total) {
          break;
        }
        offset += PAGE_SIZE;
      }

      if (!cancelled && isMounted()) setConversations(all);
    }

    loadAllClosed().finally(() => {
      if (!cancelled && isMounted()) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredConversations = useMemo(() => {
    return conversations
      .filter((conv) => {
        if (searchText) {
          const search = searchText.toLowerCase();
          const matchesName =
            conv.client.full_name?.toLowerCase().includes(search) ?? false;
          const matchesDoc =
            conv.client.document_id?.toLowerCase().includes(search) ?? false;
          const matchesEmail =
            conv.client.email?.toLowerCase().includes(search) ?? false;
          if (!matchesName && !matchesDoc && !matchesEmail) return false;
        }

        if (intentFilter !== "todos") {
          if (conv.intent !== intentFilter) return false;
        }

        if (dateFilter !== "todos") {
          const closedDateStr = conv.closed_at ?? conv.last_activity;
          const lastActivity = parseISO(closedDateStr);
          const today = startOfDay(new Date());
          if (dateFilter === "hoy") {
            if (!isToday(lastActivity)) return false;
          }
          if (dateFilter === "semana") {
            const sevenDaysAgo = subDays(today, 7);
            if (lastActivity < sevenDaysAgo) return false;
          }
        }

        return true;
      })
      // Newest closure first. Safe to sort in place: `filter` already handed
      // back a fresh array, so the `conversations` state is never mutated.
      .sort((a, b) => closedTimestamp(b) - closedTimestamp(a));
  }, [conversations, searchText, intentFilter, dateFilter]);

  function extractErrorCode(err: unknown): string | undefined {
    const e = err as { response?: { data?: { detail?: { code?: string } } } };
    return e.response?.data?.detail?.code;
  }

  function extractErrorMessage(err: unknown): string | undefined {
    const e = err as { response?: { data?: { detail?: { message?: string } } } };
    return e.response?.data?.detail?.message;
  }

  async function handleReopen(id: string) {
    setReopeningIds((prev) => ({ ...prev, [id]: true }));
    try {
      await conversationsService.reopen(id);
      // Reopened conversation is no longer "cerrada" — drop it from this view
      // instead of refetching; it now lives in the advisor's active inbox.
      setConversations((prev) => prev.filter((c) => c.id !== id));
      useToastStore.getState().showToast("Conversación reabierta.", "success");
      // Send the advisor straight into the chat she just reopened, so she can
      // write the first message without a second click to find the conversation.
      navigate(buildChatUrl(id));
    } catch (err: unknown) {
      const code = extractErrorCode(err);
      if (code === "CONTROL_ALREADY_TAKEN") {
        useToastStore.getState().showToast(
          extractErrorMessage(err) ?? "Otro asesor ya tiene el control de esta conversación.",
          "error",
        );
        setConversations((prev) => prev.filter((c) => c.id !== id));
      } else if (code === "CONVERSATION_NOT_CLOSED") {
        useToastStore.getState().showToast("Esta conversación ya no está cerrada.", "error");
        setConversations((prev) => prev.filter((c) => c.id !== id));
      } else if (code === "WINDOW_EXPIRED") {
        useToastStore.getState().showToast(
          extractErrorMessage(err) ?? "La ventana de WhatsApp ya venció — hay que usar un template.",
          "error",
        );
      } else if (code === "CONVERSATION_NOT_FOUND") {
        useToastStore.getState().showToast("Esta conversación ya no existe.", "error");
        setConversations((prev) => prev.filter((c) => c.id !== id));
      } else if (code === "CLIENT_HAS_ACTIVE_CONVERSATION") {
        // Backend guard (fix/reopen-blocks-duplicate-active-conversation): the
        // client already has another activa/escalada conversation. Reopening
        // this one too would create a second live conversation for the same
        // client+line — the router only ever routes an incoming message to
        // one of them (most recent by last_activity), so the other never
        // receives another message again. This conversation stays closed;
        // the advisor works the client from their existing active chat — so
        // when the backend names it, open it for her.
        const active = extractActiveConversation(err);
        if (active) {
          notifyActiveConversation(active);
          navigate(buildChatUrl(active.id));
        } else {
          useToastStore.getState().showToast(
            extractErrorMessage(err) ??
              "El cliente ya tiene una conversación activa — ábrala desde ahí en vez de reabrir esta.",
            "error",
          );
        }
      }
    } finally {
      setReopeningIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function exportExcel() {
    const rows = filteredConversations.map((conv) => {
      const closedDateStr = conv.closed_at ?? conv.last_activity;
      let formattedDate = "—";
      if (closedDateStr) {
        try {
          formattedDate = format(parseISO(closedDateStr), "dd/MM/yyyy HH:mm");
        } catch {
          formattedDate = "—";
        }
      }

      const resolutor = resolutorLabel(conv) ?? "—";

      let satisfaccion = "Sin confirmar";
      if (conv.client_satisfied === "si") satisfaccion = "Sí";
      if (conv.client_satisfied === "no") satisfaccion = "No";

      return {
        caseNumber: conv.case_number ?? "—",
        client: conv.client.full_name ?? "Sin identificar",
        document: conv.client.document_id ?? "—",
        // Empty (not "—") when missing: the email is optional and its absence is normal.
        email: conv.client.email ?? "",
        intent: conv.intent ? INTENT_LABEL[conv.intent] : "—",
        closedAt: formattedDate,
        duration: formatDuration(conv.duration_seconds),
        resolution: resolutionLabel(conv.resolution_type) ?? "—",
        notes: conv.resolution_notes ?? "Sin notas",
        resolutor,
        satisfaction: satisfaccion,
      };
    });

    // xlsx (SheetJS) was replaced with exceljs: the npm-published xlsx build
    // carries unpatched prototype-pollution and ReDoS advisories with no fix
    // available on the registry (2026-08 security audit finding F-03).
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Historial");
    worksheet.columns = [
      { header: "N° de Caso", key: "caseNumber", width: 14 },
      { header: "Cliente", key: "client", width: 24 },
      { header: "Cédula", key: "document", width: 14 },
      { header: "Correo", key: "email", width: 28 },
      { header: "Fecha de Cierre", key: "closedAt", width: 18 },
      { header: "Intención", key: "intent", width: 18 },
      { header: "Duración", key: "duration", width: 14 },
      { header: "Resolución", key: "resolution", width: 28 },
      { header: "Notas de resolución", key: "notes", width: 50 },
      { header: "Resolutor", key: "resolutor", width: 20 },
      { header: "Cliente satisfecho", key: "satisfaction", width: 16 },
    ];
    worksheet.addRows(rows);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `historial_${format(new Date(), "yyyyMMdd")}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      id="screen-historial"
      className="flex-1 min-h-0 flex flex-col p-4 md:p-6 space-y-4"
    >
      {/* ── Header ── */}
      <div className="shrink-0 w-full flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border-default pb-4">
        <div>
          <h2 className="text-h2 text-text-primary">
            Historial de Conversaciones Cerradas
          </h2>
          <p className="text-xs text-text-secondary">
            Busca, audita y analiza transcripciones de requerimientos
            finalizados
          </p>
        </div>
        <button
          type="button"
          onClick={exportExcel}
          className="bg-bg-tertiary hover:bg-border-default border border-border-default text-text-primary px-4 py-2.5 h-11 rounded-control text-xs font-semibold flex items-center gap-2 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
        >
          <svg
            className="w-4 h-4 text-success"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span>Exportar Excel</span>
        </button>
      </div>

      {/* ── Filter panel ── */}
      <div className="shrink-0 w-full bg-bg-secondary p-4 border border-border-default rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-center">
        <div className="relative sm:col-span-2">
          <input
            id="history-search-input"
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar por cliente, cédula o correo..."
            className="w-full bg-bg-tertiary border border-border-default text-text-primary text-xs rounded-lg pl-8 pr-3 py-2 outline-none focus:border-brand-blue transition"
          />
          <svg
            className="w-4 h-4 text-text-secondary absolute left-2.5 top-2.5 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <select
          id="history-filter-intent"
          value={intentFilter}
          onChange={(e) => setIntentFilter(e.target.value)}
          className="w-full bg-bg-tertiary border border-border-default text-text-primary text-xs rounded-lg p-2 outline-none focus:border-brand-blue transition"
        >
          <option value="todos">Todas las Intenciones</option>
          {(Object.keys(INTENT_LABEL) as ConversationIntent[]).map((intent) => (
            <option key={intent} value={intent}>
              {INTENT_LABEL[intent]}
            </option>
          ))}
        </select>

        <select
          id="history-filter-date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="w-full bg-bg-tertiary border border-border-default text-text-primary text-xs rounded-lg p-2 outline-none focus:border-brand-blue transition"
        >
          <option value="todos">Cualquier Fecha</option>
          <option value="hoy">Hoy</option>
          <option value="semana">Últimos 7 días</option>
        </select>
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <TableSkeleton />
      ) : (
        <div className="app-scroll flex-1 min-h-0 w-full bg-bg-secondary border border-border-default rounded-xl overflow-auto">
          <table
            id="history-table"
            className="w-full text-left text-xs text-text-primary"
          >
            {/* Sticky so the header stays put while rows scroll vertically
                inside this box — without it, the horizontal scrollbar for a
                wide table only reached the bottom of an unbounded-height
                container, forcing a full scroll-to-bottom just to see it. */}
            <thead className="sticky top-0 z-10 bg-bg-tertiary border-b border-border-default text-text-secondary text-label uppercase">
              <tr>
                <th className="p-4 whitespace-nowrap">N° de Caso</th>
                <th className="p-4 whitespace-nowrap">Cliente</th>
                <th className="p-4 whitespace-nowrap">Fecha de Cierre</th>
                <th className="p-4 whitespace-nowrap">Intención</th>
                <th className="p-4 whitespace-nowrap">Duración</th>
                <th className="p-4 whitespace-nowrap">Resolución</th>
                <th className="p-4 whitespace-nowrap">Resolutor</th>
                <th className="p-4 whitespace-nowrap text-center">
                  ¿El cliente está satisfecho?
                </th>
                <th className="p-4 text-center whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody
              id="history-table-body"
              className="divide-y divide-border-default"
            >
              {filteredConversations.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="text-center py-12">
                      <p className="text-text-secondary text-sm">
                        No se encontraron conversaciones cerradas
                        {searchText && ` para "${searchText}"`}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredConversations.map((conv) => (
                  <tr
                    key={conv.id}
                    className="hover:bg-bg-tertiary/30 transition"
                  >
                    <td className="p-4 whitespace-nowrap">
                      <CaseNumberTag caseNumber={conv.case_number} className="text-xs" />
                    </td>
                    <td
                      className="p-4 font-bold text-white whitespace-nowrap truncate max-w-[150px]"
                      title={conv.client.full_name ?? "Cliente no autenticado"}
                    >
                      {conv.client.full_name ?? (
                        <span className="text-text-secondary font-medium italic">
                          Sin identificar
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-text-secondary whitespace-nowrap">
                      {formatClosedDate(conv.closed_at ?? conv.last_activity)}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <IntentBadge intent={conv.intent} />
                    </td>
                    <td className="p-4 text-text-secondary whitespace-nowrap">
                      {formatDuration(conv.duration_seconds)}
                    </td>
                    <td className="p-4 max-w-[250px] min-w-[200px] space-y-1">
                      {resolutionLabel(conv.resolution_type) && (
                        <span
                          className={`inline-block text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                            conv.resolution_type === "ventana_vencida"
                              ? "bg-warning/15 text-warning"
                              : "bg-bg-tertiary text-text-secondary"
                          }`}
                        >
                          {resolutionLabel(conv.resolution_type)}
                        </span>
                      )}
                      {conv.resolution_notes ? (
                        <div
                          className="cursor-pointer text-xs text-text-primary hover:underline break-words"
                          title={conv.resolution_notes}
                          onClick={() => toggleNote(conv.id)}
                        >
                          {expandedNotes[conv.id]
                            ? conv.resolution_notes
                            : conv.resolution_notes.length > 60
                              ? conv.resolution_notes.slice(0, 60) + "..."
                              : conv.resolution_notes}
                        </div>
                      ) : (
                        // Block, not inline: `space-y-1` only separates block
                        // siblings, so an inline span sat on the same line as
                        // the resolution chip instead of under it.
                        <div className="text-xs text-text-secondary italic">
                          Sin notas
                        </div>
                      )}
                    </td>
                    <td className="p-4 font-bold whitespace-nowrap">
                      {conv.closed_by === "bot" ? (
                        <span className="text-success text-xs font-semibold">
                          Bot
                        </span>
                      ) : conv.closed_by === "asesor" ? (
                        <span
                          className="text-text-primary text-xs font-semibold truncate max-w-[140px] inline-block align-bottom"
                          title={resolutorLabel(conv) ?? undefined}
                        >
                          {resolutorLabel(conv)}
                        </span>
                      ) : (
                        <span className="text-text-secondary text-xs">—</span>
                      )}
                    </td>
                    <td className="p-4 text-center whitespace-nowrap">
                      {conv.client_satisfied === "si" ? (
                        <span className="inline-block text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-success/15 text-success">
                          Sí
                        </span>
                      ) : conv.client_satisfied === "no" ? (
                        <span className="inline-block text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-error/15 text-error">
                          No
                        </span>
                      ) : (
                        <span className="inline-block text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-border-default text-text-secondary">
                          Sin confirmar
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center whitespace-nowrap">
                      <div className="flex flex-col items-center justify-center gap-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/chat/${conv.id}`, {
                              state: { readonly: true },
                            })
                          }
                          className="text-brand-blue hover:underline font-bold px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 transition"
                        >
                          Auditar
                        </button>
                        {(() => {
                          // Fail-closed on purpose (opposite of the composer's
                          // fail-open): an unknown expiry means we can't confirm
                          // the window is alive, so the button stays disabled.
                          const win = getWhatsAppWindow(conv.whatsapp_window_expires_at, now);
                          const canReopen = win.state === "open" || win.state === "closing";
                          if (!canReopen) {
                            return (
                              <span
                                title={
                                  win.state === "unknown"
                                    ? "Ventana desconocida — no se puede reabrir sin template"
                                    : "Ventana vencida"
                                }
                                className="text-text-secondary/50 font-bold px-2 py-0.5 cursor-not-allowed select-none"
                              >
                                Reabrir
                              </span>
                            );
                          }
                          const isReopening = !!reopeningIds[conv.id];
                          return (
                            <button
                              type="button"
                              disabled={isReopening}
                              onClick={() => handleReopen(conv.id)}
                              title={
                                win.msLeft != null
                                  ? `Ventana vence en ${formatWindowCountdown(win.msLeft)}`
                                  : undefined
                              }
                              className="text-success hover:underline font-bold px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/90 transition disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {isReopening ? "Reabriendo…" : "Reabrir"}
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
