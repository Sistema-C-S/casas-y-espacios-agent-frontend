# Clarifications: Notificaciones del Agente

Contexto técnico verificado antes de preguntar:
- Cada adjunto trae `wam_id`; los mensajes del chat también (`Message.wam_id` en `src/types/index.ts`) → se puede llevar al asesor al mensaje exacto del comprobante.
- `ChatPage` ya recibe contexto por `location.state` (patrón `fromAlert` / `advisorName`).
- CSP (`index.html`): `img-src` permite `https://*.supabase.co` → miniaturas OK. `frame-src blob:` → un PDF de Storage **no** se puede embeber en iframe; se abre en pestaña nueva.

## Questions & Answers

**Q1: ¿Qué información de la conversación y del comprobante muestra cada notificación?**
A: `case_number`, nombre del cliente (fallback `full_name` → `user_name` → `phone_number`), teléfono, agente (Administrativo/Comercial) y estado de la conversación (activa/cerrada). Además, todo lo necesario para que la asesora entienda **rápidamente** de qué trata: tipo de pago en español (`payment_kind` → Canon, Administración, Servicios públicos, Predial, Otro, Desconocido), monto formateado en COP, fecha de pago, entidad, referencia, pagador, descripción del modelo, cantidad de adjuntos, antigüedad relativa ("hace 12 min") y la etiqueta "Lectura automática — verificar en la conversación".

**Q2: ¿"Ver en la conversación" lleva al mensaje exacto?**
A: Sí. Por adjunto: abre el chat, hace scroll al mensaje con ese `wam_id` y lo resalta unos segundos. Si el mensaje no está en el historial cargado, abre el chat igual y muestra un aviso "No se encontró el mensaje en el historial cargado".

**Q3: ¿Cómo se ve el comprobante sin salir de la página?**
A: Imágenes en un visor ampliado dentro de Notificaciones; PDFs en pestaña nueva. `media_url = null` → "Archivo no disponible" + botón para abrir la conversación.

**Q4: ¿Hay forma de volver desde el chat a la notificación?**
A: Sí. Banner en el chat "Viniste desde la notificación …" con botón para volver (mismo patrón que `fromAlert`).

**Q5: ¿Layout?**
A: Desktop: lista a la izquierda + detalle a la derecha. Mobile: lista y detalle a pantalla completa con botón para volver.

**Q6: ¿Ruta y ubicación en el Sidebar?**
A: `ROUTES.NOTIFICACIONES = '/notificaciones'`, ítem debajo de Bandeja, ícono de campana, con badge de pendientes.

**Q7: ¿Filtros?**
A: Pestañas Pendientes (default) / Resueltas / Descartadas / Todas. Sin filtro por `type` (solo existe `comprobante_pago`).

**Q8: ¿Paginación?**
A: 20 por página con botón "Cargar más".

**Q9: ¿La nota es obligatoria?**
A: Opcional al resolver; **obligatoria al descartar** (deja registrado el motivo). Regla solo de frontend; el backend la acepta opcional. Máx. 500 caracteres en ambos casos.

**Q10: ¿Confirmación al cerrar?**
A: Diálogo con nota + botón confirmar en ambas acciones. Sin "deshacer" (el backend no permite reabrir).

**Q11: ¿Qué pasa si llega una notificación nueva y el asesor está en otra página?**
A: Toast "Nuevo comprobante de pago · <cliente>" con botón "Ver" + sonido suave reutilizando el Web Audio existente.

**Q12: ¿Y si está en la página con Pendientes abierto?**
A: Se inserta arriba sin mover el scroll ni cambiar la selección actual.

**Q13: ¿Y si llega `notification.updated` sobre la notificación que estoy viendo?**
A: Se actualiza en el lugar (adjunto nuevo o cierre). Si la cerró otro asesor: aviso "Cerrada por <nombre>" y botones deshabilitados.

**Q14: ¿Dónde vive el conteo del badge?**
A: Store nuevo `notificationsStore` con `pendingCount`, inicializado al iniciar sesión con `GET /notifications?limit=1` y actualizado con `pending_count` de cada evento WS y de cada respuesta de lista. Separado de `unreadAlerts`.

**Q15: ¿Permisos por rol?**
A: Ambos roles (`asesor`, `admin`) ven y cierran todas las notificaciones. El admin no tiene vistas extra.

**Q16 (durante implementación): ¿La página necesita una vista de detalle por notificación?**
A: No. Las notificaciones se muestran en filas, igual que el Historial de cerrados, con botones por fila para ver el comprobante, abrir la conversación y cambiar el estado. Cargar una vista de detalle por notificación no es relevante para el asesor. **Reemplaza Q3–Q5 y Q13** (visor dentro del detalle, layout lista/detalle, aviso "Cerrada por X" en el detalle).

**Q17 (durante implementación): Diseño de los botones de acción.**
A: No deben verse genéricos: el asesor no debe equivocarse de botón. Se separan en dos grupos (consulta / decisión), con ícono, color propio y zona de clic amplia.

**Q18 (durante implementación): Subtítulo de la página.**
A: "Notificaciones generadas por el asistente de IA por gestionar".

**Q19 (durante implementación): ¿Se mantiene "Ver comprobante"?**
A: No, no es relevante. La fila queda con tres botones: Abrir chat, Resolver y Descartar.

**Q20 (durante implementación): ¿Se muestran los datos leídos del comprobante (monto, tipo de pago, entidad, referencia)?**
A: No. Solo se indica qué es: "Comprobante de pago enviado por el cliente", sin detalles. Tampoco se usa el `title` del backend, porque incluye el monto. **Reemplaza Q1** en lo referido a los datos del pago.

**Q21 (durante implementación): Botones.**
A: Con solo tres, en una línea horizontal para aprovechar el espacio y que se vean mejor.

## Open Decisions
_Todas resueltas en `03-design.md` / `04-implementation.md`._
- **Deep link al mensaje fuera de la página cargada**: `ChatPage` pagina los mensajes. Decidir en diseño si se intenta cargar páginas anteriores hasta encontrar el `wam_id` (con tope) o solo se busca en lo ya cargado y se avisa.
- **Toast en la propia página Notificaciones**: con la página abierta, ¿se suprime el toast y queda solo el sonido + inserción? (propuesta de diseño: suprimir toast, mantener sonido).
- **Notificaciones nuevas que no coinciden con el filtro activo** (p. ej. estoy en "Resueltas"): no se insertan en la lista, solo actualizan el badge.
- **Refetch al reconectar**: dónde engancharlo (transición del `status` de `wsStore` a `connected` tras una caída).
