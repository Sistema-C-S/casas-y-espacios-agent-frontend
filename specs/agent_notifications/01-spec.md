# Spec: Notificaciones del Agente (página del panel)

Fuente de verdad del contrato: `docs/panel_api_reference.md` → sección **Agent Notifications** y eventos WS `notification.new` / `notification.updated`.

## Problem
El agente de WhatsApp ahora registra **notificaciones** para el equipo sin escalar la conversación. El primer tipo es `comprobante_pago`: un cliente envió un comprobante de pago (imagen o PDF) que alguien debe registrar en el sistema contable. Hoy el panel no tiene dónde ver estas notificaciones: los comprobantes quedan perdidos dentro del chat y nadie sabe qué está pendiente de registrar, ni quién ya lo hizo.

Afecta a **todos los asesores** (`asesor` y `admin`): cualquiera puede ver y cerrar cualquier notificación (no hay filtro por área).

## Goals
- Nueva página **Notificaciones** en el panel, accesible para ambos roles desde el Sidebar.
- Listar notificaciones (más nuevas primero), por defecto las `pendiente`, con filtro por estado (`pendiente` / `resuelta` / `descartada` / `all`) y paginación.
- Mostrar el detalle de cada notificación: título, cliente, conversación vinculada, datos leídos del comprobante (`payload`) y todos los adjuntos con su lectura individual.
- Permitir **cerrar** una notificación pendiente como `resuelta` o `descartada`, con nota opcional (≤ 500 caracteres).
- Permitir abrir la conversación vinculada (chat) desde la notificación.
- Badge en el Sidebar con `pending_count` (siempre el total de pendientes, sin importar filtros).
- Sincronización en tiempo real vía WebSocket: insertar/reemplazar filas y actualizar el badge con `notification.new` / `notification.updated`, sin requests extra.

## Non-Goals
- No es una escalación: la página **nunca** modifica `bot_activo`, asesor asignado ni cuota de conversaciones.
- No reabrir notificaciones cerradas (el backend no lo permite).
- No editar los datos leídos del comprobante (`payload` es solo lectura).
- No registrar el pago en un sistema contable externo desde el panel (solo marcar como resuelta).
- No crear notificaciones desde el panel (solo las crea el agente).
- No soportar otros `type` además de `comprobante_pago` en la UI (pero el modelo no debe cerrarse a futuros tipos).
- No tocar el sistema existente de alertas de comportamiento (`behavior.alert`, `unreadAlerts`).

## Expected Behavior
1. Asesor entra a **Notificaciones** desde el Sidebar. El ítem muestra un badge rojo con el número de pendientes (`99+` si > 99; oculto si 0).
2. La página carga `GET /notifications?status=pendiente&limit=20&offset=0`. Cada fila muestra `title`, nombre del cliente (fallback `full_name` → `user_name` → `phone_number`), `case_number`, agente (`administrative`/`commercial`), tipo de pago (`payment_kind`), antigüedad y estado.
3. Al seleccionar una fila se ve el detalle: datos del `payload` presentados como **"Lectura automática — no verificada"** (pista, nunca pago confirmado), la lista de adjuntos (miniatura de imagen o enlace a PDF; si `media_url` es `null` → "archivo no disponible" + botón para abrir la conversación).
4. Botones **"Marcar como resuelta"** y **"Descartar"** abren un diálogo con nota opcional. Al confirmar → `PATCH /notifications/{id}`. Éxito: la fila se actualiza (y sale de la vista si el filtro es `pendiente`), el badge baja.
5. Si otro asesor la cerró primero → `409 NOTIFICATION_ALREADY_CLOSED`: mensaje "Otro asesor ya cerró esta notificación." y se refresca la fila (`GET /notifications/{id}`) para mostrar quién la cerró (`resolved_by.full_name`) y cómo.
6. Notificaciones cerradas muestran estado, quién la cerró, cuándo (`resolved_at`) y la nota.
7. "Abrir conversación" navega al chat (`ROUTES.CHAT`) de `conversation.id`, aunque esté `cerrada`.
8. En vivo: llega `notification.new` → fila nueva arriba (si coincide con el filtro activo) + badge = `pending_count`. Llega `notification.updated` → se reemplaza la fila por `id` (adjunto nuevo o cierre de otro asesor) + badge = `pending_count`.
9. Al reconectar el WebSocket se refetchea la lista y el conteo (los eventos son best-effort).

## Constraints
- Contrato estricto de `docs/panel_api_reference.md`; envelope `{ data }` / `{ detail: { code, message } }`.
- HTTP solo vía servicio nuevo sobre `apiClient` (axios con auth automática); nada de `fetch` directo.
- WebSocket: reutilizar el socket singleton de `useWebSocket` (agregar los eventos al switch y a `WSHandlers`); nunca otro `new WebSocket`. Reglas de hooks/Zustand de CLAUDE.md §15.
- `payload` y lectura de cada adjunto son machine-read: la UI no debe presentarlos como pago confirmado.
- `media_url` de adjuntos es URL pública de Storage o `null` — revisar que el CSP del panel permita cargar las imágenes del dominio de Supabase Storage.
- Errores 503 `SUPABASE_ERROR` (incluye migración 013 no aplicada): estado de error con reintento; en PATCH, refetch antes de reintentar (el cierre pudo haber ocurrido).
- Checklist de fluidez UI §16.1: sin `backdrop-blur` en contenedores con scroll, modales `max-h-[90vh]` con scroll interno, sin `scroll-smooth` en la lista.
- Rutas desde `ROUTES`; textos UI en español, código en inglés; `tsc --noEmit` y tests en verde.

## Priority
High — es la primera feature del agente que requiere acción humana sin escalar; sin la página, los comprobantes de pago no tienen dónde gestionarse y el backend ya emite los eventos.
