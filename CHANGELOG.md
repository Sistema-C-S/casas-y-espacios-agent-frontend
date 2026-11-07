# Changelog

Todas las versiones notables de este proyecto se documentan en este archivo.

## [2.7.0] - 2026-11-07

Requiere el backend 2.12.0 (notificaciones del agente y correo del cliente). Desplegar después del backend.

### Added
- Bandeja de notificaciones del agente (comprobantes de pago): pestañas por estado, cierre como resuelta o descartada con nota, contador en el menú y aviso en vivo por WebSocket. Abrir una notificación lleva al chat en el mensaje del comprobante.
- Correo del cliente en el panel del chat, en Contactos (columna propia, búsqueda) y en el historial; un clic lo copia.
- Cola de envío en el chat: el composer nunca espera a la red, y un mensaje fallido se reintenta desde el aviso de error.

### Fixed
- Reabrir una conversación bloqueada abre la conversación activa y mantiene el aviso visible; el botón de tomar control tiene nombre.
- Las imágenes y los links largos ya no se salen de la burbuja del chat.
- La política de seguridad de contenido permite las fotos de inmuebles de Wasi.
- Se resolvieron todas las vulnerabilidades reportadas por `npm audit`.
- La cola de envío es por conversación: un mensaje que falla en un chat que ya no está abierto avisa con el nombre del cliente, y un envío lento en un chat no demora los demás.
- Reintentar un mensaje, archivo o audio nunca lo envía dos veces (`client_message_id`, requiere el backend 2.12.0).
- "Correo copiado" vuelve a mostrarse.
- Un backend anterior o un error 503 ya no muestran avisos genéricos repetidos al entrar, al reconectar ni al cerrar una notificación.
- Abrir una notificación lleva al mensaje también la segunda vez, y avisa cuando no lo encuentra; el contador baja al cerrar una notificación.

## [2.6.0] - 2026-09-27

Requiere el backend 2.10.0 (un número, dos agentes). Desplegar después del backend.

### Added
- La bandeja, el chat y el historial muestran el agente dueño de la conversación (Administrativo / Comercial) en lugar de la línea de WhatsApp.
- Filtro por agente en la bandeja y filtro por intención en el historial, en el lugar del filtro de línea.

### Changed
- Toda asesora recibe los avisos y el sonido de escalado de cualquier conversación: el panel ya no filtra por área, igual que el backend.
- El historial ya no muestra la columna "Línea" (hay un solo número).
- Los cierres de menos de un minuto muestran segundos en vez de "0 min".

## [2.5.0] - 2026-09-21

### Added
- Ventana de 24 h de WhatsApp visible en el panel: estado, contador vivo y bloqueo del composer cuando está vencida.

### Fixed
- El historial ordena las conversaciones cerradas de la más reciente a la más antigua, siguiendo la columna "Fecha de Cierre".
- El historial ya no rompe la vista completa cuando una fila trae una fecha de cierre ilegible: muestra un guion en su lugar.
- La ventana de 24 h se refresca cuando el cliente escribe, en vez de descontar hasta cero sobre una ventana ya reabierta.
- Se cierra la vía de envío de audio que quedaba abierta cuando responder estaba bloqueado.
- Recuperación de WebSocket muerto y de suscripciones de chat sordas.
- Se espera a que pasen las reconexiones rápidas antes de mostrar el banner de "reconectando".
- Al volver a la pestaña se sondea el socket en vez de descartar una conexión sana.
- Las imágenes entrantes se muestran una vez que su URL de Storage queda parcheada.
- Se desbloquea el `AudioContext` en el primer gesto y se reintenta la suscripción WS de la conversación.

## [2.4.0] - 2026-09-15

### Added
- Manejo del evento WS `conversation.new` para actualizar la lista de bandeja en vivo.
- Nuevo canvas para editar imágenes.
- Toggle de control manual del bot (take-control) en el header del chat.
- Mensaje de escalamiento actualizado en el chat cuando el asesor toma control manual.
- Documentación actualizada con nuevo endpoint en la referencia de la API del panel.

### Fixed
- Se elimina el prefijo `wam_id` para mostrar correctamente los nombres reales de archivos de documentos.
- Recarga de la lista de bandeja cuando `message.new` apunta a una conversación desconocida.
- Vista previa del primer frame en lugar de recuadro negro para videos no reproducidos.
- Error de build: `null` no asignable a `src`/`href` de video/anchor.
- Actualización en vivo (live-patch) de `media_url` ante el evento WS `message.media_updated`.
- Se eliminan banners duplicados de "toma de control" y el mensaje de despedida en cierres manuales.
- Corrección en el componente de video.

## [2.3.0] - anterior

Ver historial de tags anterior a este changelog.
