import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { clientsService } from "../services/clients";
import { useAbortableLoad } from "../hooks/useAbortableLoad";
import { EmailLink } from "../components/shared/EmailLink";
import type { ClientDirectoryEntry, ClientType, CommercialClassification } from "../types";

// The backend GET /clients endpoint only supports `q` — client_type and
// commercial_classification filters are applied client-side. Backend caps
// `limit` at 100 per page (docs/panel_api_reference.md), so a full directory
// larger than that is fetched across multiple pages — see fetchAllClients.
const BACKEND_PAGE_SIZE = 100;
const PAGE_SIZE = 20;

const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  arrendatario: "Arrendatario",
  propietario: "Propietario",
  prospecto: "Prospecto",
  desconocido: "Desconocido",
};

const CLIENT_TYPE_CHIP: Record<ClientType, string> = {
  arrendatario: "bg-brand-blue/10 text-brand-blue border border-brand-blue/20",
  propietario: "bg-success/10 text-success border border-success/20",
  prospecto: "bg-warning/10 text-warning border border-warning/20",
  desconocido: "bg-border-default text-text-secondary border border-border-default",
};

type ClientTypeFilter = "todos" | ClientType;
type ClassificationFilter = "todos" | CommercialClassification | "sin_clasificar";

function ClassificationBadge({
  classification,
}: {
  classification: ClientDirectoryEntry["commercial_classification"];
}) {
  if (classification === null) return <span className="text-text-secondary text-xs">No aplica</span>;

  if (classification === "potencial") {
    return (
      <span className="inline-block text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-success/15 text-success">
        Potencial
      </span>
    );
  }

  return (
    <span className="inline-block text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-error/15 text-error">
      No potencial
    </span>
  );
}

function TableSkeleton() {
  return (
    <div className="w-full bg-bg-secondary border border-border-default rounded-xl overflow-hidden animate-pulse">
      <div className="h-10 bg-bg-tertiary/60 border-b border-border-default" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 p-4 border-b border-border-default last:border-0">
          <div className="h-3 bg-bg-tertiary rounded w-32" />
          <div className="h-3 bg-bg-tertiary rounded w-24" />
          <div className="h-3 bg-bg-tertiary rounded w-24" />
          <div className="h-3 bg-bg-tertiary rounded w-20" />
          <div className="h-3 bg-bg-tertiary rounded w-20" />
        </div>
      ))}
    </div>
  );
}

async function fetchAllClients(q: string, signal?: AbortSignal): Promise<ClientDirectoryEntry[]> {
  const collected: ClientDirectoryEntry[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    // An aborted page rejects, which exits this loop — the remaining pages of a
    // directory nobody is looking at any more are never requested.
    const result = await clientsService.list({
      q: q || undefined,
      limit: BACKEND_PAGE_SIZE,
      offset,
    }, signal);

    collected.push(...result.clients);
    total = result.total;

    if (result.clients.length === 0) break;
    offset += result.clients.length;
  }

  return collected;
}

export default function ContactosPage() {
  // Cancels this page's reads on unmount and gates every write that follows one.
  const { getSignal, isMounted } = useAbortableLoad();
  const [clients, setClients] = useState<ClientDirectoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [typeFilter, setTypeFilter] = useState<ClientTypeFilter>("todos");
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>("todos");

  const [page, setPage] = useState(0);

  // Debounce: avoid firing a request on every keystroke
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);

    fetchAllClients(searchQuery, getSignal())
      .then((all) => {
        if (cancelled || !isMounted()) return;
        setClients(all);
      })
      .catch((err) => {
        if (cancelled || !isMounted() || axios.isCancel(err)) return;
        setClients([]);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled && isMounted()) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchQuery, retryToken, getSignal, isMounted]);

  // Reset to page 1 whenever the query or a filter changes
  useEffect(() => {
    setPage(0);
  }, [searchQuery, typeFilter, classificationFilter]);

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      if (typeFilter !== "todos" && client.client_type !== typeFilter) return false;

      if (classificationFilter === "sin_clasificar") {
        if (client.commercial_classification !== null) return false;
      } else if (classificationFilter !== "todos") {
        if (client.commercial_classification !== classificationFilter) return false;
      }

      return true;
    });
  }, [clients, typeFilter, classificationFilter]);

  const pagedClients = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredClients.slice(start, start + PAGE_SIZE);
  }, [filteredClients, page]);

  const total = filteredClients.length;
  const offset = page * PAGE_SIZE;
  const hasPrevPage = page > 0;
  const hasNextPage = offset + PAGE_SIZE < total;

  return (
    <section id="screen-contactos" className="flex-1 flex flex-col p-4 md:p-6 space-y-4">
      {/* ── Header ── */}
      <div className="w-full flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border-default pb-4">
        <div>
          <h2 className="text-h2 text-text-primary">Contactos</h2>
          <p className="text-xs text-text-secondary">
            Directorio de todos los clientes que han interactuado con el bot
          </p>
        </div>
      </div>

      {/* ── Search & filter panel ── */}
      <div className="w-full bg-bg-secondary p-4 border border-border-default rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-center">
        <div className="relative sm:col-span-2">
          <input
            id="contacts-search-input"
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre, teléfono, documento o correo..."
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
          id="contacts-filter-type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ClientTypeFilter)}
          className="w-full bg-bg-tertiary border border-border-default text-text-primary text-xs rounded-lg p-2 outline-none focus:border-brand-blue transition"
        >
          <option value="todos">Todos los Tipos</option>
          <option value="arrendatario">Arrendatario</option>
          <option value="propietario">Propietario</option>
          <option value="prospecto">Prospecto</option>
          <option value="desconocido">Desconocido</option>
        </select>

        <select
          id="contacts-filter-classification"
          value={classificationFilter}
          onChange={(e) => setClassificationFilter(e.target.value as ClassificationFilter)}
          className="w-full bg-bg-tertiary border border-border-default text-text-primary text-xs rounded-lg p-2 outline-none focus:border-brand-blue transition"
        >
          <option value="todos">Cualquier Clasificación</option>
          <option value="potencial">Potencial</option>
          <option value="no_potencial">No potencial</option>
          <option value="sin_clasificar">Sin clasificar</option>
        </select>
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <TableSkeleton />
      ) : loadError ? (
        <div className="w-full bg-bg-secondary border border-border-default rounded-xl py-12 flex flex-col items-center gap-3">
          <p className="text-text-secondary text-sm">No se pudo cargar el directorio de contactos.</p>
          <button
            type="button"
            onClick={() => setRetryToken((t) => t + 1)}
            className="bg-brand-blue hover:bg-brand-blue/90 text-white px-4 py-1.5 rounded-control text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="app-scroll w-full bg-bg-secondary border border-border-default rounded-xl overflow-x-auto">
          <table id="contacts-table" className="w-full text-left text-xs text-text-primary">
            <thead className="bg-bg-tertiary/60 border-b border-border-default text-text-secondary text-label uppercase">
              <tr>
                <th className="p-4 whitespace-nowrap">Nombre</th>
                <th className="p-4 whitespace-nowrap">Correo</th>
                <th className="p-4 whitespace-nowrap">Teléfono</th>
                <th className="p-4 whitespace-nowrap">Documento</th>
                <th className="p-4 whitespace-nowrap">Tipo de cliente</th>
                <th className="p-4 whitespace-nowrap">Clasificación comercial</th>
              </tr>
            </thead>
            <tbody id="contacts-table-body" className="divide-y divide-border-default">
              {pagedClients.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="text-center py-12">
                      <p className="text-text-secondary text-sm">
                        No se encontraron contactos
                        {searchQuery && ` para "${searchQuery}"`}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                pagedClients.map((client) => (
                  <tr key={client.id} className="hover:bg-bg-tertiary/30 transition">
                    <td className="p-4 whitespace-nowrap">
                      <p
                        className="font-bold text-white truncate max-w-[180px]"
                        title={client.full_name ?? "Sin identificar"}
                      >
                        {client.full_name ?? (
                          <span className="text-text-secondary font-medium italic">Sin identificar</span>
                        )}
                      </p>
                    </td>
                    <td className="p-4 text-text-secondary whitespace-nowrap">
                      {client.email ? (
                        <EmailLink email={client.email} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-4 text-text-secondary whitespace-nowrap">
                      {client.phone_number ?? (
                        <span className="italic">Sin teléfono</span>
                      )}
                    </td>
                    <td className="p-4 text-text-secondary whitespace-nowrap">
                      {client.document_id ?? "—"}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span
                        className={[
                          "text-[9px] px-2 py-0.5 rounded font-black uppercase",
                          CLIENT_TYPE_CHIP[client.client_type],
                        ].join(" ")}
                      >
                        {CLIENT_TYPE_LABEL[client.client_type]}
                      </span>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <ClassificationBadge classification={client.commercial_classification} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {!isLoading && !loadError && total > PAGE_SIZE && (
        <div className="w-full flex items-center justify-between text-xs text-text-secondary">
          <span>
            Mostrando {pagedClients.length === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!hasPrevPage}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="bg-bg-tertiary hover:bg-border-default border border-border-default text-text-primary px-3 py-1.5 rounded-control text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={!hasNextPage}
              onClick={() => setPage((p) => p + 1)}
              className="bg-bg-tertiary hover:bg-border-default border border-border-default text-text-primary px-3 py-1.5 rounded-control text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
