# Implementation Plan: Notificaciones del Agente

## Tasks

- [x] **Task 1**: Domain types — `src/types/notifications.ts`, `src/types/index.ts`
- [x] **Task 2**: Service — `src/services/notifications.ts`, `src/services/index.ts`
- [x] **Task 3**: Store + session reset + local error codes — `src/store/notificationsStore.ts`, `src/store/authStore.ts`, `src/lib/axios.ts`
- [x] **Task 4**: Pure libs — `src/lib/notificationFormat.ts`, `src/lib/notificationInbox.ts`, `src/lib/safeUrl.ts`
- [x] **Task 5**: WebSocket events — `src/hooks/useWebSocket.ts`
- [x] **Task 6**: Badge sync hook + toast + route + sidebar — `src/hooks/useNotificationsBadgeSync.ts`, `src/components/shared/NotificationToast.tsx`, `src/constants/routes.ts`, `src/App.tsx`, `src/components/layout/ProtectedRoute.tsx`, `src/components/layout/Sidebar.tsx`
- [x] ~~**Task 7**: Shared ImageLightbox extraction~~ (reverted in Task 16) — `src/components/shared/ImageLightbox.tsx`, `src/components/chat/MessageBubble.tsx`
- [x] **Task 8**: Inbox hook — `src/hooks/useNotificationsInbox.ts`
- [x] **Task 9**: Type registry + detail renderers — `src/components/notifications/types/*`
- [x] **Task 10**: Page + components — `src/pages/NotificationsPage.tsx`, `src/components/notifications/*`
- [x] **Task 11**: Chat deep link — `src/hooks/useFocusMessage.ts`, `src/components/chat/MessageFeed.tsx`, `src/pages/ChatPage.tsx`, `src/index.css`
- [x] **Task 12**: Tests — `src/__tests__/...`
- [x] **Task 13**: Verification — `tsc`, `eslint`, `vitest`, design/CLAUDE.md conformance
- [x] **Task 15**: Bounded review (4 lenses) + corrections
- [x] **Task 16**: Remove view-receipt action and payment details; horizontal buttons (user request)
- [x] **Task 14**: Layout revision (user request) — table rows like Historial, no detail view; distinct action buttons; subtitle

## Execution Log

### Task 1 — Domain types
Status: ✅ Done
Notes: `src/types/notifications.ts`, re-exported from `types/index.ts`. `payload` typed as `Record<string, unknown>` and narrowed per type (`isReceiptReading`); `NotificationType` kept open (`string & {}`).

### Task 2 — Service
Status: ✅ Done
Notes: `notificationsService.list/getById/close`. `close` trims the note and omits it when blank. Ids are `encodeURIComponent`-ed.

### Task 3 — Store, session reset, local error codes
Status: ✅ Done
Notes: **Deviation from design**: `authStore` was NOT modified. `notificationsStore` subscribes to `useAuthStore` and resets when `sessionEpoch` changes (only moves when a session ends), so authStore does not depend on a feature store. `NOTIFICATION_ALREADY_CLOSED` / `NOTIFICATION_NOT_FOUND` added to `LOCAL_ERROR_CODES`.

### Task 4 — Pure libs
Status: ✅ Done
Notes: `notificationFormat.ts` (labels, COP, local `paid_at`, relative time clamped against clock skew, client name fallback, badge `99+`), `notificationInbox.ts` (reducer with `byId`/`order`/`serverOffset`, `isNewer` also blocks closed→pendiente), `safeUrl.ts`. Added `notificationRoutes.ts` (`buildNotificationsUrl`, `buildChatUrl`) so the toast, page and chat banner build the same URLs.

### Task 5 — WebSocket events
Status: ✅ Done
Notes: `handleNotificationEvent` (module-level) validates the payload shape, sets `pendingCount`; on `new` also sets `incoming`, plays the sound (throttled 3 s) and forwards to `onNotificationNew`; on `updated` forwards to `onNotificationUpdated` only. Handlers registered with the same pattern as the rest of `WSHandlers`.

### Task 6 — Badge sync, toast, route, sidebar
Status: ✅ Done
Notes: `useNotificationsBadgeSync(enabled)` mounted in `ProtectedRoute` (before the early returns, respecting hook rules); refetches on `ws:reconnected`. `NotificationToast` placed **bottom-right** (deviation: the escalation toast and `ToastStack` both own `top-24 right-4`, they would overlap). Sidebar item under Bandeja using `ROUTES.NOTIFICACIONES`; mobile header titles for Contactos/Notificaciones. Known: a 503 on the badge request still shows axios' generic 503 toast (no per-request silent flag exists in `axios.ts`; not added to keep scope).

### Task 7 — Shared ImageLightbox
Status: ✅ Done
Notes: Moved verbatim (`Rotation`, `nextRotation`, `LightboxToolButton`, `ImageLightbox`) to `components/shared/ImageLightbox.tsx`; `DownloadIcon` duplicated there because MessageBubble still uses its own for other buttons. No behavior change.

### Task 9 — Type registry + renderers
Status: ✅ Done
Notes: `registry.ts` (`getNotificationType` with own-property check + generic fallback), `PaymentReceiptDetail`, `GenericNotificationDetail`, `ReceiptFields` (always renders every field, "No leído" for nulls), `receipt.ts` helpers.

### Task 8 — Inbox hook
Status: ✅ Done
Notes: `useNotificationsInbox(filter)`: data in `inboxReducer`, request lifecycle in a local `requestReducer` (the `react-hooks/set-state-in-effect` lint rule rejects `useState` setters called from the filter effect; `dispatch` is accepted). Stale list responses dropped with a request ticket. `close()` returns a typed `CloseOutcome` (`closed | already_closed | not_found | unconfirmed | invalid`); 409 refetches the row; 503/network refetches and reports `closed` if the close did land. **Open question resolved**: no optimistic badge decrement — the badge comes from `notification.updated` and from `pending_count` on every list response (and the reconnect sync), avoiding a race with the WS event. Added `lib/apiError.ts` (`getApiErrorInfo`, `isAbortError`).

### Task 10 — Page and components
Status: ✅ Done
Notes: `NotificationsPage` (URL-driven `?status`/`?id`; tab change uses `replace`, selection pushes history so mobile back works), `NotificationTabs`, `NotificationList` (skeleton, empty per tab, error + retry, "Cargar más"), `NotificationRow` (memo), `NotificationDetail` (conversation card → type renderer → attachments → actions/closure), `ConversationContextCard`, `AttachmentList` (thumbnail → shared lightbox; PDF opens in new tab; `null`/non-https URL → "No disponible"; per-file reading shown only when it differs from the summary), `CloseNotificationDialog`. **Deviation**: the dialog uses the project's custom modal pattern (solid `bg-black/75` scrim, `max-h-[90vh]`, scrollable body) instead of `ui/dialog`, whose overlay applies `backdrop-blur-xs` (forbidden by §16.1). Note schema moved to `lib/notificationNote.ts` (zod; required on discard). "Closed by another advisor" detected by watching the selected row transition `pendiente → closed` while not closing locally. Added `types/navigation.ts` (`ChatLocationState`).

### Task 11 — Chat deep link
Status: ✅ Done
Notes: `useFocusMessage` finds the `wam_id`, pages back up to 3 times via `loadMoreMessages` (now resolves to the number of messages added; `onScrollTop` behavior unchanged), scrolls with `scrollIntoView({ block: 'center', behavior: 'smooth' })` and highlights for 2.5 s; gives up with an info toast. `MessageFeed` adds `data-wam-id` and the `.message-focus-highlight` class (one finite animation in `index.css`). `ChatPage` reads `location.state` through `ChatLocationState` and shows the "← Volver a la notificación" banner.

### Task 14 — Layout revision (user request mid-implementation)
Status: ✅ Done
Notes: The user asked for rows like the Historial with per-row buttons and **no per-notification detail view**, then for less generic buttons (avoid misclicks), then a simpler subtitle. Removed `NotificationDetail`, `ConversationContextCard`, `AttachmentList`, `NotificationList`, `NotificationRow`, `PaymentReceiptDetail`, `GenericNotificationDetail`, `ReceiptFields`. Added `NotificationsTable` + `NotificationTableRow`; registry now exposes `rowSummary`/`rowDetails` instead of a `Detail` component. `?id=` now highlights the row (`.message-focus-highlight`, 2.5 s) instead of selecting it. Close dialog shows `cliente · resumen`. Action buttons are split into consult (outline) and decide (green solid / red outline) groups with icons. Design addendum in `03-design.md`; clarifications Q16–Q18.

### Task 12 — Tests
Status: ✅ Done
Notes: `lib/notificationInbox.test.ts` (reducer, `isNewer`, offsets), `lib/notificationFormat.test.ts` (formatters, note schema, safe URL, routes, registry), `services/notifications.test.ts`, `hooks/useWebSocketNotifications.test.ts` (new/updated/malformed + store reset on session end), `hooks/useFocusMessage.test.ts` (found, paging, give-up, idle), `pages/NotificationsPage.test.tsx` (10 flows: list, resolve, discard requires note, 409, 503, live insert, closed by other with dialog open, resolved tab, missing file, open chat state), `components/NotificationToast.test.tsx`. **Bug found by tests**: `formatRelative` ignored its `now` argument (`formatDistanceToNowStrict`), fixed with `formatDistanceStrict(date, now)`.

### Task 13 — Verification
Status: ✅ Done
Notes: `npm run build` OK (only the pre-existing >500 kB chunk warning). `vitest run`: 222/222 pass. ESLint on every changed/new file: clean (`eslint .` still reports 28 pre-existing errors in untouched files). §16.1: no `backdrop-blur`, `scroll-smooth` or `will-change` in new code; modal `max-h-[90vh]` with internal scroll; the only animations are finite (row/message highlight) or skeletons bounded to 6 rows. CLAUDE.md §15: WS handlers via `useCallback` with stable deps, stores read with fine selectors or `getState()`, single socket reused. Routes via `ROUTES`. Not verified in a real browser against the backend (no manual E2E run in this session).

### Task 15 — Bounded review and corrections
Status: ✅ Done
Notes: `gentle-ai review start` → high risk, four lenses (risk, resilience, readability, reliability), run as parallel read-only reviewers. No BLOCKER/CRITICAL. Fixed: WS payload guard requires client/conversation/attachments (risk-1); stale "Cargar más" ignored entirely, separate load/more errors (res-1); `pageLoaded` reconciles with live state — rows closed in flight are not listed, live inserts survive a reload (`liveIds`) (res-2/rel-3); after a 503 the refetch only counts as our close if `resolved_by` is this advisor with the requested status (res-3); `loadMoreMessages` returns `null` when busy so the deep link waits instead of giving up (res-4/rel-2); the deep link is marked handled only after the scroll ran (rel-1); HTTP `pending_count` ignored when a fresher WS count arrived (`setPendingCountSnapshot`) (res-5/rel-4); close dialog visibility derived from row status + `isClosing`, toast once per dialog (res-6); readability leftovers removed (read-1..8); new tests incl. `useNotificationsBadgeSync.test.ts` (rel-5). **risk-2 resolved by the contract update**: attachments are now `{wam_id}` only and `payload` is always `{}` — no file URL nor read payment data reaches the panel. Review finalized as approved.

### Task 16 — No payment details, three actions
Status: ✅ Done
Notes: See design "Revisión 2". Tests assert the amount/payment data never render in the row or toast.
