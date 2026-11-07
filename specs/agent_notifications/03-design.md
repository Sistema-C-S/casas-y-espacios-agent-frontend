# Design: Notificaciones del Agente

> **Revisión durante la implementación (Q16–Q18 de `02-clarification.md`).** La página es una **tabla tipo Historial**, sin panel de detalle. Lo que sigue en este documento sobre `NotificationDetail`, `ConversationContextCard`, `AttachmentList`, `PaymentReceiptDetail`, layout lista/detalle y `?id=` como selección queda **reemplazado** por la sección "Revisión: tabla con acciones por fila" al final. El resto (store, reducer, WebSocket, servicio, deep link al chat, manejo de errores) sigue vigente.

Inputs: `01-spec.md`, `02-clarification.md`, `docs/panel_api_reference.md` (§ Agent Notifications, eventos `notification.new` / `notification.updated`), `CLAUDE.md` §15–17.

## Overview

Nueva página `/notificaciones` (ambos roles) que funciona como **bandeja de trabajo** de las notificaciones que registra el agente, con el comprobante de pago como primer tipo. El diseño separa cuatro responsabilidades con dueños claros:

1. **Estado global mínimo** (`notificationsStore`): solo lo que debe vivir fuera de la página: el conteo de pendientes para el badge y la última notificación entrante para el toast.
2. **Estado de la bandeja** (página): lista, filtro, paginación y selección. Es un reducer puro y testeable dentro de un hook de página. No es global, porque solo la página lo necesita y al montar siempre refetchea.
3. **Tiempo real**: el socket singleton existente. El `switch` de `useWebSocket` maneja el badge, el toast y el sonido de forma global (esté o no montada la página), y además reenvía el evento a la página por el registro `WSHandlers`, igual que el resto de eventos.
4. **Presentación por tipo**: un **registro de tipos** (`notificationTypes`) define label, ícono, resumen y renderer de detalle por `type`. Agregar un tipo nuevo es una entrada en el registro más un componente, sin tocar la página, el store ni el socket. Un tipo desconocido cae en un renderer genérico basado en `title`, nunca rompe la UI.

La validación contra la conversación se resuelve con un **deep link al mensaje exacto**: cada adjunto trae `wam_id` y el chat lo busca, hace scroll y lo resalta. Al chat se le pasa el contexto de vuelta para regresar a la notificación.

La URL es la fuente de verdad de lo que se ve: `?status=` (pestaña) y `?id=` (seleccionada). Así se puede refrescar, el toast y el banner de vuelta enlazan directo, y mobile resuelve lista/detalle sin estado extra.

## Components

### New / Modified Files

| File | Role | Change type |
|------|------|-------------|
| `src/types/notifications.ts` | Tipos del dominio (item, payload, attachment, filtros, respuestas, eventos WS) | Create |
| `src/types/index.ts` | Re-export de `./notifications` | Modify |
| `src/services/notifications.ts` | `notificationsService`: `list`, `getById`, `close` sobre `apiClient` | Create |
| `src/services/index.ts` | Re-export del servicio | Modify |
| `src/store/notificationsStore.ts` | `pendingCount`, `incoming` (último entrante, para toast), `reset` | Create |
| `src/store/authStore.ts` | `clearSession`/`reset` también resetean `notificationsStore` | Modify |
| `src/lib/axios.ts` | Agregar `NOTIFICATION_ALREADY_CLOSED`, `NOTIFICATION_NOT_FOUND` a `LOCAL_ERROR_CODES` | Modify |
| `src/lib/notificationFormat.ts` | Formatters puros: COP, fecha de pago (local, sin UTC shift), antigüedad relativa, nombre de cliente, labels de `payment_kind`/estado/agente | Create |
| `src/lib/notificationInbox.ts` | Reducer puro de la bandeja + selectores (`inboxReducer`, `matchesFilter`, `isNewer`) | Create |
| `src/lib/safeUrl.ts` | `isSafeHttpsUrl(url)`: solo `https:` se renderiza como `src`/`href` | Create |
| `src/hooks/useWebSocket.ts` | Cases `notification.new`/`notification.updated` + `onNotificationNew`/`onNotificationUpdated` en `WSHandlers` | Modify |
| `src/hooks/useNotificationsBadgeSync.ts` | Carga inicial de `pendingCount` (`limit=1`) + refetch en `ws:reconnected` | Create |
| `src/hooks/useNotificationsInbox.ts` | Hook de página: fetch, paginación, reducer, WS handlers, cierre, refetch al reconectar | Create |
| `src/hooks/useFocusMessage.ts` | En ChatPage: buscar `wam_id`, paginar hacia atrás (tope), scroll + highlight | Create |
| `src/constants/routes.ts` | `NOTIFICACIONES: '/notificaciones'` | Modify |
| `src/App.tsx` | Ruta dentro de `<ProtectedRoute />` (sin `requiredRole`) | Modify |
| `src/components/layout/ProtectedRoute.tsx` | Montar `useNotificationsBadgeSync()` y `<NotificationToast />`; título mobile "Notificaciones" | Modify |
| `src/components/layout/Sidebar.tsx` | `NavItem` "Notificaciones" (campana) bajo Bandeja, `badge={pendingCount}` | Modify |
| `src/pages/NotificationsPage.tsx` | Página: layout lista/detalle, pestañas, estados vacío/error/carga | Create |
| `src/components/notifications/NotificationTabs.tsx` | Pestañas de estado (con conteo de pendientes) | Create |
| `src/components/notifications/NotificationList.tsx` | Lista + "Cargar más" | Create |
| `src/components/notifications/NotificationRow.tsx` | Fila compacta (memo) | Create |
| `src/components/notifications/NotificationDetail.tsx` | Shell del detalle: header de conversación, renderer por tipo, adjuntos, acciones, estado de cierre | Create |
| `src/components/notifications/ConversationContextCard.tsx` | Caso, cliente, teléfono, agente, estado de la conversación + "Abrir conversación" | Create |
| `src/components/notifications/AttachmentList.tsx` | Adjuntos: miniatura / PDF / no disponible + "Ver en la conversación" | Create |
| `src/components/notifications/CloseNotificationDialog.tsx` | Diálogo resolver/descartar con nota (zod) | Create |
| `src/components/notifications/types/registry.ts` | `notificationTypes` + `getNotificationType(type)` con fallback | Create |
| `src/components/notifications/types/PaymentReceiptDetail.tsx` | Renderer de `comprobante_pago` (resumen del pago, lectura automática) | Create |
| `src/components/notifications/types/GenericNotificationDetail.tsx` | Fallback para tipos desconocidos | Create |
| `src/components/shared/NotificationToast.tsx` | Toast "Nuevo comprobante de pago · <cliente>" + "Ver"; se suprime en `/notificaciones` | Create |
| `src/components/shared/ImageLightbox.tsx` | Extraído de `MessageBubble.tsx` (hoy privado) para reusarlo | Create |
| `src/components/chat/MessageBubble.tsx` | Importa `ImageLightbox` compartido (sin cambio de comportamiento) | Modify |
| `src/components/chat/MessageFeed.tsx` | `data-wam-id` en el wrapper de cada mensaje + clase de highlight | Modify |
| `src/pages/ChatPage.tsx` | Leer `location.state.fromNotification`/`focusWamId`; usar `useFocusMessage`; banner de vuelta | Modify |
| `src/index.css` | Clase `.message-focus-highlight` (transición de background, sin animación infinita) | Modify |
| `src/__tests__/...` | Tests (ver § Testing) | Create |

### Key Abstractions

**`types/notifications.ts`**
```ts
type NotificationStatus = 'pendiente' | 'resuelta' | 'descartada'
type NotificationStatusFilter = NotificationStatus | 'all'
type NotificationType = 'comprobante_pago' | (string & {})   // open for future types
type PaymentKind = 'canon' | 'administracion' | 'servicios_publicos' | 'predial' | 'otro' | 'desconocido'
interface ReceiptReading { amount_cop: number | null; paid_at: string | null; institution: string | null;
  reference: string | null; payer_name: string | null; payment_kind: PaymentKind; confidence: 'high'; description: string | null }
interface NotificationAttachment { wam_id: string; media_url: string | null; mime_type: string | null;
  source: 'image' | 'pdf'; received_at: string; receipt: ReceiptReading | null }
interface AgentNotification { id; type: NotificationType; status: NotificationStatus; title: string;
  agent: 'administrative' | 'commercial';
  client: { id; full_name: string | null; phone_number: string | null; user_name: string | null };
  conversation: { id; case_number: string | null; status: ConversationStatus };
  payload: ReceiptReading | Record<string, unknown>;     // narrowed per type by the registry renderer
  attachments: NotificationAttachment[]; created_at; updated_at; resolved_at: string | null;
  resolved_by: { id: string; full_name: string } | null; resolution_note: string | null }
interface NotificationList { notifications: AgentNotification[]; total; limit; offset; pending_count }
interface WSNotificationEvent { notification: AgentNotification; pending_count: number }
```
`payload` queda tipado como unión abierta: cada renderer del registro lo estrecha con un type guard (`isReceiptReading`). Así un tipo futuro no obliga a cambiar el tipo base.

**`notificationsService`**: `list(params, signal)`, `getById(id, signal)`, `close(id, { status, note })`. Devuelve `data.data`. Normaliza `note` (trim; si queda vacía se omite).

**`notificationsStore`** (Zustand)
- `pendingCount: number`, `setPendingCount(n)` (clamp `>= 0`).
- `incoming: AgentNotification | null`, `setIncoming(n)`, `clearIncoming()`: alimenta `NotificationToast` (mismo patrón que `pendingEscalation`).
- `reset()`: se llama desde `authStore.clearSession`/`reset` para no filtrar el conteo entre sesiones.

**`inboxReducer`** (puro e inmutable, en `lib/notificationInbox.ts`)
- State: `{ byId: Record<string, AgentNotification>; order: string[]; total: number; serverOffset: number; filter: NotificationStatusFilter }`.
  - `byId` conserva items aunque salgan de `order`: el detalle de una notificación recién cerrada sigue visible aunque ya no pertenezca a la pestaña "Pendientes".
- Actions:
  - `pageLoaded { items, total, reset }`: con `reset` reemplaza; sin él hace append deduplicado por id.
  - `upserted { item, source: 'ws-new' | 'ws-updated' | 'local' }`: aplica `isNewer` (ignora si `item.updated_at` es menor que el cacheado, lo que protege contra eventos fuera de orden), actualiza `byId` y entra o sale de `order` según `matchesFilter`. Ajusta `total` y `serverOffset` (+1 al entrar, −1 al salir) para que "Cargar más" no salte ni duplique filas.
  - `filterChanged { filter }`: limpia `order`, mantiene `byId` como caché.
- Orden: `created_at` desc. Una nueva entra arriba, y un update conserva su posición.

**`useNotificationsInbox(filter, getSignal, isMounted)`**: hook de la página.
- Devuelve `{ items, total, hasMore, isLoading, isLoadingMore, error, loadMore, retry, getItem(id), fetchItem(id), close(id, status, note) }`.
- Registra `onNotificationNew`/`onNotificationUpdated` vía `useWebSocket({...})` con `useCallback` de deps estables (regla 5).
- Escucha `ws:reconnected`, que dispara `pageLoaded{reset}` para el filtro actual.
- Cada respuesta de `list` también actualiza `notificationsStore.pendingCount`.

**`notificationTypes` (registro)**
```ts
interface NotificationTypeDefinition {
  label: string                       // 'Comprobante de pago'
  icon: LucideIcon                    // Receipt
  toastTitle: (n) => string           // 'Nuevo comprobante de pago'
  rowSummary: (n) => string | null    // '$1.850.000 · Canon · Bancolombia'
  Detail: ComponentType<{ notification: AgentNotification }>
}
getNotificationType(type) => definition ?? GENERIC_DEFINITION
```

**`useFocusMessage({ messages, focusWamId, loadOlder, hasMore, isInitialLoadDone })`**
- Cuando termina la carga inicial, busca `messages.find(m => m.wam_id === focusWamId)`.
- Si no lo encuentra y `hasMore`, llama `loadOlder()` hasta `MAX_FOCUS_PAGES = 3` (300 mensajes).
- Al encontrarlo: `document.querySelector('[data-wam-id="…"]')` (con `CSS.escape`), luego `scrollIntoView({ block: 'center', behavior: 'smooth' })` (salto programático puntual, permitido por §16.1) y aplica `.message-focus-highlight` durante `FOCUS_HIGHLIGHT_MS = 2500`.
- Si no lo encuentra: toast `info` "No se encontró el mensaje en el historial cargado".
- Corre una sola vez por `focusWamId`, guardado con un ref, para no re-hacer scroll con cada `message.new`.
- Requiere que `ChatPage` exponga `loadMoreMessages` como función que devuelve una promesa (hoy es `async`, solo falta retornar si cargó algo) sin cambiar su comportamiento actual.

### Data Flow

**A. Arranque de sesión (badge)**
1. `ProtectedRoute` monta `useNotificationsBadgeSync()`.
2. Este llama `GET /notifications?status=pendiente&limit=1` y guarda `pending_count` con `setPendingCount`.
3. `Sidebar` lee `useNotificationsStore(s => s.pendingCount)` con selector fino y muestra el badge (`99+`, oculto si es 0).
4. Con `ws:reconnected` repite el paso 2.

**B. Abrir la página**
1. La URL `/notificaciones?status=pendiente[&id=…]` se parsea en `NotificationsPage`. Un `status` inválido cae a `pendiente`.
2. `useNotificationsInbox` hace `list({ status, limit: 20, offset: 0 })`, luego `pageLoaded{reset}` y actualiza `pendingCount`.
3. Si hay `?id=` y no está en `byId`, hace `fetchItem(id)` (`GET /notifications/{id}`). Con 404 muestra "La notificación no existe" y limpia `?id`.
4. Desktop muestra lista y detalle lado a lado. En mobile se ve la lista si no hay `id` y el detalle si lo hay, con botón ← que quita `id`.

**C. Notificación nueva por WebSocket**
1. `useWebSocket` recibe `notification.new` y valida que tenga forma mínima (`notification.id`, `typeof pending_count === 'number'`). Si no, lo ignora.
2. Global, siempre: `setPendingCount(pending_count)`, `setIncoming(notification)` y `playNotificationSound()` para **ambos roles** (decisión Q11/Q15: es trabajo accionable para todos, a diferencia de los mensajes, donde el admin no suena).
3. Si la página está montada, `_handlers.onNotificationNew` dispara `upserted{ws-new}`. Si coincide con el filtro, entra arriba sin tocar scroll ni selección.
4. `NotificationToast` se muestra solo si `pathname !== ROUTES.NOTIFICACIONES`, con auto-dismiss de 12 s. "Ver" navega a `/notificaciones?status=pendiente&id=<id>`. En la propia página el `incoming` se limpia sin renderizar el toast.

**D. Notificación actualizada por WebSocket** (adjunto nuevo o cierre por otro asesor)
1. `setPendingCount(pending_count)`, sin sonido ni toast.
2. `upserted{ws-updated}`: si pasó a cerrada y la pestaña es Pendientes, sale de `order` pero queda en `byId`.
3. Si es la seleccionada y `status !== 'pendiente'` y la cerró otra persona (`resolved_by.id !== advisor.id`), el detalle muestra el aviso "Cerrada por <nombre>" y deshabilita las acciones.

**E. Resolver o descartar**
1. "Marcar como resuelta" o "Descartar" abre `CloseNotificationDialog` en modo `resuelta | descartada`.
2. Validación zod: `note` con máximo 500 caracteres después de trim, **obligatoria** si es `descartada`.
3. Confirmar llama `close(id, status, note)`. Los botones se deshabilitan mientras está en vuelo para evitar doble submit.
4. 200: `upserted{local}`, cierra el diálogo y muestra el toast `success` "Notificación marcada como resuelta" o "Notificación descartada". El badge llega por el `notification.updated` que el backend emite; además se hace un decremento optimista local de 1, solo si el WS no llegó antes (se compara `updated_at`).
5. 409 `NOTIFICATION_ALREADY_CLOSED`: hace `fetchItem(id)` y `upserted`, cierra el diálogo y muestra un toast `info` "Otro asesor ya cerró esta notificación." El detalle muestra quién y cómo la cerró.
6. 404: toast "La notificación ya no existe", la saca de la lista y limpia `?id`.
7. 503 o error de red: el diálogo sigue abierto con el error inline "No se pudo confirmar el cierre", luego hace `fetchItem(id)`. Si ya figura cerrada, aplica la rama del paso 4; si sigue pendiente, habilita reintentar. Así se cumple el "refetch antes de reintentar" del contrato.
8. 422: error inline en el diálogo.

**F. Validar en la conversación**
1. En el detalle, `ConversationContextCard` tiene "Abrir conversación" y cada adjunto tiene "Ver en la conversación".
2. Ambos hacen `navigate(ROUTES.CHAT.replace(':id', conversation.id), { state: { fromNotification: { id, title, status }, focusWamId? } })`.
3. `ChatPage` carga como siempre. Si hay `focusWamId`, `useFocusMessage` busca, pagina, hace scroll y resalta.
4. Si hay `fromNotification`, aparece el banner "Viniste desde la notificación «<title>»" con "← Volver a la notificación", que navega a `/notificaciones?status=<status>&id=<id>`.
5. Funciona también con conversaciones `cerrada`: el chat ya las soporta en modo lectura.

### API / Interface Contracts

**HTTP** (sin cambios en backend, consumo estricto de `panel_api_reference.md`)

| Método | Endpoint | Uso |
|---|---|---|
| GET | `/api/v1/panel/notifications?status&type&limit&offset` | Lista, badge (`limit=1`) |
| GET | `/api/v1/panel/notifications/{id}` | Deep link `?id=`, refresh tras 409/503 |
| PATCH | `/api/v1/panel/notifications/{id}` body `{ status, note? }` | Cerrar |

```ts
notificationsService.list(params: { status?: NotificationStatusFilter; type?: NotificationType; limit?: number; offset?: number }, signal?): Promise<NotificationList>
notificationsService.getById(id: string, signal?): Promise<{ notification: AgentNotification }>
notificationsService.close(id: string, body: { status: 'resuelta' | 'descartada'; note?: string }): Promise<{ notification: AgentNotification }>
```

**WebSocket**: nuevos cases en el `switch` de `useWebSocket`:
```ts
case 'notification.new':     handleNotificationEvent(data, 'new');     break
case 'notification.updated': handleNotificationEvent(data, 'updated'); break
// WSHandlers += onNotificationNew?, onNotificationUpdated?: (data: WSNotificationEvent) => void
```
La lógica global (badge, toast, sonido) vive en `handleNotificationEvent`, una función de módulo, no en el handler de la página. El badge y el toast funcionan aunque la página no esté montada, y el registro de un solo handler por evento no se pisa entre dueños.

**Router state del chat**
```ts
interface ChatLocationState {
  fromAlert?: boolean; advisorName?: string                 // existing
  fromNotification?: { id: string; title: string; status: NotificationStatusFilter }
  focusWamId?: string
}
```

**URL de la página**: `/notificaciones?status=pendiente|resuelta|descartada|all&id=<uuid>`.

### UI

- **Fila**: ícono del tipo, `title`, `rowSummary` (monto · tipo de pago · entidad), cliente y `CaseNumberTag` existente, chip de agente (`agentLabel`/`agentStyles` existentes), antigüedad relativa, chip de estado y un indicador "+N archivos" si hay más de un adjunto.
- **Detalle**, en este orden para que se entienda de un vistazo:
  1. Header con el título, el chip de estado y la antigüedad.
  2. **`ConversationContextCard`**: número de caso, cliente, teléfono, agente, estado de la conversación (activa/cerrada) y "Abrir conversación".
  3. **Resumen del pago** (`PaymentReceiptDetail`): monto grande, tipo de pago, fecha, entidad, referencia, pagador y descripción. Encima, el aviso "Lectura automática — verificar en la conversación antes de registrar". Los campos `null` se muestran como "No leído", nunca se ocultan, para que se note qué falta.
  4. **Adjuntos**: una tarjeta por archivo, del más antiguo al más nuevo, con miniatura o ícono PDF, hora de recepción, su propia lectura cuando difiere del resumen y "Ver en la conversación".
  5. **Acciones** (solo si está `pendiente`): "Marcar como resuelta" (primario) y "Descartar" (secundario).
  6. **Cierre** (si está cerrada): "Resuelta" o "Descartada" por <nombre>, cuándo, y la nota.
- **Estados**: skeleton en la carga, vacío por pestaña ("No hay notificaciones pendientes", sin emoji), error con "Reintentar", y "Cargar más" con spinner.
- **Checklist §16.1**: sin `backdrop-blur` en la lista, el detalle ni el overlay del diálogo o del lightbox (scrim sólido semitransparente). Sin `scroll-smooth` en los paneles. `CloseNotificationDialog` usa `max-h-[90vh]` con scroll interno. Sin animaciones infinitas en filas. `NotificationRow` va con `memo` y las miniaturas con `loading="lazy"`. El resaltado del mensaje es una transición única que se retira a los 2,5 s.
- **Accesibilidad**: las pestañas usan `role="tablist"`, las filas son botones con `aria-current` en la seleccionada y el diálogo tiene foco atrapado (componente `ui/dialog` existente). Los botones de solo ícono llevan `aria-label`.

### Edge Cases & Error Handling

| Caso | Manejo |
|---|---|
| `client.full_name` null | Fallback `user_name` y luego `phone_number`; si todo es null, "Cliente sin identificar" (`lib/clientName.ts` si aplica, si no, `notificationFormat`) |
| `phone_number` null (cliente solo BSUID) | Se oculta la línea de teléfono |
| `case_number` null | Se omite el tag |
| `media_url` null | "Archivo no disponible" + "Abrir conversación"; nunca se usa `meta_media_id` |
| `media_url` no `https:` | `isSafeHttpsUrl`: no se renderiza como `src`/`href` y se trata como no disponible |
| `paid_at` `YYYY-MM-DD` | Se parsea como fecha local (`parseISO` sin `Z`) para evitar el corrimiento de un día por UTC |
| `payload` con campos null | "No leído" por campo |
| `type` desconocido | Renderer genérico: `title`, conversación y adjuntos, con acciones de cierre normales |
| Evento WS fuera de orden o duplicado | `isNewer` por `updated_at`; dedupe por id |
| Evento WS mal formado | Se ignora (guard de forma mínima), sin romper el socket |
| Eventos perdidos durante una desconexión | `ws:reconnected` refetchea la lista y el badge |
| "Cargar más" con inserciones o salidas en vivo | `serverOffset` ajustado ±1 y dedupe por id |
| Cierre concurrente (409) | Refetch del item y "Otro asesor ya cerró esta notificación." |
| Respuesta perdida o reintento del mismo cierre | El backend responde 200 idempotente; se trata como éxito |
| 503 en GET | Error inline con "Reintentar"; el toast genérico de axios se mantiene |
| 503 en PATCH | Refetch del item antes de habilitar el reintento |
| Página desmontada con request en vuelo | `useAbortableLoad`: signal cancelado y `isMounted()` antes de escribir estado o store |
| `?id=` inexistente o UUID inválido | 404, aviso y se limpia `?id` |
| `?status=` inválido | Cae a `pendiente` |
| Mensaje `wam_id` no encontrado en 3 páginas | El chat abre igual, con toast informativo |
| Conversación vinculada `cerrada` | Se navega igual (el chat la muestra en solo lectura) |
| Logout o cambio de sesión | `notificationsStore.reset()` vía `authStore` |
| Badge > 99 | "99+" |
| Muchas notificaciones seguidas | Un solo `incoming` (el último reemplaza al anterior), sin apilar toasts; el sonido se limita a uno cada 3 s (throttle en `handleNotificationEvent`) |

### Testing

- `lib/notificationInbox.test.ts`: reducer (append deduplicado, upsert dentro y fuera del filtro, `isNewer`, ajuste de `serverOffset`/`total`, `byId` conserva la seleccionada).
- `lib/notificationFormat.test.ts`: COP, `paid_at` local, fallback del nombre de cliente, labels.
- `services/notifications.test.ts`: params, envelope, normalización de `note` (patrón de `conversations.test.ts`).
- `hooks/useWebSocket.test.ts` (extender): `notification.new` actualiza el badge, setea `incoming`, suena y llama al handler; `updated` no suena; payload inválido se ignora.
- `hooks/useFocusMessage.test.ts`: lo encuentra en lo cargado, pagina hasta encontrarlo, respeta el tope y avisa, y corre una sola vez.
- `pages/NotificationsPage.test.tsx`: carga y lista, pestañas en la URL, deep link `?id`, cierre exitoso, 409 refetch con aviso, descartar sin nota bloqueado, inserción por WS sin cambiar la selección.
- `components/NotificationToast.test.tsx`: se suprime en `/notificaciones` y "Ver" navega con `id`.
- Objetivo: ≥ 80 % en los archivos nuevos; `tsc --noEmit`, `eslint` y `vitest` en verde.

## Open Questions for Implementation

- **Decremento optimista del badge tras cierre local**: si complica la lógica de carrera con `notification.updated`, se puede omitir y confiar solo en el evento más el `pending_count` de la siguiente respuesta. Se decide al implementar y se documenta en el log.
- **Extracción de `ImageLightbox`**: si la extracción toca demasiado `MessageBubble.tsx` (36 KB), se acepta un lightbox mínimo propio reutilizando `react-zoom-pan-pinch`. Preferencia: extraer.
- **`loadMoreMessages` en ChatPage**: confirmar al implementar que devolver el número de mensajes cargados no altera el comportamiento del scroll infinito actual (`ChatPageBackButton` y `ChatPageWindowRefresh` deben seguir en verde).
- **Ícono del Sidebar**: el Sidebar hoy usa SVG inline; se mantiene ese estilo en lugar de importar `lucide-react` allí, por consistencia.

## Revisión: tabla con acciones por fila

**Componentes** (reemplazan los de detalle):
| File | Role |
|------|------|
| `src/components/notifications/NotificationsTable.tsx` | Tabla con header sticky, vacío/error/skeleton y "Cargar más" (mismo patrón que `HistorialPage`) |
| `src/components/notifications/NotificationTableRow.tsx` | Fila (memo): N° de caso (+ "Conversación cerrada"), cliente + teléfono, recibida (relativa, fecha completa en `title`), comprobante (`rowSummary` + `rowDetails` + "+N archivos más"), agente, estado (chip + "por X" + nota) y acciones |
| `src/components/notifications/types/registry.ts` | `label`, `icon`, `toastTitle`, `rowSummary`, `rowDetails` por tipo (sin componente de detalle) |

**Acciones por fila**, en dos grupos visualmente distintos para evitar clics equivocados:
- **Consulta** (contorno neutro; hover azul): "Ver comprobante" (imagen en `ImageLightbox`, PDF en pestaña nueva; `null`/no-https, entonces "Archivo no disponible" deshabilitado con borde punteado) y "Abrir chat" (deep link al mensaje del primer adjunto).
- **Decisión** (solo si `pendiente`, separado por un divisor): "Resolver" (verde sólido) y "Descartar" (contorno rojo tenue). Ambos abren `CloseNotificationDialog`, que ahora muestra a qué notificación aplica (`cliente · resumen`).
- Botones de 32 px de alto, ícono + texto y `title` explicativo. El grupo tiene `aria-label` con el nombre del cliente.

**URL**: `?status=` es la pestaña; `?id=` solo resalta la fila y la lleva a la vista (toast "Ver", banner "Volver a la notificación" del chat).

**Cierre por otro asesor**: si el `notification.updated` cierra la fila cuyo diálogo está abierto, el diálogo se cierra con el toast "<nombre> ya cerró esta notificación.".

**Subtítulo**: "Notificaciones generadas por el asistente de IA por gestionar". El aviso de lectura automática queda en el `title` de la celda Comprobante.

## Revisión 2: sin detalles del pago y tres acciones (Q19–Q21)

- **Columna "Notificación"** (antes "Comprobante"): muestra solo `description` del registro ("Comprobante de pago enviado por el cliente") y "+N archivos más". No se muestra `payload` ni el `title` del backend (incluye el monto). El toast, el diálogo de cierre (`cliente · descripción`) y el banner del chat usan la misma descripción.
- **Registro de tipos**: `{ icon, toastTitle, description }`. Se eliminaron `rowSummary`, `rowDetails`, el `Detail` y los helpers de lectura del comprobante (`receipt.ts`, `formatCop`, `formatPaidAt`, `paymentKindLabel`).
- **Acciones**: una línea horizontal, todas de 32 px de alto y ancho mínimo igual: "Abrir chat" (contorno neutro), divisor vertical, "Resolver" (verde sólido) y "Descartar" (contorno rojo). Las cerradas solo muestran "Abrir chat".
- **Quitado "Ver comprobante"**: con él salen `ImageLightbox` compartido, `safeUrl.ts` y la extracción desde `MessageBubble.tsx`, que vuelve a su versión original. El chat sigue llevando al mensaje del primer archivo (`focusWamId`).
