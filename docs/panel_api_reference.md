# Panel Web — API Reference

## Overview

**Base URL:** `/api/v1/panel`

**Authentication:** All endpoints except the debug token endpoint require a JWT in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

**Response envelope:** All successful responses follow this structure:

```json
{ "data": { ... } }
```

All error responses follow this structure:

```json
{ "detail": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

---

## Authentication

The frontend authenticates via `POST /api/v1/panel/auth/token` — **never directly against Supabase Auth**. The backend validates the credentials, verifies the advisor is active in the `advisors` table, and returns the Supabase-issued JWT. Calling Supabase Auth directly from the frontend would bypass the `is_active` check, allowing deactivated advisors to obtain valid tokens.

The JWT is signed with **ES256** using Supabase's EC private key. FastAPI verifies it against the Supabase public JWK. The `sub` claim contains the advisor's UUID.

### POST /api/v1/panel/auth/token

**Auth required:** No

**Description:** Authenticates an advisor with email and password via Supabase Auth. Verifies the advisor exists in the `advisors` table and is active. Returns the ES256 JWT issued by Supabase.

**Request body:**

```json
{
  "email": "asesor@casasyespacios.co",
  "password": "secretpassword"
}
```

**Response 200:**

```json
{
  "access_token": "***REMOVED***",
  "refresh_token": "***REMOVED***",
  "token_type": "bearer",
  "expires_in": 3600,
  "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
  "full_name": "Ana Gómez",
  "role": "asesor",
  "must_change_password": false
}
```

**`must_change_password`:** `true` for newly created advisors. The frontend should redirect them to a password change screen. Set to `false` via `PATCH /advisors/me` after the new password is established.

**Errors:**

| HTTP | ErrorCode          | When                                                        |
| ---- | ------------------ | ----------------------------------------------------------- |
| 401  | `INVALID_TOKEN`    | Wrong email or password                                     |
| 401  | `INVALID_TOKEN`    | Supabase Auth user exists but no matching row in `advisors` |
| 403  | `ADVISOR_INACTIVE` | Advisor exists but `is_active = false`                      |
| 503  | `INVALID_TOKEN`    | Connection error to Supabase Auth                           |

---

### POST /api/v1/panel/auth/token/refresh

**Auth required:** No

**Description:** Renews the `access_token` using a valid `refresh_token`. The frontend interceptor should call this automatically before the `access_token` expires. On failure, the frontend must redirect to `/login`.

**Request body:**

```json
{
  "refresh_token": "***REMOVED***"
}
```

**Response 200:**

```json
{
  "access_token": "***REMOVED***",
  "refresh_token": "***REMOVED***",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

**Errors:**

| HTTP | ErrorCode       | When                                                                    |
| ---- | --------------- | ----------------------------------------------------------------------- |
| 401  | `INVALID_TOKEN` | `refresh_token` invalid or expired — frontend must redirect to `/login` |
| 503  | `INVALID_TOKEN` | Connection error to Supabase Auth                                       |

---

### POST /api/v1/panel/auth/logout

**Auth required:** Yes (any active advisor)

**Description:** Invalidates the advisor's session in Supabase Auth. Revokes the `refresh_token` associated with the session — the current JWT remains valid until natural expiry (~1h) but cannot be renewed. The frontend must clear the token from local storage regardless of the response.

No request body required.

**Response 200:**

```json
{
  "data": {
    "message": "Logged out"
  }
}
```

**Notes:**

- If the backend fails to reach Supabase Auth (timeout, network error), it still returns 200 — the frontend must always remove the local token.
- Calling this endpoint does not close active conversations or change the advisor's status — it only invalidates the auth session.

## Conversations

### GET /api/v1/panel/conversations/

**Auth required:** Yes (any active advisor)

**Description:** Paginated list of conversations for the inbox tray. Ordered by `last_activity` DESC. Advisors see only conversations in their area or channel. Admins see all conversations.

**Query params:**

| Param     | Type      | Default | Description                                                              |
| --------- | --------- | ------- | ------------------------------------------------------------------------ |
| `status`  | `string`  | none    | Filter by status: `activa`, `escalada`, `cerrada`, or `mine` (see below) |
| `channel` | `string`  | none    | Filter by channel: `administrativa`, `comercial`                         |
| `limit`   | `integer` | 20      | Page size (1–100)                                                        |
| `offset`  | `integer` | 0       | Pagination offset                                                        |

**Response 200:**

```json
{
  "data": {
    "conversations": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "status": "escalada",
        "bot_activo": false,
        "channel": "administrativa",
        "last_activity": "2026-06-22T14:35:00+00:00",
        "intent": "cartera",
        "resolution_type": null,
        "resolution_notes": null,
        "client_satisfied": null,
        "closed_by": null,
        "closed_by_advisor": null,
        "closed_at": null,
        "unread_count": 0,
        "case_number": "CE-2026-000043",
        "priority": "alta",
        "whatsapp_window_expires_at": "2026-09-20T20:15:00+00:00",
        "client": {
          "id": "550e8400-e29b-41d4-a716-446655440020",
          "phone_number": "+573001234567",
          "bsuid": null,
          "user_name": null,
          "email": null,
          "full_name": "Carlos Rodríguez",
          "document_id": "1020304050",
          "client_type": "propietario"
        },
        "escalation": {
          "id": "550e8400-e29b-41d4-a716-446655440030",
          "reason": "solicitud_usuario",
          "escalated_at": "2026-06-22T14:20:00+00:00",
          "wait_seconds": 900,
          "advisor": {
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "full_name": "Ana Gómez",
            "area": "administrativa",
            "specialty": "financiera"
          }
        },
        "last_message": {
          "msg_type": "text",
          "content": "Necesito ayuda con mi contrato"
        }
      }
    ],
    "total": 42,
    "limit": 20,
    "offset": 0
  }
}
```

**Errors:**

| HTTP | ErrorCode          | When                                            |
| ---- | ------------------ | ----------------------------------------------- |
| 400  | `INVALID_STATUS`   | `status` query param has an unrecognized value  |
| 400  | `INVALID_STATUS`   | `channel` query param has an unrecognized value |
| 401  | `INVALID_TOKEN`    | Missing or invalid JWT                          |
| 403  | `ADVISOR_INACTIVE` | Advisor account is deactivated                  |

**Notes:**

- The `escalation.wait_seconds` field is computed at request time as the number of seconds since `escalated_at`.
- An `escalation` object is included only if there is an unresolved escalation (`resolved_at IS NULL`).
- Advisors with `area = "ambas"` see conversations from both channels.
- **`status=mine`** is a special filter that returns only the conversations with an active escalation assigned to the authenticated advisor (i.e., the "My conversations" tab). It can be combined freely with `channel`. Admins using `mine` see only conversations assigned to themselves — not all conversations.
- **`last_message`** is the most recent inbound (client) message of the conversation. It is `null` if the client has not sent any message yet. Only `msg_type` and `content` are included; for non-text messages `content` may be `null`.
- **`case_number`** is a human-readable, unique case reference in the format `CE-YYYY-NNNNNN` (e.g. `CE-2026-000043`), generated atomically in Postgres when the conversation is created. It is `null` for conversations created before this feature was deployed — render `—` (or similar) in that case. It never changes for the lifetime of the conversation, including when a closed conversation is transparently reused within the grace window (see `CLAUDE.md` §3.6.1) — the reused conversation keeps its original `case_number`.
- **`priority`** is one of `baja`, `media`, `alta`, `critica` — always present, defaults to `baja` for every conversation. Set **exclusively** by the bot's `evaluate_priority` node based on the client's tone/urgency each turn; there is no endpoint or panel control to set it manually. It is **monotonic**: it only ever increases within a conversation, never decreases. Use it to sort/highlight the inbox (e.g. badge color, default sort by priority then `last_activity`). Real-time updates also arrive via the `conversation.priority_updated` WebSocket event (see below) — no need to re-fetch the list to keep badges current.
- **`whatsapp_window_expires_at`** is the instant Meta's 24-hour customer service window closes for this conversation, in ISO-8601 UTC — or `null`. See **The 24-hour window** in the Frontend Integration Guide before using it.

---

### GET /api/v1/panel/conversations/{conversation_id}

**Auth required:** Yes (any active advisor; area-restricted for non-admins)

**Description:** Full conversation detail with client info, active escalation, and paginated message history.

**Path params:**

| Param             | Type            | Description         |
| ----------------- | --------------- | ------------------- |
| `conversation_id` | `string` (UUID) | The conversation ID |

**Query params:**

| Param    | Type      | Default | Description                                                   |
| -------- | --------- | ------- | ------------------------------------------------------------- |
| `limit`  | `integer` | 50      | Number of messages to fetch (1–100)                           |
| `offset` | `integer` | 0       | Message pagination offset — see **Pagination contract** below |

**Pagination contract (`messages` / `total_messages`):**

`offset` counts backward from the **most recent** message, not forward from the oldest one. The server sorts messages `timestamp DESC, created_at DESC` (the `created_at` tiebreaker guarantees a deterministic order even for messages inserted within the same second — see **Ordering guarantee** below), takes the `[offset, offset + limit)` window, then reverses it back to ascending order before returning it — so the `messages` array itself is always chronological (oldest → newest), but which slice of history you get depends on `offset`:

- `offset=0` (the default) returns the **latest** `limit` messages — always use this to open a chat.
- To load older history (infinite scroll upward), increase `offset` by the number of messages already loaded (see the `/messages` endpoint below). Do **not** decrease `offset` or use `total_messages - limit` to "jump to the end" — `offset=0` already **is** the end.
- Stop paginating once `offset >= total_messages`.

**Ordering guarantee:** the backend serializes processing of messages from the same client (`phone_number`) end-to-end, so `INSERT` order into `messages` always matches the real arrival order of the client's WhatsApp messages — even when several arrive within the same second via concurrent webhook deliveries. No API contract change; this only affects internal ordering reliability. Same guarantee applies to the `message.new` WebSocket event below (a per-connection send lock prevents two near-simultaneous events from corrupting delivery to the same advisor socket).

**Response 200:**

```json
{
  "data": {
    "conversation": {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "status": "escalada",
      "bot_activo": false,
      "channel": "administrativa",
      "resolution_type": null,
      "resolution_notes": null,
      "client_satisfied": null,
      "closed_by": null,
      "closed_by_advisor": null,
      "closed_at": null,
      "case_number": "CE-2026-000043",
      "priority": "alta",
      "whatsapp_window_expires_at": "2026-09-20T20:15:00+00:00",
      "client": {
        "id": "550e8400-e29b-41d4-a716-446655440020",
        "full_name": "Carlos Rodríguez",
        "phone_number": "+573001234567",
        "bsuid": null,
        "user_name": null,
        "email": null,
        "document_id": "1020304050",
        "client_type": "propietario"
      },
      "escalation": {
        "id": "550e8400-e29b-41d4-a716-446655440030",
        "reason": "solicitud_usuario",
        "summary": "Cliente solicita revisión de saldo de cartera correspondiente al mes de mayo.",
        "escalated_at": "2026-06-22T14:20:00+00:00",
        "advisor": {
          "id": "550e8400-e29b-41d4-a716-446655440001",
          "full_name": "Ana Gómez"
        }
      },
      "messages": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440050",
          "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
          "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUC",
          "direction": "inbound",
          "msg_type": "text",
          "content": "Buenos días, necesito información sobre mi cartera.",
          "media_url": null,
          "media_mime_type": null,
          "media_size_bytes": null,
          "transcription": null,
          "delivered_via": "webhook_meta",
          "timestamp": "2026-06-22T14:05:00+00:00",
          "created_at": "2026-06-22T14:05:01+00:00",
          "advisor_name": null
        }
      ],
      "total_messages": 8
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                   | When                                                     |
| ---- | --------------------------- | -------------------------------------------------------- |
| 401  | `INVALID_TOKEN`             | Missing or invalid JWT                                   |
| 403  | `ADVISOR_INACTIVE`          | Advisor account is deactivated                           |
| 403  | `CONVERSATION_OUTSIDE_AREA` | Advisor's area does not match the conversation's channel |
| 404  | `CONVERSATION_NOT_FOUND`    | No conversation with the given ID                        |

---

### GET /api/v1/panel/conversations/{conversation_id}/messages

**Auth required:** Yes (any active advisor; area-restricted for non-admins)

**Description:** Paginated message history for a conversation. The returned `messages` array is always ordered `timestamp` ASC (oldest first), but `offset` counts backward from the most recent message — see **Pagination contract** below. Use this endpoint for infinite-scroll pagination after the initial load via the conversation detail endpoint.

**Path params:**

| Param             | Type            | Description         |
| ----------------- | --------------- | ------------------- |
| `conversation_id` | `string` (UUID) | The conversation ID |

**Query params:**

| Param    | Type      | Default | Description                                                                                      |
| -------- | --------- | ------- | ------------------------------------------------------------------------------------------------ |
| `limit`  | `integer` | 20      | Page size (1–100)                                                                                |
| `offset` | `integer` | 0       | Pagination offset, counted back from the most recent message — see **Pagination contract** below |

**Pagination contract:** same as `GET /conversations/{conversation_id}` — `offset=0` is the latest window; to walk backward in history, call again with `offset = offset + messages.length` from the previous response. Stop once `offset >= total`.

**Response 200:**

```json
{
  "data": {
    "messages": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440050",
        "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
        "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUC",
        "direction": "inbound",
        "msg_type": "text",
        "content": "Buenos días, necesito información sobre mi cartera.",
        "media_url": null,
        "media_mime_type": null,
        "media_size_bytes": null,
        "transcription": null,
        "delivered_via": "webhook_meta",
        "timestamp": "2026-06-22T14:05:00+00:00",
        "created_at": "2026-06-22T14:05:01+00:00",
        "advisor_name": null
      },
      {
        "id": "550e8400-e29b-41d4-a716-446655440051",
        "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
        "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUD",
        "direction": "inbound",
        "msg_type": "audio",
        "content": null,
        "media_url": "https://xxxx.supabase.co/storage/v1/object/sign/casas-y-espacios-media/inbound/conv-uuid/wamid_audio?token=...",
        "media_mime_type": "audio/ogg; codecs=opus",
        "media_size_bytes": null,
        "transcription": "Hola, quiero saber cuánto debo de arriendo este mes.",
        "delivered_via": "webhook_meta",
        "timestamp": "2026-06-22T14:06:00+00:00",
        "created_at": "2026-06-22T14:06:01+00:00",
        "advisor_name": null
      },
      {
        "id": "550e8400-e29b-41d4-a716-446655440052",
        "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
        "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUE",
        "direction": "outbound_advisor",
        "msg_type": "text",
        "content": "Hola, con gusto le ayudo. Le comparto el estado de cuenta.",
        "media_url": null,
        "media_mime_type": null,
        "media_size_bytes": null,
        "transcription": null,
        "delivered_via": "websocket_panel",
        "timestamp": "2026-06-22T14:07:00+00:00",
        "created_at": "2026-06-22T14:07:01+00:00",
        "advisor_name": "Ana Gómez"
      }
    ],
    "total": 8,
    "limit": 20,
    "offset": 0
  }
}
```

**Message field reference:**

| Field           | Type             | Description                                                                                                                                                              |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `msg_type`      | `string`         | `"text"`, `"audio"`, `"image"`, `"video"`, `"document"`                                                                                                                  |
| `content`       | `string \| null` | Text content. Non-null only for `msg_type = "text"`                                                                                                                      |
| `media_url`     | `string \| null` | Signed Supabase Storage URL (valid 1 year). Non-null for `audio`, `image`, `video`, `document`. Always a full HTTPS URL — never a raw Meta media ID                      |
| `transcription` | `string \| null` | Whisper transcription of the audio. Non-null only for `msg_type = "audio"` that the bot processed. `null` for audio sent by the advisor or processed before this feature |
| `advisor_name`  | `string \| null` | Full name of the advisor who sent the message. Non-null only when `direction = "outbound_advisor"`. `null` for `inbound` and `outbound_bot` messages                     |

**Audio rendering rule — important:**

When `msg_type = "audio"`, **always render an audio player** using `media_url`. Do **not** display `transcription` as message text — it is internal context used by the AI agent to maintain conversation history. If you want to offer a "show transcript" affordance (e.g., a toggle below the player), you may use `transcription` for that, but it should be hidden by default.

```
msg_type = "audio"  →  render <audio src={media_url} />  (transcription is NOT shown)
msg_type = "text"   →  render content as text
msg_type = "image"  →  render <img src={media_url} />
msg_type = "video"  →  render <video src={media_url} />
msg_type = "document" → render download link using media_url
```

**Errors:**

| HTTP | ErrorCode                   | When                                                     |
| ---- | --------------------------- | -------------------------------------------------------- |
| 401  | `INVALID_TOKEN`             | Missing or invalid JWT                                   |
| 403  | `CONVERSATION_OUTSIDE_AREA` | Advisor's area does not match the conversation's channel |
| 404  | `CONVERSATION_NOT_FOUND`    | No conversation with the given ID                        |

---

### POST /api/v1/panel/conversations/{conversation_id}/reply

**Auth required:** Yes (assigned advisor or admin)

**Description:** Sends a text message from the advisor to the client via the Meta WhatsApp API. Saves the message to the database, updates `last_activity`, emits a `message.new` WebSocket event, and runs background moderation on the message content.

**Path params:**

| Param             | Type            | Description         |
| ----------------- | --------------- | ------------------- |
| `conversation_id` | `string` (UUID) | The conversation ID |

**Request body:**

```json
{
  "text": "Hola Carlos, con gusto le ayudo con la información de su cartera."
}
```

| Field  | Type     | Constraints                              |
| ------ | -------- | ---------------------------------------- |
| `text` | `string` | Required, non-empty, max 4096 characters |
| `client_message_id` | `string` (UUID) | Optional. Client-generated idempotency key, see below |

`client_message_id` makes a retry idempotent: the panel generates one UUID per message when the advisor sends and reuses it on every retry. If a message with that id already exists in the conversation, the backend returns that existing message (same `200` envelope) and does **not** send to WhatsApp again.

**Response 200:**

```json
{
  "data": {
    "message": {
      "id": "550e8400-e29b-41d4-a716-446655440055",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUB",
      "direction": "outbound_advisor",
      "msg_type": "text",
      "content": "Hola Carlos, con gusto le ayudo con la información de su cartera.",
      "media_url": null,
      "media_mime_type": null,
      "media_size_bytes": null,
      "delivered_via": "websocket_panel",
      "timestamp": "2026-06-22T14:36:00+00:00",
      "created_at": "2026-06-22T14:36:00+00:00"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                   | When                                                                        |
| ---- | --------------------------- | --------------------------------------------------------------------------- |
| 400  | `EMPTY_MESSAGE`             | `text` is empty or whitespace only                                          |
| 400  | `MESSAGE_TOO_LONG`          | `text` exceeds 4096 characters                                              |
| 401  | `INVALID_TOKEN`             | Missing or invalid JWT                                                      |
| 403  | `ADVISOR_INACTIVE`          | Advisor account is deactivated                                              |
| 403  | `BOT_IS_ACTIVE`             | Bot currently controls the conversation                                     |
| 403  | `NOT_ASSIGNED`              | Advisor is not the assigned advisor for this conversation (non-admins only) |
| 403  | `CONVERSATION_OUTSIDE_AREA` | Conversation channel doesn't match the advisor's area                       |
| 404  | `CONVERSATION_NOT_FOUND`    | No conversation with the given ID                                           |
| 409  | `WINDOW_EXPIRED`            | Meta's 24h customer service window is closed — see below                    |
| 502  | `META_API_ERROR`            | WhatsApp API call failed or the line record was not found                   |

**Notes:**

- Background moderation runs asynchronously via `asyncio.create_task`. If moderation detects inappropriate content, a `behavior.alert` WebSocket event is emitted to admins only.
- The message is persisted and the WhatsApp delivery happens before the response is returned. If Meta API fails, no message is saved.
- Admins can reply to any conversation in their area regardless of assignment.

**WebSocket events emitted:**

- `message.new` — broadcast to all connected advisors

---

### POST /api/v1/panel/conversations/{conversation_id}/reply/media

**Auth required:** Yes (assigned advisor or admin)

**Description:** Sends a media file (image, video, or document) to the client. Uses `multipart/form-data`. Uploads the file to Supabase Storage, generates a signed URL valid for 1 year, then sends via Meta API.

**Path params:**

| Param             | Type            | Description         |
| ----------------- | --------------- | ------------------- |
| `conversation_id` | `string` (UUID) | The conversation ID |

**Request body:** `multipart/form-data`

| Field     | Type     | Description                             |
| --------- | -------- | --------------------------------------- |
| `file`    | `File`   | Required. The media file                |
| `caption` | `string` | Optional. Caption for images and videos |
| `client_message_id` | `string` (UUID) | Optional. Client-generated idempotency key: a repeated id returns the existing message and does not send again |

**Allowed MIME types and size limits:**

| MIME type                                                                 | Max size |
| ------------------------------------------------------------------------- | -------- |
| `image/jpeg`                                                              | 5 MB     |
| `image/png`                                                               | 5 MB     |
| `image/webp`                                                              | 5 MB     |
| `video/mp4`                                                               | 16 MB    |
| `video/3gpp`                                                              | 16 MB    |
| `application/pdf`                                                         | 20 MB    |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 20 MB    |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`       | 20 MB    |

**Response 200:**

```json
{
  "data": {
    "message": {
      "id": "550e8400-e29b-41d4-a716-446655440056",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUC",
      "direction": "outbound_advisor",
      "msg_type": "image",
      "content": "Estado de cuenta mayo 2026",
      "media_url": "https://xxxx.supabase.co/storage/v1/object/sign/outbound/...",
      "media_mime_type": "image/jpeg",
      "media_size_bytes": 204800,
      "delivered_via": "websocket_panel",
      "timestamp": "2026-06-22T14:37:00+00:00",
      "created_at": "2026-06-22T14:37:00+00:00"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                   | When                                                    |
| ---- | --------------------------- | ------------------------------------------------------- |
| 400  | `FILE_TYPE_NOT_ALLOWED`     | MIME type is not in the allowed list                    |
| 400  | `FILE_TOO_LARGE`            | File exceeds the size limit for its MIME type           |
| 401  | `INVALID_TOKEN`             | Missing or invalid JWT                                  |
| 403  | `BOT_IS_ACTIVE`             | Bot currently controls the conversation                 |
| 403  | `NOT_ASSIGNED`              | Advisor is not the assigned advisor                     |
| 403  | `CONVERSATION_OUTSIDE_AREA` | Conversation channel doesn't match advisor's area       |
| 404  | `CONVERSATION_NOT_FOUND`    | No conversation with the given ID                       |
| 409  | `WINDOW_EXPIRED`            | Meta's 24h window is closed — see below                 |
| 502  | `META_API_ERROR`            | WhatsApp API call failed                                |
| 503  | `STORAGE_ERROR`             | Supabase Storage upload or signed URL generation failed |

**Notes:**

- If Meta API fails after the file has already been uploaded to Storage, the file remains in Storage but no message is created. This is a known trade-off.
- `msg_type` in the response is derived from the MIME type: `image/*` → `"image"`, `video/*` → `"video"`, everything else → `"document"`.

**WebSocket events emitted:**

- `message.new` — broadcast to all connected advisors

---

### POST /api/v1/panel/conversations/{conversation_id}/reply/audio

**Auth required:** Yes (assigned advisor or admin)

**Description:** Sends a voice note to the client. Uses `multipart/form-data`. Uploads the audio to Supabase Storage and sends via Meta API.

**Path params:**

| Param             | Type            | Description         |
| ----------------- | --------------- | ------------------- |
| `conversation_id` | `string` (UUID) | The conversation ID |

**Request body:** `multipart/form-data`

| Field  | Type   | Description              |
| ------ | ------ | ------------------------ |
| `file` | `File` | Required. The audio file |
| `client_message_id` | `string` (UUID) | Optional. Client-generated idempotency key: a repeated id returns the existing message and does not send again |

**Allowed MIME types:** `audio/ogg`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/amr`

**Max size:** 16 MB

**Response 200:**

```json
{
  "data": {
    "message": {
      "id": "550e8400-e29b-41d4-a716-446655440057",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUD",
      "direction": "outbound_advisor",
      "msg_type": "audio",
      "content": null,
      "media_url": "https://xxxx.supabase.co/storage/v1/object/sign/outbound/...",
      "media_mime_type": "audio/ogg",
      "media_size_bytes": 102400,
      "delivered_via": "websocket_panel",
      "timestamp": "2026-06-22T14:38:00+00:00",
      "created_at": "2026-06-22T14:38:00+00:00"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                   | When                                                    |
| ---- | --------------------------- | ------------------------------------------------------- |
| 400  | `FILE_TYPE_NOT_ALLOWED`     | MIME type is not in the allowed audio list              |
| 400  | `FILE_TOO_LARGE`            | Audio file exceeds 16 MB                                |
| 401  | `INVALID_TOKEN`             | Missing or invalid JWT                                  |
| 403  | `BOT_IS_ACTIVE`             | Bot currently controls the conversation                 |
| 403  | `NOT_ASSIGNED`              | Advisor is not the assigned advisor                     |
| 403  | `CONVERSATION_OUTSIDE_AREA` | Conversation channel doesn't match advisor's area       |
| 404  | `CONVERSATION_NOT_FOUND`    | No conversation with the given ID                       |
| 409  | `WINDOW_EXPIRED`            | Meta's 24h window is closed — see below                 |
| 502  | `META_API_ERROR`            | WhatsApp API call failed or line not found              |
| 502  | `STORAGE_ERROR`             | Supabase Storage upload or signed URL generation failed |

**WebSocket events emitted:**

- `message.new` — broadcast to all connected advisors

---

### PATCH /api/v1/panel/conversations/{conversation_id}/assign

**Auth required:** Yes (any active advisor)

**Description:** The authenticated advisor self-assigns to an escalated conversation. No request body. The advisor becomes the assigned advisor on the active escalation record, and the conversation status is set to `activa`.

**Path params:**

| Param             | Type            | Description                |
| ----------------- | --------------- | -------------------------- |
| `conversation_id` | `string` (UUID) | The conversation to assign |

**Response 200:**

```json
{
  "data": {
    "escalation": {
      "id": "550e8400-e29b-41d4-a716-446655440030",
      "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
      "advisor_name": "Ana Gómez"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                    | When                                                              |
| ---- | ---------------------------- | ----------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`              | Missing or invalid JWT                                            |
| 403  | `ADVISOR_INACTIVE`           | Advisor account is deactivated                                    |
| 403  | `CONVERSATION_OUTSIDE_AREA`  | Conversation's channel is outside the advisor's area              |
| 404  | `CONVERSATION_NOT_FOUND`     | No conversation with the given ID                                 |
| 409  | `CONVERSATION_NOT_ESCALATED` | Conversation status is not `escalada` or has no active escalation |
| 409  | `ALREADY_ASSIGNED`           | Another advisor is already assigned to this escalation            |
| 409  | `MAX_CONVERSATIONS_REACHED`  | Advisor has reached their `max_conversations` limit               |

**Notes:**

- The `MAX_CONVERSATIONS_REACHED` error message includes the current and maximum counts: `"Tienes X de Y conversaciones activas — llegaste al límite"`.
- After a successful assign, the conversation `status` transitions from `escalada` → `activa`.
- Race condition: two advisors clicking "take conversation" simultaneously can both pass the `ALREADY_ASSIGNED` check if the read happens before either write completes. There is no optimistic lock on this operation.

**WebSocket events emitted:**

- `escalation.assigned` — broadcast to all connected advisors

---

### PATCH /api/v1/panel/conversations/{conversation_id}/take-control

> ⚠️ **Deployment status:** requires a DB migration (new `escalations.reason` value + a uniqueness constraint) — **applied in DEV** (2026-09-14), **still pending in production**. If this endpoint 500s specifically on a conversation the bot is still actively handling (not yet `escalada`), check with backend whether the migration has landed in that environment before assuming a frontend bug. See `specs/human_handover_direct_control/03-design.md`.

**Auth required:** Yes (any active advisor — see Notes on area restriction)

**Description:** Takes **direct manual control** of any non-closed conversation immediately, without requiring the bot to have escalated it first. Unlike `assign`, this works on a conversation the bot is still actively handling (`status = "activa"`, `bot_activo = true`) as well as on one already `escalada`. No request body — the caller always takes control for themselves.

Internally this creates (or claims) an `escalations` row with `reason = "control_manual_directo"` and `advisor_id` set to the caller, and sets `bot_activo = false` + `status = "escalada"` on the conversation — the same state shape `assign` produces, so every other endpoint and WebSocket event that reads escalation/`bot_activo` state (inbox filters, `GET /conversations/{id}`, etc.) treats a directly-taken conversation identically to a bot-escalated one. The only visible difference is `escalation.reason`.

**Path params:**

| Param             | Type            | Description                         |
| ----------------- | --------------- | ----------------------------------- |
| `conversation_id` | `string` (UUID) | The conversation to take control of |

**Response 200:**

```json
{
  "data": {
    "conversation": {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "bot_activo": false,
      "status": "escalada"
    },
    "escalation": {
      "id": "550e8400-e29b-41d4-a716-446655440031",
      "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
      "advisor_name": "Ana Gómez"
    }
  }
}
```

Also returned with `200` (unchanged, no new writes) if the caller already had control — see Notes.

**Errors:**

| HTTP | ErrorCode                 | When                                                                                                                         |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`           | Missing or invalid JWT                                                                                                       |
| 403  | `ADVISOR_INACTIVE`        | Advisor account is deactivated                                                                                               |
| 404  | `CONVERSATION_NOT_FOUND`  | No conversation with the given ID                                                                                            |
| 409  | `CONVERSATION_NOT_ACTIVE` | Conversation `status` is already `cerrada` — control cannot be taken over a closed conversation                              |
| 409  | `CONTROL_ALREADY_TAKEN`   | Another advisor already has control — `message` names them (e.g. `"Mariana Rojas ya tiene el control de esta conversación"`) |

**Notes:**

- **No area/channel restriction, unlike every other mutating endpoint in this file.** Any active advisor — regardless of `area`/`specialty`, and regardless of the conversation's `channel` — can take control of any non-closed conversation. This is deliberate (see `specs/human_handover_direct_control/02-clarification.md`, Q1): the whole point is letting whoever notices a conversation needs a human step in immediately, not gate it behind routing.
- **Idempotent for the same caller:** calling this again while you already hold control returns `200` with the existing state, writes nothing new, and emits no new WebSocket event or client-facing message. Safe to retry on a network timeout.
- **No override — first to take it wins.** If another advisor already has control, this always returns `409 CONTROL_ALREADY_TAKEN`, even for admins. There is no "steal control" action.
- **Does not count against `max_conversations`.** Unlike `assign`, taking direct control has no capacity limit — an advisor can hold as many directly-taken conversations as they judge necessary.
- A real-time-safe concurrency guarantee backs this (a DB-level unique constraint, not app-side locking), so two advisors racing to take the same free conversation cannot both succeed — the loser always gets a `409 CONTROL_ALREADY_TAKEN` naming the winner.
- On success, the client also receives a WhatsApp message announcing a human has taken over — sent best-effort (a WhatsApp delivery failure never blocks the `200` response).
- To release control, use the **existing** `return-bot` endpoint below — there is no separate "release direct control" endpoint. It already resolves whatever escalation is active (bot-created or directly-taken) and reactivates the bot.

**WebSocket events emitted:**

- `conversation.control_taken` — broadcast to all connected advisors (skipped entirely on the idempotent 200 case)
- `message.new` — the WhatsApp handover notice, routed the same as any advisor-authored message

---

### PATCH /api/v1/panel/conversations/{conversation_id}/reopen

**Auth required:** Yes (any active advisor — same no-restriction rule as `take-control`)

**Description:** Reopens a **closed** (`status = "cerrada"`) conversation while the WhatsApp 24h customer-service window (`whatsapp_window_expires_at`) is still open, so the advisor can reply with a free-form message instead of a Meta-approved template. Works identically regardless of why the conversation was closed — a normal close or a night inactivity auto-close (`resolution_type`/`closed_by` are never inspected). No request body.

Internally this is the same state transition as `take-control`: creates an `escalations` row with `reason = "control_manual_directo"` and `advisor_id` set to the caller, then sets `bot_activo = false` + `status = "escalada"` via the same atomic update. The original close fields (`closed_at`, `resolution_type`, `resolution_notes`, `closed_by`) are left untouched as history of the previous cycle — reopening does not erase or overwrite them, and `case_number` stays the same (this is the same conversation continuing, not a new case).

**Path params:**

| Param             | Type            | Description                       |
| ----------------- | --------------- | --------------------------------- |
| `conversation_id` | `string` (UUID) | The closed conversation to reopen |

**Response 200:**

```json
{
  "data": {
    "conversation": {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "bot_activo": false,
      "status": "escalada",
      "case_number": "CE-2026-000029"
    },
    "escalation": {
      "id": "550e8400-e29b-41d4-a716-446655440031",
      "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
      "advisor_name": "Ana Gómez",
      "reason": "control_manual_directo"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                 | When                                                                                                       |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`           | Missing or invalid JWT                                                                                     |
| 403  | `ADVISOR_INACTIVE`        | Advisor account is deactivated                                                                             |
| 404  | `CONVERSATION_NOT_FOUND`  | No conversation with the given ID                                                                          |
| 409  | `CONVERSATION_NOT_CLOSED` | Conversation `status` is not `cerrada` — use `take-control` instead for a non-closed conversation          |
| 409  | `WINDOW_EXPIRED`          | `whatsapp_window_expires_at` is `null` (unknown) or already in the past — use an approved template instead |
| 409  | `CONTROL_ALREADY_TAKEN`   | Another advisor already holds an active escalation on this conversation (rare race) — `message` names them |
| 409  | `CLIENT_HAS_ACTIVE_CONVERSATION` | The client already has another `activa`/`escalada` conversation on the same line (they wrote again after the close). `detail.active_conversation` = `{id, status, bot_activo, case_number}` — open that one instead (take-control if `bot_activo`) |

**Notes:**

- **Fail-closed on an unknown window**, unlike the fail-open read `GET`/`reply` endpoints use for §3.43 (that one exists so an unrelated bug never blocks a reply to an already-incoming message). Here the advisor is initiating contact proactively, so a `null`/unknown window is always treated as expired — sending outside a real window triggers Meta error `131047`.
- **No area/channel restriction**, same as `take-control` — any active advisor or admin can reopen any closed conversation.
- **No capacity check.** Does not count against `max_conversations`, same rule as `take-control`.
- **No automatic client-facing message.** Unlike `take-control`, reopening sends nothing to the client — the advisor writes the first message manually via `reply`. This is deliberate: the "control taken" announcement on `take-control` makes sense when a bot conversation is being interrupted; reopening a conversation the client hasn't heard from doesn't have an equivalent moment to announce.
- Only reaches this endpoint's happy path when the window is genuinely still open — a conversation auto-closed by the `ventana_vencida` pass (§3.43) will always fail the window check here, so no separate filtering by `resolution_type` is needed on the frontend either.
- To release control again, use the **existing** `close` endpoint below (or `return-bot`, if the intent is to hand it back to the bot instead of closing).

**WebSocket events emitted:**

- `conversation.reopened` — broadcast to all connected advisors

---

### PATCH /api/v1/panel/conversations/{conversation_id}/return-bot

**Auth required:** Yes (assigned advisor or admin)

**Description:** Returns control of the conversation to the bot. Sets `bot_activo = true`, status to `activa`, and resolves the active escalation. No request body. Works identically whether the active escalation came from a bot escalation + `assign`, or from `take-control` — both leave the same `escalations` row shape, so this endpoint needs no special case for either.

**Path params:**

| Param             | Type            | Description                           |
| ----------------- | --------------- | ------------------------------------- |
| `conversation_id` | `string` (UUID) | The conversation to return to the bot |

**Response 200:**

```json
{
  "data": {
    "conversation": {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "bot_activo": true,
      "status": "activa"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                | When                                          |
| ---- | ------------------------ | --------------------------------------------- |
| 401  | `INVALID_TOKEN`          | Missing or invalid JWT                        |
| 403  | `ADVISOR_INACTIVE`       | Advisor account is deactivated                |
| 403  | `BOT_ALREADY_ACTIVE`     | Bot already controls this conversation        |
| 403  | `NOT_ASSIGNED`           | Non-admin advisor is not the assigned advisor |
| 404  | `CONVERSATION_NOT_FOUND` | No conversation with the given ID             |

**WebSocket events emitted:**

- `conversation.returned` — broadcast to all connected advisors

---

### POST /api/v1/panel/conversations/{conversation_id}/transfer

**Auth required:** Yes (assigned advisor or admin)

**Description:** Transfers an active escalation directly to another advisor, without passing back through the bot. Reuses the same escalation record — only `advisor_id` (and, if provided, `transfer_reason`) are updated. Message history and `case_number` are untouched. If the target advisor's area differs from the conversation's current `channel`, the conversation's `channel` is updated to match.

**Path params:**

| Param             | Type            | Description                  |
| ----------------- | --------------- | ---------------------------- |
| `conversation_id` | `string` (UUID) | The conversation to transfer |

**Request body:**

| Field               | Type                  | Required | Description                                                                      |
| ------------------- | --------------------- | -------- | -------------------------------------------------------------------------------- |
| `target_advisor_id` | `string` (UUID)       | Yes      | The advisor who will receive the conversation                                    |
| `reason`            | `string` (≤500 chars) | No       | Free-text reason for the transfer, stored as `transfer_reason` on the escalation |

**Response 200:**

```json
{
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "case_number": "CE-2026-000042",
    "status": "activa",
    "channel": "administrativa",
    "escalation": {
      "id": "550e8400-e29b-41d4-a716-446655440030",
      "advisor_id": "550e8400-e29b-41d4-a716-446655440002",
      "transfer_reason": "Cliente pregunta por tema comercial"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                 | When                                                                                                        |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`           | Missing or invalid JWT                                                                                      |
| 403  | `ADVISOR_INACTIVE`        | Advisor account is deactivated                                                                              |
| 403  | `FORBIDDEN`               | Non-admin requester is not the advisor currently assigned to the escalation                                 |
| 404  | `CONVERSATION_NOT_FOUND`  | No conversation with the given ID, or a non-admin requester's area doesn't match the conversation's channel |
| 404  | `ADVISOR_NOT_FOUND`       | No advisor with the given `target_advisor_id`                                                               |
| 409  | `CONVERSATION_NOT_ACTIVE` | Conversation `status` is already `cerrada`                                                                  |
| 409  | `NO_ACTIVE_ESCALATION`    | Conversation has no unresolved escalation (`resolved_at IS NULL`) to transfer                               |
| 409  | `ALREADY_ASSIGNED`        | `target_advisor_id` is the same advisor already assigned                                                    |
| 409  | `INVALID_STATUS`          | Target advisor's `role` is not `asesor` (e.g. an admin), or is inactive / not `available`                   |
| 409  | `TARGET_AT_CAPACITY`      | Target advisor already has `max_conversations` active escalations                                           |

**Notes:**

- Only an advisor with `role = "asesor"` can be a transfer target — admins are excluded even if `is_active` and `available`, since they don't take conversations from the tray. This is enforced explicitly (there is no implicit exclusion via `availability_status`, since the background availability checker updates that field for admins too).
- Target capacity is checked via `count_active_for_advisor`, which only counts escalations belonging to conversations that are not closed.

**WebSocket events emitted:**

- `conversation.transferred` — targeted send to the source advisor, the target advisor, and all connected admins (not a full broadcast)

---

### PATCH /api/v1/panel/conversations/{conversation_id}/seen

**Auth required:** Yes (any active advisor)

**Description:** Marks the conversation as seen by resetting the unread message count to 0. Any active advisor can mark a conversation as seen (it does not have to be assigned to them).

**Path params:**

| Param             | Type            | Description                      |
| ----------------- | --------------- | -------------------------------- |
| `conversation_id` | `string` (UUID) | The conversation to mark as seen |

**Response 200:**

```json
{
  "data": {
    "unread_count": 0
  }
}
```

**Errors:**

| HTTP | ErrorCode                   | When                                                       |
| ---- | --------------------------- | ---------------------------------------------------------- |
| 401  | `INVALID_TOKEN`             | Missing or invalid JWT                                     |
| 403  | `ADVISOR_INACTIVE`          | Advisor account is deactivated                             |
| 403  | `CONVERSATION_OUTSIDE_AREA` | Advisor does not have access to the conversation's channel |
| 404  | `CONVERSATION_NOT_FOUND`    | No conversation with the given ID                          |

---

### PATCH /api/v1/panel/conversations/{conversation_id}/close

**Auth required:** Yes (assigned advisor or admin)

**Description:** Closes the conversation permanently and records how it was resolved. Sets `status = "cerrada"`, `bot_activo = false`, `closed_by = "asesor"`, and `closed_at = now()`. Resolves any active escalation. The request body is optional — omitting it applies the defaults (`resolution_type = "otro"`, `client_satisfied = "sin_confirmar"`).

**Path params:**

| Param             | Type            | Description               |
| ----------------- | --------------- | ------------------------- |
| `conversation_id` | `string` (UUID) | The conversation to close |

**Request body (all fields optional):**

```json
{
  "resolution_type": "consulta_cartera_resuelta",
  "resolution_notes": "El propietario confirmó recibo del estado de cuenta.",
  "client_satisfied": "si"
}
```

| Field              | Type               | Default           | Constraints                                                 |
| ------------------ | ------------------ | ----------------- | ----------------------------------------------------------- |
| `resolution_type`  | `string`           | `"otro"`          | Must be one of the `ResolutionType` enum values (see below) |
| `resolution_notes` | `string` or `null` | `null`            | Optional, max 1000 characters                               |
| `client_satisfied` | `string`           | `"sin_confirmar"` | `"si"`, `"no"`, or `"sin_confirmar"`                        |

**`resolution_type` allowed values:**

| Value                            | When to use                                        |
| -------------------------------- | -------------------------------------------------- |
| `consulta_cartera_resuelta`      | Cartera/balance inquiry answered satisfactorily    |
| `pago_acordado`                  | Payment agreement reached with the owner           |
| `orden_mantenimiento_creada`     | Maintenance work order created in SIMI             |
| `queja_pqrs_registrada`          | Complaint or PQR formally registered               |
| `informacion_contrato_entregada` | Lease or contract information delivered            |
| `derivado_otro_canal`            | Client redirected to another channel or department |
| `sin_respuesta_cliente`          | Client stopped responding                          |
| `consulta_resuelta_confirmada`   | Client explicitly confirmed the issue is resolved  |
| `ventana_vencida`                | Closed automatically: Meta's 24h window expired    |
| `otro`                           | Default. Use when no other type fits               |

**Response 200:**

```json
{
  "data": {
    "conversation": {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "status": "cerrada",
      "resolution_type": "consulta_cartera_resuelta",
      "resolution_notes": "El propietario confirmó recibo del estado de cuenta.",
      "client_satisfied": "si",
      "closed_by": "asesor",
      "closed_by_advisor": {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "full_name": "Ana Gómez"
      },
      "closed_at": "2026-06-23T14:30:00+00:00"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                | When                                                              |
| ---- | ------------------------ | ----------------------------------------------------------------- |
| 400  | `INVALID_STATUS`         | `resolution_type` or `client_satisfied` has an unrecognized value |
| 401  | `INVALID_TOKEN`          | Missing or invalid JWT                                            |
| 403  | `ADVISOR_INACTIVE`       | Advisor account is deactivated                                    |
| 403  | `NOT_ASSIGNED`           | Non-admin advisor is not the assigned advisor                     |
| 404  | `CONVERSATION_NOT_FOUND` | No conversation with the given ID                                 |
| 409  | `ALREADY_CLOSED`         | Conversation status is already `cerrada`                          |
| 422  | _(Pydantic)_             | `resolution_notes` exceeds 1000 characters                        |

**Notes:**

- `closed_by` is always set to `"asesor"` by this endpoint. Bot-initiated closure (see below) sets `"bot"`.
- `closed_by_advisor` identifies the specific advisor who closed the conversation (from the JWT). It is persisted in `conversations.closed_by_advisor_id` and returned as `{id, full_name}` in the conversation list and detail endpoints. It is `null` for bot closures and for historical closures that could not be backfilled — render "Bot" when `closed_by = "bot"`, the advisor's `full_name` when present, and a generic "Asesor" otherwise.
- The bot can close conversations in two ways: (1) the inactivity job closes after no client response to a follow-up message, and (2) the AI agent closes proactively when it detects a farewell or satisfaction signal from the client (e.g., "gracias, ya quedó", "adiós"). Both cases emit `conversation.closed` via WebSocket with `closed_by: "bot"` and no `advisor_id`.
- `resolution_notes` accepts `null` — sending `null` or omitting the field stores `NULL` in the database.

**WebSocket events emitted:**

- `conversation.closed` — broadcast to all connected advisors

---

## Clients

### GET /api/v1/panel/clients

**Auth required:** Yes (any active advisor — asesor or admin, no role restriction)

**Description:** Client directory ("Contactos") — every client in `clients` regardless of origin channel (administrativo or comercial). Each client includes their most recent commercial classification when they have at least one classified commercial conversation.

**Query params:**

| Param    | Type      | Default | Description                                                      |
| -------- | --------- | ------- | ---------------------------------------------------------------- |
| `q`      | `string`  | none    | Case-insensitive substring search over name, phone, document, and email |
| `limit`  | `integer` | 20      | Page size (1–100)                                                |
| `offset` | `integer` | 0       | Pagination offset                                                |

**Response 200:**

```json
{
  "data": {
    "clients": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440020",
        "phone_number": "+573001234567",
        "bsuid": null,
        "user_name": null,
        "email": null,
        "document_id": "1020304050",
        "full_name": "Carlos Rodríguez",
        "client_type": "propietario",
        "is_authenticated": true,
        "created_at": "2026-05-10T09:00:00+00:00",
        "commercial_classification": null
      },
      {
        "id": "550e8400-e29b-41d4-a716-446655440021",
        "phone_number": null,
        "bsuid": "CO.1A2B3C4D5E6F7G8H",
        "user_name": "ana.g",
        "email": "ana.g@correo.com",
        "document_id": null,
        "full_name": "Prospecto Nuevo",
        "client_type": "prospecto",
        "is_authenticated": false,
        "created_at": "2026-06-01T11:30:00+00:00",
        "commercial_classification": "potencial"
      }
    ],
    "total": 2,
    "limit": 20,
    "offset": 0
  }
}
```

**Errors:**

| HTTP | ErrorCode          | When                           |
| ---- | ------------------ | ------------------------------ |
| 401  | `INVALID_TOKEN`    | Missing or invalid JWT         |
| 403  | `ADVISOR_INACTIVE` | Advisor account is deactivated |

**Notes:**

- `client_type` is one of `arrendatario`, `propietario`, `prospecto`, `desconocido`.
- `commercial_classification` is `null` unless the client has at least one conversation with `intent = "comercial"` and a set `commercial_classification` (`potencial` / `no_potencial`). When a client has multiple classified commercial conversations over time, this is the classification from the **most recent** one (by `created_at`).
- This first version deliberately excludes a "contact client" action (depends on WhatsApp message templates — separate feature) and the full commercial requirement summary (only the classification badge is shown here).
- `bsuid` is a WhatsApp username-based identifier (support_bsuid_from_meta) — present only for contacts who reached the bot via username without ever sharing a phone number; display-only, never dialable.
- `email` is the address a commercial prospect gave the bot (stored lowercased, as-is); `null` when they never gave one — the common case for administrative clients. The panel shows it only when present.
- `user_name` is that contact's public WhatsApp username handle — the readable label to show in their row when `phone_number` is `null`, since a `bsuid` is an opaque string. See [Client identity](#client-identity-phone_number-and-bsuid).

---

## Advisors

### GET /api/v1/panel/advisors/me

**Auth required:** Yes (any active advisor)

**Description:** Returns the full profile of the authenticated advisor, including the current active conversation count fetched via Supabase RPC.

**Response 200:**

```json
{
  "data": {
    "advisor": {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "email": "ana.gomez@casasyespacios.co",
      "full_name": "Ana Gómez",
      "role": "asesor",
      "area": "administrativa",
      "specialty": "financiera",
      "max_conversations": 3,
      "active_conversations": 1,
      "availability_status": "available",
      "is_active": true,
      "must_change_password": true
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode          | When                           |
| ---- | ------------------ | ------------------------------ |
| 401  | `INVALID_TOKEN`    | Missing or invalid JWT         |
| 403  | `ADVISOR_INACTIVE` | Advisor account is deactivated |

**Notes:**

- `active_conversations` may return `0` if the Supabase RPC call fails — the failure is logged as a warning but does not surface as an error.
- `must_change_password` is `true` for newly created advisors. The `FirstLoginPage` flow sets it to `false` via `PATCH /advisors/me` after the advisor establishes their permanent password.

---

### GET /api/v1/panel/advisors/

**Auth required:** Yes (admin only)

**Description:** Lists all advisors in the system with their current active conversation count. All query params are optional and combinable.

**Query params:**

| Param       | Type      | Default | Description                                            |
| ----------- | --------- | ------- | ------------------------------------------------------ |
| `role`      | `string`  | none    | Filter by role: `asesor` or `admin`                    |
| `area`      | `string`  | none    | Filter by area: `administrativa`, `comercial`, `ambas` |
| `is_active` | `boolean` | none    | Filter by active status                                |

**Response 200:**

```json
{
  "data": {
    "advisors": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "email": "ana.gomez@casasyespacios.co",
        "full_name": "Ana Gómez",
        "role": "asesor",
        "area": "administrativa",
        "specialty": "financiera",
        "max_conversations": 3,
        "active_conversations": 2,
        "availability_status": "available",
        "is_active": true
      }
    ]
  }
}
```

**Errors:**

| HTTP | ErrorCode             | When                   |
| ---- | --------------------- | ---------------------- |
| 401  | `INVALID_TOKEN`       | Missing or invalid JWT |
| 403  | `FORBIDDEN`           | Caller is not an admin |
| 500  | `SUPABASE_AUTH_ERROR` | Database query failed  |

**Notes:**

- `active_conversations` is fetched via a separate RPC call per advisor. If the call fails for a given advisor, their count is set to `0`.

---

### POST /api/v1/panel/advisors/

**Auth required:** Yes (admin only)

**HTTP status on success:** 201 Created

**Description:** Creates a new advisor. Registers the user in Supabase Auth (creating a verified account) and inserts a row in the `advisors` table. If the profile insert fails after Auth user creation, the Auth user is rolled back.

**Request body:**

```json
{
  "email": "nuevo.asesor@casasyespacios.co",
  "password": "securepassword123",
  "full_name": "Luis Martínez",
  "role": "asesor",
  "area": "administrativa",
  "specialty": "mantenimiento_contratos",
  "max_conversations": 3
}
```

| Field               | Type               | Constraints                                               |
| ------------------- | ------------------ | --------------------------------------------------------- |
| `email`             | `string`           | Required                                                  |
| `password`          | `string`           | Required, min 8 characters                                |
| `full_name`         | `string`           | Required, min 1 character                                 |
| `role`              | `string`           | Required, must be `"asesor"` or `"admin"`                 |
| `area`              | `string`           | Required: `"administrativa"`, `"comercial"`, or `"ambas"` |
| `specialty`         | `string` or `null` | Optional. Must be valid for the given area (see notes)    |
| `max_conversations` | `integer`          | Default 3, range 1–10                                     |

**Response 201:**

```json
{
  "data": {
    "advisor": {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "email": "nuevo.asesor@casasyespacios.co",
      "full_name": "Luis Martínez",
      "role": "asesor",
      "area": "administrativa",
      "specialty": "mantenimiento_contratos",
      "max_conversations": 3,
      "active_conversations": 0,
      "availability_status": "available",
      "is_active": true
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode              | When                                                       |
| ---- | ---------------------- | ---------------------------------------------------------- |
| 401  | `INVALID_TOKEN`        | Missing or invalid JWT                                     |
| 403  | `FORBIDDEN`            | Caller is not an admin                                     |
| 409  | `EMAIL_ALREADY_EXISTS` | An advisor with this email already exists in Supabase Auth |
| 502  | `SUPABASE_AUTH_ERROR`  | Supabase Auth or DB error during creation                  |

**Notes — Specialty/Area validation:** Validated on both `POST` and `PATCH /{advisor_id}`. Valid combinations:

| Area             | Allowed specialties                                 |
| ---------------- | --------------------------------------------------- |
| `comercial`      | `"comercial"`, `null`                               |
| `administrativa` | `"financiera"`, `"mantenimiento_contratos"`, `null` |
| `ambas`          | `null` only                                         |

---

### PATCH /api/v1/panel/advisors/me

**Auth required:** Yes (any active advisor)

**Description:** Updates the authenticated advisor's own profile. Supports changing `full_name` and/or password. All fields are optional.

**Request body:**

```json
{
  "full_name": "Ana María Gómez",
  "current_password": "oldpassword123",
  "new_password": "newpassword456",
  "must_change_password": false
}
```

| Field                  | Type                | Constraints                                                     |
| ---------------------- | ------------------- | --------------------------------------------------------------- |
| `full_name`            | `string` or `null`  | Optional, min 1 character                                       |
| `current_password`     | `string` or `null`  | Required if `new_password` is provided                          |
| `new_password`         | `string` or `null`  | Optional, min 8 characters                                      |
| `must_change_password` | `boolean` or `null` | Optional. Only `false` is accepted — sending `true` returns 422 |

**Response 200:**

```json
{
  "data": {
    "advisor": {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "email": "ana.gomez@casasyespacios.co",
      "full_name": "Ana María Gómez",
      "role": "asesor",
      "area": "administrativa",
      "specialty": "financiera",
      "max_conversations": 3,
      "active_conversations": 1,
      "availability_status": "available",
      "is_active": true,
      "must_change_password": false
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                  | When                                                             |
| ---- | -------------------------- | ---------------------------------------------------------------- |
| 400  | `INVALID_CURRENT_PASSWORD` | `new_password` was provided but `current_password` was omitted   |
| 400  | `INVALID_CURRENT_PASSWORD` | `current_password` is incorrect                                  |
| 401  | `INVALID_TOKEN`            | Missing or invalid JWT                                           |
| 403  | `ADVISOR_INACTIVE`         | Advisor account is deactivated                                   |
| 422  | _(Pydantic)_               | `must_change_password: true` was sent — only `false` is accepted |
| 500  | `SUPABASE_AUTH_ERROR`      | Database or Auth update failed                                   |

**Notes:**

- `must_change_password` only accepts `false`. Use this after the advisor sets their permanent password on `FirstLoginPage`. Sending `true` returns 422.

---

### PATCH /api/v1/panel/advisors/me/availability

**Auth required:** Yes (any active advisor)

**Description:** Immediately changes the advisor's `availability_status`. Optionally accepts a `minutes` parameter to auto-restore `available` after the specified duration.

**Request body:**

```json
{
  "availability_status": "break",
  "minutes": 30
}
```

| Field                 | Type                | Constraints                                                                    |
| --------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `availability_status` | `string`            | Required: `"available"`, `"break"`, or `"offline"`                             |
| `minutes`             | `integer` or `null` | Optional, range 1–480. Only meaningful when status is `"break"` or `"offline"` |

**Response 200:**

```json
{
  "data": {
    "availability_status": "break"
  }
}
```

**Errors:**

| HTTP | ErrorCode             | When                                                       |
| ---- | --------------------- | ---------------------------------------------------------- |
| 400  | `INVALID_STATUS`      | `availability_status` is not one of the three valid values |
| 401  | `INVALID_TOKEN`       | Missing or invalid JWT                                     |
| 403  | `ADVISOR_INACTIVE`    | Advisor account is deactivated                             |
| 500  | `SUPABASE_AUTH_ERROR` | Database update failed                                     |

**Notes:**

- When setting `"available"`, `status_until` is always set to `null` regardless of `minutes`.
- The `minutes` field causes `status_until` to be stored as a naive Bogotá local time. The background availability checker job uses it to auto-restore the status.

**WebSocket events emitted:**

- `advisor.status_changed` — broadcast to all connected advisors

---

### PATCH /api/v1/panel/advisors/{advisor_id}

**Auth required:** Yes (admin only)

**Description:** Edits any advisor's profile. Partial update — only fields present in the request body are modified. An admin cannot edit themselves via this endpoint (must use `/me` instead).

**Path params:**

| Param        | Type            | Description           |
| ------------ | --------------- | --------------------- |
| `advisor_id` | `string` (UUID) | The advisor to update |

**Request body (all fields optional):**

```json
{
  "full_name": "Luis Antonio Martínez",
  "role": "admin",
  "area": "ambas",
  "specialty": null,
  "max_conversations": 5,
  "is_active": false
}
```

| Field               | Type                | Constraints                                            |
| ------------------- | ------------------- | ------------------------------------------------------ |
| `full_name`         | `string` or `null`  | Optional, min 1 character                              |
| `role`              | `string` or `null`  | Optional: `"asesor"` or `"admin"`                      |
| `area`              | `string` or `null`  | Optional: `"administrativa"`, `"comercial"`, `"ambas"` |
| `specialty`         | `string` or `null`  | Optional. Validated against effective area             |
| `max_conversations` | `integer` or `null` | Optional, range 1–10                                   |
| `is_active`         | `boolean` or `null` | Optional                                               |

**Response 200:**

```json
{
  "data": {
    "advisor": {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "email": "luis.martinez@casasyespacios.co",
      "full_name": "Luis Antonio Martínez",
      "role": "asesor",
      "area": "ambas",
      "specialty": null,
      "max_conversations": 5,
      "active_conversations": 1,
      "availability_status": "available",
      "is_active": false
    },
    "warning": "El asesor tenía 1 conversaciones activas al momento de ser desactivado"
  }
}
```

**Errors:**

| HTTP | ErrorCode                    | When                                                    |
| ---- | ---------------------------- | ------------------------------------------------------- |
| 400  | `INVALID_SPECIALTY_FOR_AREA` | `specialty` is not valid for the effective area         |
| 401  | `INVALID_TOKEN`              | Missing or invalid JWT                                  |
| 403  | `FORBIDDEN`                  | Caller is not an admin                                  |
| 403  | `CANNOT_EDIT_YOURSELF`       | Admin tried to edit their own account via this endpoint |
| 404  | `ADVISOR_NOT_FOUND`          | No advisor with the given ID                            |
| 500  | `SUPABASE_AUTH_ERROR`        | Database update failed                                  |

**Notes:**

- `"warning"` is present and non-null only when the advisor was deactivated (`is_active: false`) while having active conversations. Display this warning to the admin.
- Specialty validation: when `specialty` is in the request body, the effective area is `body.area` if also present, otherwise the current advisor's area from DB.

---

### GET /api/v1/panel/advisors/online

**Auth required:** Yes (any active advisor)

**Description:** Returns active asesores for the online indicator in the inbox. The authenticated advisor is excluded from the list. Only advisors with `role='asesor'` and `is_active=true` are returned — admins are never included.

`is_panel_connected` is `true` if the advisor has at least one active WebSocket connection in the `ws_connections` table. It updates in real time via `advisor.connected` and `advisor.disconnected` WebSocket events.

**Response 200 — asesor caller:**

```json
{
  "data": {
    "advisors": [
      {
        "id": "uuid",
        "full_name": "Nathaly",
        "availability_status": "available",
        "area": "administrativa",
        "is_panel_connected": true
      }
    ]
  }
}
```

**Response 200 — admin caller:**

```json
{
  "data": {
    "advisors": [
      {
        "id": "uuid",
        "full_name": "Nathaly",
        "availability_status": "available",
        "area": "administrativa",
        "active_conversations": 1,
        "max_conversations": 3,
        "is_panel_connected": true
      }
    ]
  }
}
```

| Field                  | Type            | Description                                                            |
| ---------------------- | --------------- | ---------------------------------------------------------------------- |
| `id`                   | `string` (UUID) | Advisor ID                                                             |
| `full_name`            | `string`        | Display name                                                           |
| `availability_status`  | `string`        | `"available"`, `"break"`, or `"offline"`                               |
| `area`                 | `string`        | `"administrativa"`, `"comercial"`, or `"ambas"`                        |
| `is_panel_connected`   | `boolean`       | `true` if at least one active WS connection exists in `ws_connections` |
| `active_conversations` | `integer`       | Active conversation count — admin caller only                          |
| `max_conversations`    | `integer`       | Configured cap — admin caller only                                     |

**Errors:**

| HTTP | ErrorCode             | When                   |
| ---- | --------------------- | ---------------------- |
| 401  | `INVALID_TOKEN`       | Missing or invalid JWT |
| 500  | `SUPABASE_AUTH_ERROR` | Database query failed  |

---

## Metrics

### GET /api/v1/panel/metrics

**Auth required:** Yes (admin only)

**Description:** Returns 7 real-time operational metrics for the admin dashboard in a single database round-trip via the `get_dashboard_metrics()` Supabase RPC function.

**Response 200:**

```json
{
  "data": {
    "metrics": {
      "activas": 2,
      "escaladas": 2,
      "en_atencion": 1,
      "tiempo_promedio_min": 10,
      "bot_ok_pct": 50,
      "capacidad_actual": 1,
      "capacidad_total": 9
    }
  }
}
```

**Metric definitions:**

| Field                 | Type    | Description                                                                                                                                       |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activas`             | integer | Conversations where the bot is actively resolving (`status='activa'` AND `bot_activo=true`)                                                       |
| `escaladas`           | integer | Conversations waiting or being attended by an advisor (`status='escalada'`). Includes `en_atencion`                                               |
| `en_atencion`         | integer | Subset of `escaladas` that already have an assigned advisor (`escalation.advisor_id IS NOT NULL`)                                                 |
| `tiempo_promedio_min` | integer | Average minutes elapsed since `escalated_at` for unresolved active escalations. `0` when none exist                                               |
| `bot_ok_pct`          | integer | Percentage of conversations closed in the last 24h that the bot resolved without escalating. `0` when no conversations were closed in that period |
| `capacidad_actual`    | integer | Active escalations with an assigned advisor right now (occupied capacity slots)                                                                   |
| `capacidad_total`     | integer | Sum of `max_conversations` across all active advisors with `role='asesor'`. Admins are excluded                                                   |

**Errors:**

| HTTP | ErrorCode        | When                     |
| ---- | ---------------- | ------------------------ |
| 401  | `INVALID_TOKEN`  | Missing or invalid JWT   |
| 403  | `FORBIDDEN`      | Caller is not an admin   |
| 500  | `SUPABASE_ERROR` | RPC function call failed |

**Notes:**

- `escaladas` ≥ `en_atencion` — they are not mutually exclusive.
- Returns all zeros (not an error) when the database has no data.
- `capacidad_total` only counts advisors with `role='asesor'` — admins are never included.

---

## Behavior Alerts

### GET /api/v1/panel/behavior-alerts/

**Auth required:** Yes (admin only)

**Description:** Paginated list of behavior alerts generated by background moderation of advisor messages. Defaults to unreviewed alerts.

**Query params:**

| Param        | Type            | Default | Description                                         |
| ------------ | --------------- | ------- | --------------------------------------------------- |
| `reviewed`   | `boolean`       | `false` | `false` = pending review; `true` = already reviewed |
| `advisor_id` | `string` (UUID) | none    | Filter alerts for a specific advisor                |
| `limit`      | `integer`       | 20      | Page size (1–100)                                   |
| `offset`     | `integer`       | 0       | Pagination offset                                   |

**Response 200:**

```json
{
  "data": {
    "alerts": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440060",
        "advisor": {
          "id": "550e8400-e29b-41d4-a716-446655440001",
          "full_name": "Ana Gómez"
        },
        "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
        "message_content": "El contenido del mensaje del asesor que fue marcado",
        "alert_type": "tono_agresivo",
        "severity": "media",
        "detected_at": "2026-06-22T14:36:01+00:00",
        "reviewed": false,
        "reviewed_by": null,
        "reviewed_at": null
      }
    ],
    "total": 3
  }
}
```

**Errors:**

| HTTP | ErrorCode       | When                   |
| ---- | --------------- | ---------------------- |
| 401  | `INVALID_TOKEN` | Missing or invalid JWT |
| 403  | `FORBIDDEN`     | Caller is not an admin |

**Notes:**

- `total` is the full matching row count, ignoring `limit`/`offset`.
- `alert_type` values: `lenguaje_inapropiado`, `tono_agresivo`, `comportamiento_inadecuado`
- `severity` values: `baja`, `media`, `alta`

---

### PATCH /api/v1/panel/behavior-alerts/{alert_id}/review

**Auth required:** Yes (admin only)

**Description:** Marks a behavior alert as reviewed. The reviewing admin's ID is taken from the JWT — no request body required.

**Path params:**

| Param      | Type            | Description                   |
| ---------- | --------------- | ----------------------------- |
| `alert_id` | `string` (UUID) | The alert to mark as reviewed |

**Response 200:**

```json
{
  "data": {
    "alert": {
      "id": "550e8400-e29b-41d4-a716-446655440060",
      "advisor": {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "full_name": "Ana Gómez"
      },
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "message_content": "El contenido del mensaje del asesor que fue marcado",
      "alert_type": "tono_agresivo",
      "severity": "media",
      "detected_at": "2026-06-22T14:36:01+00:00",
      "reviewed": true,
      "reviewed_by": "550e8400-e29b-41d4-a716-446655440099",
      "reviewed_at": "2026-06-22T15:00:00+00:00"
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode          | When                            |
| ---- | ------------------ | ------------------------------- |
| 401  | `INVALID_TOKEN`    | Missing or invalid JWT          |
| 403  | `FORBIDDEN`        | Caller is not an admin          |
| 404  | `ALERT_NOT_FOUND`  | No alert with the given ID      |
| 409  | `ALREADY_REVIEWED` | Alert has already been reviewed |

**Notes:**

- `reviewed_by` in the response is the admin's UUID, not their name. The frontend must resolve the name from the advisors list if needed.

---

## Agent Notifications

Notifications the agent records for the team, without escalating the conversation (specs/agent_notifications). The first type is `comprobante_pago`: a client sent a payment receipt (image or PDF) that someone should register. **A notification is never an escalation** — creating, resolving or discarding one never changes `bot_activo`, the assigned advisor, or the advisor's conversation quota.

Every advisor (`asesor` and `admin`) sees every notification — there is no area filter.

### The notification item

Every endpoint and both WebSocket events use this shape:

```json
{
  "id": "6e7f8091-0000-4000-8000-000000000001",
  "type": "comprobante_pago",
  "status": "pendiente",
  "title": "Comprobante de pago",
  "agent": "administrative",
  "client": {
    "id": "550e8400-e29b-41d4-a716-446655440020",
    "full_name": "Juan Pérez",
    "phone_number": "+573001112233",
    "user_name": "Juan"
  },
  "conversation": {
    "id": "550e8400-e29b-41d4-a716-446655440010",
    "case_number": "CE-123",
    "status": "activa"
  },
  "payload": {},
  "attachments": [
    { "wam_id": "wamid.HBgM..." }
  ],
  "created_at": "2026-10-04T15:02:11.456789+00:00",
  "updated_at": "2026-10-04T15:02:11.456789+00:00",
  "resolved_at": null,
  "resolved_by": null,
  "resolution_note": null
}
```

| Field | Notes |
| ----- | ----- |
| `status` | `pendiente` → `resuelta` \| `descartada`. No other transition and no reopening. |
| `title` | Fixed label of the type (`"Comprobante de pago"`). The panel may show its own label per `type` instead. |
| `agent` | Which agent was serving the conversation: `administrative` \| `commercial`. |
| `client` | Display data. `full_name` may be `null` (client not identified yet); fall back to `user_name`, then `phone_number`. `phone_number` may be `null` for a BSUID-only client. |
| `conversation` | Link target for "open the chat" (`GET /conversations/{id}`). The conversation may already be `cerrada`. |
| `payload` | Type-specific data. Always `{}` for `comprobante_pago`: nothing the vision model read from the file (amount, payer, reference) is stored — the advisor checks the real file in the conversation. |
| `attachments` | The messages that carry this payment's files, oldest first: `{"wam_id"}` only. Open the chat on `attachments[0].wam_id`; the file itself is the message there. A second file of the same conversation sent within 30 minutes (`RECEIPT_DEDUP_WINDOW_MINUTES`) is appended here instead of creating another notification. Notifications created before 2026-10-04 may still carry the older, richer fields — ignore them. |
| `resolved_by` | `{"id", "full_name"}` of the advisor who closed it, or `null`. |

---

### GET /api/v1/panel/notifications

**Auth required:** Yes (any role)

**Description:** Paginated inbox, newest first. Defaults to pending notifications.

**Query params:**

| Param    | Type      | Default     | Description                                        |
| -------- | --------- | ----------- | -------------------------------------------------- |
| `status` | `string`  | `pendiente` | `pendiente` \| `resuelta` \| `descartada` \| `all` |
| `type`   | `string`  | none        | `comprobante_pago` (the only type today)           |
| `limit`  | `integer` | 20          | Page size (1–100)                                  |
| `offset` | `integer` | 0           | Pagination offset                                  |

**Response 200:**

```json
{
  "data": {
    "notifications": [
      /* notification items */
    ],
    "total": 12,
    "limit": 20,
    "offset": 0,
    "pending_count": 7
  }
}
```

**Errors:**

| HTTP | ErrorCode        | When                                                                  |
| ---- | ---------------- | --------------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`  | Missing or invalid JWT                                                |
| 422  | —                | Invalid `status`, `type`, `limit` or `offset`                         |
| 503  | `SUPABASE_ERROR` | Database unavailable (or migration 013 not applied yet) — retry later |

**Notes:**

- `total` counts the rows matching the filters, ignoring `limit`/`offset`.
- `pending_count` is **always** the number of pending notifications, whatever the filters — use it for the navigation badge.

---

### GET /api/v1/panel/notifications/{notification_id}

**Auth required:** Yes (any role)

**Path params:**

| Param             | Type            | Description      |
| ----------------- | --------------- | ---------------- |
| `notification_id` | `string` (UUID) | The notification |

**Response 200:**

```json
{
  "data": {
    "notification": {
      /* notification item */
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                | When                                               |
| ---- | ------------------------ | -------------------------------------------------- |
| 401  | `INVALID_TOKEN`          | Missing or invalid JWT                             |
| 404  | `NOTIFICATION_NOT_FOUND` | No notification with that id (or not a valid UUID) |
| 503  | `SUPABASE_ERROR`         | Database unavailable — retry later                 |

---

### PATCH /api/v1/panel/notifications/{notification_id}

**Auth required:** Yes (any role)

**Description:** Closes a pending notification as resolved (e.g. the receipt was registered in the accounting system) or discarded (duplicate, not a receipt). The closing advisor is taken from the JWT. Does not touch the conversation.

**Request body:**

```json
{ "status": "resuelta", "note": "Registrado en SIMI" }
```

| Field    | Type     | Required | Description                                      |
| -------- | -------- | -------- | ------------------------------------------------ |
| `status` | `string` | Yes      | `resuelta` \| `descartada`                       |
| `note`   | `string` | No       | Up to 500 characters. Blank is stored as `null`. |

**Response 200:**

```json
{
  "data": {
    "notification": {
      /* the closed notification item */
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode                     | When                                                                            |
| ---- | ----------------------------- | ------------------------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`               | Missing or invalid JWT                                                          |
| 404  | `NOTIFICATION_NOT_FOUND`      | No notification with that id (or not a valid UUID)                              |
| 409  | `NOTIFICATION_ALREADY_CLOSED` | It is no longer `pendiente` — another advisor closed it first                   |
| 422  | —                             | `status` not `resuelta`/`descartada`, or `note` too long                        |
| 503  | `SUPABASE_ERROR`              | Database unavailable — the close may not have happened; refetch before retrying |

**Notes:**

- The close is an atomic claim: of two advisors closing the same notification at once, exactly one gets 200 and the other 409. On 409, refresh the row (`GET /notifications/{id}`) to show who closed it.
- Retrying the same request after a lost response returns 200 (same advisor, same status), never 409.
- A successful close broadcasts `notification.updated` to every connected advisor.

---

## Schedules (Inactivity Intervals)

### GET /api/v1/panel/schedules/

**Auth required:** Yes (any active advisor)

**Description:** Lists inactivity interval schedules. Advisors see only their own. Admins can use the `advisor_id` query param to view another advisor's schedules.

**Query params:**

| Param        | Type            | Description                                                                                  |
| ------------ | --------------- | -------------------------------------------------------------------------------------------- |
| `advisor_id` | `string` (UUID) | Admin-only: view a specific advisor's schedules. Non-admins: this param is silently ignored. |

**Response 200:**

```json
{
  "data": {
    "schedules": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440070",
        "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
        "label": "Almuerzo",
        "start_time": "12:00",
        "end_time": "13:00",
        "days_of_week": [1, 2, 3, 4, 5],
        "is_active": true
      }
    ]
  }
}
```

**Errors:**

| HTTP | ErrorCode          | When                           |
| ---- | ------------------ | ------------------------------ |
| 401  | `INVALID_TOKEN`    | Missing or invalid JWT         |
| 403  | `ADVISOR_INACTIVE` | Advisor account is deactivated |

---

### POST /api/v1/panel/schedules/

**Auth required:** Yes (any active advisor)

**HTTP status on success:** 201 Created

**Description:** Creates a new inactivity interval for the authenticated advisor. The schedule is created with `is_active = true`.

**Request body:**

```json
{
  "label": "Almuerzo",
  "start_time": "12:00",
  "end_time": "13:00",
  "days_of_week": [1, 2, 3, 4, 5]
}
```

| Field          | Type             | Constraints                                                         |
| -------------- | ---------------- | ------------------------------------------------------------------- |
| `label`        | `string`         | Required, 1–50 characters                                           |
| `start_time`   | `string`         | Required, format `HH:MM` (24h)                                      |
| `end_time`     | `string`         | Required, format `HH:MM` (24h)                                      |
| `days_of_week` | `array[integer]` | Required, at least 1 element. Values: 1 (Monday) through 7 (Sunday) |

**Response 201:**

```json
{
  "data": {
    "schedule": {
      "id": "550e8400-e29b-41d4-a716-446655440070",
      "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
      "label": "Almuerzo",
      "start_time": "12:00",
      "end_time": "13:00",
      "days_of_week": [1, 2, 3, 4, 5],
      "is_active": true
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode            | When                                                |
| ---- | -------------------- | --------------------------------------------------- |
| 400  | `INVALID_TIME_RANGE` | `start_time` >= `end_time`                          |
| 400  | `INVALID_DAYS`       | One or more values in `days_of_week` is outside 1–7 |
| 401  | `INVALID_TOKEN`      | Missing or invalid JWT                              |
| 403  | `ADVISOR_INACTIVE`   | Advisor account is deactivated                      |
| 500  | `DATABASE_ERROR`     | Insert returned no data                             |

---

### PATCH /api/v1/panel/schedules/{schedule_id}

**Auth required:** Yes (any active advisor; own schedules only, or admin for any)

**Description:** Partial update for an inactivity interval. Only fields present in the request body are modified. Time range validation is applied against the merged final state.

**Path params:**

| Param         | Type            | Description            |
| ------------- | --------------- | ---------------------- |
| `schedule_id` | `string` (UUID) | The schedule to update |

**Request body (all fields optional):**

```json
{
  "label": "Break tarde",
  "start_time": "15:30",
  "end_time": "15:45",
  "days_of_week": [1, 2, 3, 4, 5, 6],
  "is_active": false
}
```

**Response 200:**

```json
{
  "data": {
    "schedule": {
      "id": "550e8400-e29b-41d4-a716-446655440070",
      "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
      "label": "Break tarde",
      "start_time": "15:30",
      "end_time": "15:45",
      "days_of_week": [1, 2, 3, 4, 5, 6],
      "is_active": false
    }
  }
}
```

**Errors:**

| HTTP | ErrorCode            | When                                                        |
| ---- | -------------------- | ----------------------------------------------------------- |
| 400  | `INVALID_TIME_RANGE` | Resulting `start_time` >= resulting `end_time`              |
| 400  | `INVALID_DAYS`       | A value in `days_of_week` is outside 1–7                    |
| 401  | `INVALID_TOKEN`      | Missing or invalid JWT                                      |
| 403  | `ADVISOR_INACTIVE`   | Advisor account is deactivated                              |
| 403  | `NOT_YOUR_SCHEDULE`  | Non-admin advisor trying to edit another advisor's schedule |
| 404  | `SCHEDULE_NOT_FOUND` | No schedule with the given ID                               |

**Notes:**

- Sending an empty body (no fields) is valid — the current schedule is returned unchanged without hitting the DB.
- DB stores times as `HH:MM:SS`. The API normalizes the output to `HH:MM`.

---

### DELETE /api/v1/panel/schedules/{schedule_id}

**Auth required:** Yes (any active advisor; own schedules only, or admin for any)

**HTTP status on success:** 204 No Content

**Description:** Permanently deletes an inactivity interval. No response body.

**Path params:**

| Param         | Type            | Description            |
| ------------- | --------------- | ---------------------- |
| `schedule_id` | `string` (UUID) | The schedule to delete |

**Response 204:** No body.

**Errors:**

| HTTP | ErrorCode            | When                                                          |
| ---- | -------------------- | ------------------------------------------------------------- |
| 401  | `INVALID_TOKEN`      | Missing or invalid JWT                                        |
| 403  | `ADVISOR_INACTIVE`   | Advisor account is deactivated                                |
| 403  | `NOT_YOUR_SCHEDULE`  | Non-admin advisor trying to delete another advisor's schedule |
| 404  | `SCHEDULE_NOT_FOUND` | No schedule with the given ID                                 |

---

## WebSocket

### Connection

**URL:** `wss://<host>/api/v1/panel/ws?token=<jwt>`

**Protocol:** WebSocket

**Auth:** Pass the JWT as a **query parameter** (`?token=`). Bearer header auth is not supported for WebSocket connections. The server closes with code `4001` if the token is invalid, expired, or the advisor is inactive.

**Connection lifecycle:**

1. Client opens connection with JWT in query string.
2. Server validates JWT, fetches advisor from DB, rejects inactive advisors.
3. Server accepts the connection, registers it in the in-memory `WebSocketManager`.
4. Server upserts a `ws_connections` record in the DB.
5. Server broadcasts `advisor.connected` to all advisors.
6. If the connecting advisor has `role = "asesor"`, server sends `queue.pending` **directly** to that advisor (not a broadcast) if there are unassigned escalations in their area. Admins never receive this event.
7. Client enters the message loop (ping/subscribe/unsubscribe).
8. On disconnect, the server removes the connection, deletes the DB record, and broadcasts `advisor.disconnected`.

**Connection example:**

```javascript
const ws = new WebSocket(
  `wss://casasyespacios-agent.railway.app/api/v1/panel/ws?token=${jwt}`,
);

ws.onmessage = (event) => {
  const { event: eventType, data } = JSON.parse(event.data);
  console.log(eventType, data);
};
```

---

### Client → Server Messages

The client sends JSON text frames. All messages have a `type` field.

#### ping

Sent by the client to keep the connection alive. The server responds with `{"type": "pong"}` and updates `last_ping_at` in the DB.

```json
{ "type": "ping" }
```

**Server response:**

```json
{ "type": "pong" }
```

#### subscribe_conversation

Subscribe to a specific conversation. Use when the advisor opens a chat view.

```json
{
  "type": "subscribe_conversation",
  "conversation_id": "550e8400-e29b-41d4-a716-446655440010"
}
```

No direct server response. The subscription state is tracked server-side in memory. While subscribed, the connection also starts receiving `message.new` for that conversation's bot↔client turns (see `message.new` below) — this is how the chat view stays live while `bot_activo = true`.

#### unsubscribe_conversation

Resets the advisor's subscription back to inbox level. Use when the advisor closes a chat view.

```json
{ "type": "unsubscribe_conversation" }
```

No direct server response.

---

### Server → Client Events

All server events have this envelope:

```json
{ "event": "<event_type>", "data": { ... } }
```

#### advisor.connected

Emitted to **all connected advisors** when a new advisor opens a WebSocket connection.

```json
{
  "event": "advisor.connected",
  "data": {
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez",
    "advisor_role": "asesor",
    "advisor_area": "administrativa"
  }
}
```

#### advisor.disconnected

Emitted to **all connected advisors** when an advisor's connection closes.

```json
{
  "event": "advisor.disconnected",
  "data": {
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez"
  }
}
```

#### advisor.status_changed

Emitted to **all connected advisors** when an advisor changes their availability status via `PATCH /advisors/me/availability`.

```json
{
  "event": "advisor.status_changed",
  "data": {
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "availability_status": "break",
    "full_name": "Ana Gómez",
    "area": "administrativa",
    "specialty": "financiera"
  }
}
```

#### message.new

Emitted when a new message is created in a conversation. Routing depends on whether the bot or an advisor is currently handling the conversation (`bot_activo`):

- **`bot_activo = false`** (advisor has taken over) — routing depends on origin:
  - **Outbound advisor** (advisor sends via panel) — broadcast to **all connected advisors**.
  - **Inbound, conversation assigned** — unicast to the **assigned advisor** + broadcast to **all admins** (admin who is also the assigned advisor receives it only once).
  - **Inbound, conversation unassigned / queued** — broadcast to all advisors in the **conversation's channel** (`area = channel` or `area = "ambas"`).
- **`bot_activo = true`** (bot is handling the conversation — client turns, bot replies, and bot-sent inactivity/closing messages) — sent **only to connections with an active `subscribe_conversation` subscription** to that `conversation_id` (see `subscribe_conversation` above). This is intentionally narrower than a channel/area broadcast: the bot resolves most conversations without any advisor watching, so broadcasting every bot↔client turn to the whole area would generate WS traffic nobody consumes. An advisor (or admin) only receives these events while they have that specific conversation's chat view open. If nobody is subscribed, nothing is sent. The payload omits `unread_count` for this case (it's not incremented/reset by this code path — that field is only meaningful for the inbox view under the `bot_activo = false` flows above).

Every `message.new` payload also carries `conversation_priority` (`baja`/`media`/`alta`/`critica`) — the conversation's current priority at emit time, fetched fresh from the DB. This lets the chat view keep its priority badge in sync without a separate fetch; for the inbox-wide badge, `conversation.priority_updated` (see below) is the authoritative real-time signal since it also reaches advisors not subscribed to that specific conversation.

**Payload (outbound_advisor — with `advisor_name`):**

```json
{
  "event": "message.new",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "conversation_priority": "alta",
    "message": {
      "id": "550e8400-e29b-41d4-a716-446655440055",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUB",
      "direction": "outbound_advisor",
      "msg_type": "text",
      "content": "Hola Carlos, con gusto le ayudo.",
      "media_url": null,
      "media_mime_type": null,
      "media_size_bytes": null,
      "delivered_via": "websocket_panel",
      "timestamp": "2026-06-22T14:36:00+00:00",
      "created_at": "2026-06-22T14:36:00+00:00",
      "advisor_name": "Ana Gómez"
    }
  }
}
```

**Payload (inbound — `advisor_name` always `null`):**

```json
{
  "event": "message.new",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "conversation_priority": "baja",
    "message": {
      "id": "550e8400-e29b-41d4-a716-446655440056",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUC",
      "direction": "inbound",
      "msg_type": "text",
      "content": "Buenos días, quiero saber mi saldo.",
      "media_url": null,
      "media_mime_type": null,
      "media_size_bytes": null,
      "delivered_via": "webhook_meta",
      "timestamp": "2026-06-22T14:35:00+00:00",
      "created_at": "2026-06-22T14:35:01+00:00",
      "advisor_name": null
    }
  }
}
```

**Payload (`bot_activo = true` — sent only to advisors subscribed to this `conversation_id`, no `unread_count` key):**

```json
{
  "event": "message.new",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "conversation_priority": "baja",
    "message": {
      "id": "550e8400-e29b-41d4-a716-446655440057",
      "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
      "wam_id": "wamid.HBgLNTczMDAxMjM0NTY3FQIAEhgWM0E4QjA2RjhDRjhCMzVCODk1NDUD",
      "direction": "outbound_bot",
      "msg_type": "text",
      "content": "Tu saldo actual es de $150.000.",
      "media_url": null,
      "media_mime_type": null,
      "media_size_bytes": null,
      "transcription": null,
      "advisor_name": null,
      "delivered_via": "webhook_meta",
      "timestamp": "2026-06-22T14:35:05+00:00",
      "created_at": "2026-06-22T14:35:05+00:00"
    }
  }
}
```

#### escalation.assigned

Emitted to **all connected advisors** when an advisor self-assigns via `PATCH /conversations/{id}/assign`.

```json
{
  "event": "escalation.assigned",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "escalation_id": "550e8400-e29b-41d4-a716-446655440030",
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez"
  }
}
```

#### conversation.returned

Emitted to **all connected advisors** when an advisor returns a conversation to bot control via `PATCH /conversations/{id}/return-bot`.

```json
{
  "event": "conversation.returned",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez"
  }
}
```

#### conversation.control_taken

Emitted to **all connected advisors** when an advisor takes direct manual control via `PATCH /conversations/{id}/take-control`. **Not** emitted on the idempotent 200 (caller already had control) — only on an actual state change.

```json
{
  "event": "conversation.control_taken",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "escalation_id": "550e8400-e29b-41d4-a716-446655440031",
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez"
  }
}
```

Same shape as `escalation.assigned` — handle both with the same card-update logic (update the conversation's assigned advisor, move it out of any "bot handling" view). `escalation.reason` on the conversation will be `"control_manual_directo"` if you need to distinguish it from a bot-initiated escalation in the UI (e.g. a different badge/icon), but no UI behavior should strictly depend on that distinction.

#### conversation.reopened

Emitted to **all connected advisors** when an advisor reopens a closed conversation via `PATCH /conversations/{id}/reopen`.

```json
{
  "event": "conversation.reopened",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "escalation_id": "550e8400-e29b-41d4-a716-446655440031",
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez"
  }
}
```

Same shape as `conversation.control_taken` — handle with the same card-update logic (move the conversation out of the "closed" view and into the advisor's active tray). The conversation's `status` goes from `"cerrada"` to `"escalada"` and `bot_activo` to `false`; `case_number` is unchanged. No automatic message is sent to the client on this transition — don't expect a matching `message.new` event.

#### conversation.transferred

Emitted when an advisor transfers an active escalation to another advisor via `POST /conversations/{id}/transfer`. Unlike most conversation events, this is **not a broadcast** — it is sent only to: the source advisor (so the conversation disappears from their tray), the target advisor (so it appears as newly assigned), and any connected admins (for audit/monitoring).

```json
{
  "event": "conversation.transferred",
  "data": {
    "type": "conversation.transferred",
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "case_number": "CE-2026-000042",
    "from_advisor": {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "full_name": "Ana Gómez"
    },
    "to_advisor": {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "full_name": "Mariana Rojas"
    },
    "reason": "Cliente pregunta por tema comercial"
  }
}
```

`from_advisor` is `null` if the escalation had no assigned advisor before the transfer (e.g. an admin transferring an unassigned-but-escalated conversation). `reason` is `null` if none was provided in the request.

#### conversation.closed

Emitted to **all connected advisors** when a conversation is closed — either by an advisor via `PATCH /conversations/{id}/close`, or by the bot automatically.

**Advisor-initiated** (`closed_by: "asesor"`):

```json
{
  "event": "conversation.closed",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "advisor_name": "Ana Gómez",
    "resolution_type": "consulta_cartera_resuelta",
    "closed_by": "asesor",
    "closed_at": "2026-06-23T14:30:00+00:00"
  }
}
```

**Bot-initiated** (`closed_by: "bot"`): emitted when the AI agent detects a farewell or satisfaction signal from the client, or when the inactivity job closes after no response. `advisor_id` and `advisor_name` are absent.

```json
{
  "event": "conversation.closed",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "closed_by": "bot",
    "reason": "resolved"
  }
}
```

**Window expiry** (`closed_by: "bot"`, `reason: "window_expired"`): emitted when the background
job closes a conversation because Meta's 24h window ran out. **No new event type** — this is the
same `conversation.closed` you already handle, with a new `reason` value. It can arrive at **any
hour**, including overnight, unlike the other bot closes which only happen during office hours.

```json
{
  "event": "conversation.closed",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "closed_by": "bot",
    "reason": "window_expired"
  }
}
```

Always handle `conversation.closed` defensively — check for `closed_by` before reading `advisor_id`.

#### escalation.new

Emitted to **all connected advisors** when the bot escalates a conversation — either assigned to a specific advisor or placed in the unassigned queue.

```json
{
  "event": "escalation.new",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "advisor_id": "550e8400-e29b-41d4-a716-446655440001",
    "reason": "solicitud_usuario",
    "channel": "administrativa",
    "case_number": "CE-2026-000043",
    "conversation_priority": "alta"
  }
}
```

| Field                   | Type                      | Description                                                                                                                                                                             |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversation_id`       | `string` (UUID)           | The escalated conversation                                                                                                                                                              |
| `advisor_id`            | `string` (UUID) or `null` | Assigned advisor, or `null` when placed in the unassigned queue                                                                                                                         |
| `reason`                | `string` or `null`        | The escalation reason. May be `null` if unclassified                                                                                                                                    |
| `channel`               | `string`                  | `"administrativa"` or `"comercial"`                                                                                                                                                     |
| `case_number`           | `string` or `null`        | Human-readable case reference (`CE-YYYY-NNNNNN`). `null` only if the backend failed to fetch it when emitting the event (fail-soft) — re-fetch via `GET /conversations/{id}` if needed. |
| `conversation_priority` | `string`                  | `baja`/`media`/`alta`/`critica` — the conversation's priority at the moment it was escalated. Defaults to `"baja"` if the backend failed to fetch it (same fail-soft as `case_number`). |

**When `advisor_id` is `null`:** the conversation is in the unassigned queue — any available advisor in the channel can take it via `PATCH /conversations/{id}/assign`.

**When `advisor_id` is set:** the bot auto-assigned to the lowest-load available advisor. Other advisors should update the conversation card to reflect the new assignment.

---

#### conversation.priority_updated

Emitted to **all connected advisors** whenever the bot's `evaluate_priority` node raises a conversation's priority. Priority is set **exclusively** by the bot based on client tone/urgency — there is no endpoint or panel action to change it manually, and it never decreases once raised. Not every incoming message triggers this event — only turns where the newly evaluated priority is strictly higher than what's persisted.

```json
{
  "event": "conversation.priority_updated",
  "data": {
    "conversation_id": "550e8400-e29b-41d4-a716-446655440010",
    "priority": "alta",
    "updated_by": "bot"
  }
}
```

| Field             | Type            | Description                                         |
| ----------------- | --------------- | --------------------------------------------------- |
| `conversation_id` | `string` (UUID) | The conversation whose priority changed             |
| `priority`        | `string`        | The new priority — `baja`/`media`/`alta`/`critica`  |
| `updated_by`      | `string`        | Always `"bot"` — no other actor can change priority |

**Client implementation note:** use this event to update the inbox badge/sort order in real time. It fires independently of `message.new`/`escalation.new`, so it can arrive on its own turn (e.g. mid-conversation, before the bot's reply is sent) — don't assume it's bundled with another event.

---

#### queue.pending

Emitted **only to the connecting advisor** (not a broadcast) immediately after `advisor.connected`, when there are unassigned escalations waiting in their area. Sent once at connection time. Never sent to admins.

```json
{
  "event": "queue.pending",
  "data": {
    "count": 3,
    "message": "Tienes 3 conversaciones esperando en la bandeja."
  }
}
```

| Field     | Type      | Description                                                |
| --------- | --------- | ---------------------------------------------------------- |
| `count`   | `integer` | Number of unassigned escalations in the advisor's area     |
| `message` | `string`  | Human-readable message for display in a toast notification |

**Area filtering:**

- `area = "administrativa"` → only counts escalations from the administrative channel.
- `area = "comercial"` → only counts escalations from the commercial channel.
- `area = "ambas"` → counts escalations from both channels.

**Frontend behaviour:** show an informational toast with `data.message` and trigger a bandeja refresh so the inbox reflects the current queue state. This event covers the case where escalations arrived while the advisor was offline.

---

#### behavior.alert

Emitted to **admin advisors only** when background moderation detects inappropriate content in an advisor message.

```json
{
  "event": "behavior.alert",
  "data": {
    "alert_id": "550e8400-e29b-41d4-a716-446655440060"
  }
}
```

**Note:** This event only contains the `alert_id`. The frontend must call `GET /behavior-alerts/` to fetch the full alert details. The payload is minimal to avoid broadcasting sensitive message content to all admins.

---

#### notification.new

Emitted to **all connected advisors** when the agent creates a notification (a client sent a payment receipt and it was registered). Carries the full item, so the inbox can insert the row without a request.

```json
{
  "event": "notification.new",
  "data": {
    "notification": {
      /* notification item — see Agent Notifications */
    },
    "pending_count": 8
  }
}
```

#### notification.updated

Emitted to **all connected advisors** when an existing notification changes: another file of the same payment was attached, or an advisor resolved/discarded it. Same payload as `notification.new`; replace the row by `notification.id` and set the badge from `pending_count`.

```json
{
  "event": "notification.updated",
  "data": {
    "notification": {
      /* notification item */
    },
    "pending_count": 7
  }
}
```

**Note:** Events are best-effort (sent after the client's turn). A missed event only means the list is stale until the next `GET /notifications` — refetch on reconnect.

---

## Enums Reference

### ConversationStatus

| Value      | When it applies                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `activa`   | Conversation is ongoing. Either the bot is handling it (`bot_activo = true`) or an advisor is actively responding (`bot_activo = false`). |
| `escalada` | The bot triggered a handover and the conversation is waiting for an advisor to take it. The escalation record has no `advisor_id` yet.    |
| `cerrada`  | Conversation has ended. No further messages can be sent. `closed_at` is set.                                                              |

### ConversationIntent

| Value             | Description                                                                    | Routed to                                    |
| ----------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| `cartera`         | Portfolio/receivables management questions                                     | Advisor specialty: `financiera`              |
| `pagos`           | Payment inquiries and processing                                               | Advisor specialty: `financiera`              |
| `facturacion`     | Billing and invoice requests                                                   | Advisor specialty: `financiera`              |
| `disputa_cobro`   | Billing dispute or charge contestation                                         | Advisor specialty: `financiera`              |
| `mantenimiento`   | Property maintenance requests                                                  | Advisor specialty: `mantenimiento_contratos` |
| `contratos`       | Lease or contract questions                                                    | Advisor specialty: `mantenimiento_contratos` |
| `quejas_inmueble` | Property complaints                                                            | Advisor specialty: `mantenimiento_contratos` |
| `comercial`       | Commercial/sales inquiries (prospects)                                         | Advisor specialty: `comercial`               |
| `faq`             | Frequently asked questions the bot resolves alone                              | No escalation                                |
| `sin_clasificar`  | Bot could not classify the intent after `MAX_CLASSIFICATION_ATTEMPTS` attempts | Channel: `administrativa`                    |

### AdvisorRole

| Value    | Permissions                                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asesor` | Sees only conversations in their area. Can reply, assign, return-bot, close (own), manage own profile and schedules.                                                                                                                                                       |
| `admin`  | Sees all conversations regardless of channel. Can reply to any assigned conversation, close any conversation, manage all advisors (CRUD), view and review behavior alerts, view any advisor's schedules. Cannot use `PATCH /advisors/{id}` on themselves — must use `/me`. |

### AdvisorArea

| Value            | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `administrativa` | Handles the administrative WhatsApp line (owners, maintenance, billing) |
| `comercial`      | Handles the commercial WhatsApp line (prospects, sales)                 |
| `ambas`          | Handles both lines. Advisor sees all conversations.                     |

### AdvisorSpecialty

| Value                     | Valid for area   | Description                                             |
| ------------------------- | ---------------- | ------------------------------------------------------- |
| `financiera`              | `administrativa` | Cartera, pagos, facturación, disputas                   |
| `mantenimiento_contratos` | `administrativa` | Mantenimiento de inmuebles y contratos de arrendamiento |
| `comercial`               | `comercial`      | Atención a prospectos y gestión comercial               |
| `null`                    | All areas        | General advisor — handles any intent within the channel |

### AvailabilityStatus

| Value       | Description                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `available` | Advisor is online and available to receive new escalations                                                                      |
| `break`     | Advisor is temporarily unavailable. New escalations will not be auto-routed to them. `status_until` may be set to auto-restore. |
| `offline`   | Advisor is offline. Same routing behavior as `break`.                                                                           |

### MessageDirection

| Value              | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `inbound`          | Message received from the client via WhatsApp                |
| `outbound_bot`     | Message sent to the client by the AI agent                   |
| `outbound_advisor` | Message sent to the client by a human advisor from the panel |

### MessageType

| Value      | Description                                         |
| ---------- | --------------------------------------------------- |
| `text`     | Plain text message                                  |
| `image`    | Image (JPEG, PNG, WebP)                             |
| `video`    | Video (MP4, 3GPP)                                   |
| `document` | Document (PDF, DOCX, XLSX)                          |
| `audio`    | Voice note or audio file (OGG, MPEG, MP4, AAC, AMR) |

### DeliveredVia

| Value             | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `webhook_meta`    | Message delivered via the Meta WhatsApp webhook (inbound from client or bot outbound) |
| `websocket_panel` | Message sent by an advisor from the internal panel                                    |

### EscalationReason

| Value                    | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `solicitud_usuario`      | Client explicitly requested to speak with a human advisor                                                            |
| `no_clasificado`         | Bot could not classify the intent after the maximum number of attempts                                               |
| `error_simi`             | SIMI external service failed the maximum number of times                                                             |
| `frustracion_detectada`  | LLM detected frustration signals in the client's messages                                                            |
| `control_manual_directo` | An advisor took direct manual control via `PATCH /conversations/{id}/take-control`, without the bot escalating first |

### AgentNotificationType

| Value              | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `comprobante_pago` | A client sent a payment receipt (image or PDF) to be registered |

### AgentNotificationStatus

| Value        | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| `pendiente`  | Waiting for an advisor                                           |
| `resuelta`   | An advisor handled it (e.g. registered the payment)              |
| `descartada` | An advisor dismissed it (duplicate, not actually a receipt, ...) |

### ClientType

| Value          | Description                            |
| -------------- | -------------------------------------- |
| `arrendatario` | Tenant                                 |
| `propietario`  | Property owner                         |
| `prospecto`    | Commercial prospect (not yet a client) |
| `desconocido`  | Identity not yet established           |

### Client identity: `phone_number` and `bsuid`

A client is identified by `phone_number`, by `bsuid`, or by both — **at least
one is always present, but either one may be `null`.**

| Field          | Type           | When it's `null`                                                                 |
| -------------- | -------------- | -------------------------------------------------------------------------------- |
| `phone_number` | `string\|null` | Contact reached us through a WhatsApp username and has not shared their number   |
| `bsuid`        | `string\|null` | Contact was created before WhatsApp usernames existed, or Meta sent no `user_id` |
| `user_name`    | `string\|null` | Meta has not sent a `username` for this contact — the common case                |

`bsuid` (Business-Scoped User ID) is an opaque per-business identifier, format
`{ISO-3166 alpha-2}.{alphanumeric}` (e.g. `CO.1A2B3C4D5E6F7G8H`). A parent
BSUID inserts `ENT` after the country code: `CO.ENT.1A2B3C…`.

**Frontend must not treat `phone_number` as always present.** When it is
`null`, show a non-dialable placeholder rather than an empty field — the
advisor otherwise sees a client with no identifier and no explanation. Never
render a `bsuid` as a phone number or build a `tel:`/`wa.me` link from it.

The bot asks these contacts for their real number via WhatsApp's Phone Number
Request CTA, so `phone_number` can become non-null later in the same
conversation.

#### `user_name` — the label to show when there is no number

`user_name` is the contact's public WhatsApp username handle (e.g. `ana.g`),
sent by Meta in the webhook and stored as-is. It exists to solve exactly the
placeholder problem above: `bsuid` is an opaque string no advisor can
recognize, and `user_name` is the same person's readable handle.

Suggested precedence for a client's display label: `full_name` →
`phone_number` → `user_name` → `bsuid`.

Three rules:

- **It is not an identifier.** Never look a client up by it, never send to it,
  never build a link from it. `phone_number` and `bsuid` are the identifiers.
- **It is not their name.** It is self-chosen and unverified — `full_name` is
  the only field holding a name the client actually gave us.
- **It can change.** The contact can edit their handle, and the stored value
  updates on their next message. It is never cleared: a webhook that omits it
  means "Meta didn't send it", not "they removed it".

Sent on every client payload — the conversation inbox, the conversation
detail, and the client directory — whenever we have it, regardless of whether
`phone_number` is present. Deciding when to show it is the panel's call.

---

## Frontend Integration Guide

### The 24-hour window

WhatsApp only lets a business send free-form messages within **24 hours of the client's last
inbound message**. Outside that window nothing but a pre-approved template gets through, and the
platform rejects the send outright (Meta error `131047`). This is a hard platform rule — there is
no plan, setting or workaround that extends it.

`whatsapp_window_expires_at` is when that window closes. It is returned by the two endpoints that
serve a **full** conversation object: `GET /conversations` (inbox) and `GET /conversations/{id}`
(detail). See rule 7 for the endpoints that do NOT carry it.

**Rules, in order of how easy they are to get wrong:**

1. **`null` means UNKNOWN, never expired.** Conversations that existed before this feature shipped,
   and any conversation with no inbound message yet, carry `null`. Do **not** grey out the
   composer, show a warning or block anything on `null` — render it exactly like an open window.

2. **Only the client's messages reset it.** Every inbound message restarts the clock at 24h from
   _that_ message. Replies from the advisor or from the bot do **not** extend it. This means a
   conversation with very recent activity can still be minutes from expiring — do not infer the
   window from `last_activity`, which moves in both directions.

3. **Compute the countdown client-side.** The API deliberately sends only the absolute instant,
   not `seconds_remaining` or `is_open`: any derived value is already stale by the time it renders.
   Tick a local timer against `whatsapp_window_expires_at`.

4. **Highlight at 2 hours remaining.** The agreed threshold for warning the advisor that she is
   running out of time to reach this client. Below zero, show the window as closed.

   Note for DEV: the backend can shorten the whole window (`WHATSAPP_WINDOW_HOURS`) so the
   cycle is testable in minutes. Against a 15-minute window every conversation reads as
   "closing", which is expected — the 2h threshold assumes production's 24h.

5. **Handle `409 WINDOW_EXPIRED` on all three reply endpoints.** The backend refuses the send
   before calling Meta. Show `detail.message` as-is — it is already written for the advisor, in
   Spanish. Do **not** clear the composer: she may want to copy what she wrote.

6. **Do not promise that templates reopen the conversation.** When template support ships, a
   template sends _one approved message_; the window reopens only if the client replies to it.
   Wording like "podrá volver a escribirle" is a promise the platform does not keep.

7. **Merge partial responses — never replace.** `PATCH /take-control`, `PATCH /return-bot` and
   `PATCH /close` return only the fields they changed (`id`, `status`, `bot_activo`, and for close
   the resolution fields). They deliberately omit `whatsapp_window_expires_at`, and also
   `priority`, `case_number`, `last_activity`, `unread_count` and `client`. If the store replaces
   the cached conversation with that response, the countdown disappears the moment an advisor
   takes control — along with the priority badge and the case number. Spread the response over the
   existing object.

**Suggested rendering:**

```js
const expiresAt = conversation.whatsapp_window_expires_at;

// null = unknown. Never treat it as closed.
if (expiresAt == null) return { state: "unknown", canReply: true };

const msLeft = new Date(expiresAt) - Date.now();
if (msLeft <= 0) return { state: "closed", canReply: false };
if (msLeft <= 2 * 3600e3) return { state: "closing", canReply: true, msLeft };
return { state: "open", canReply: true, msLeft };
```

A conversation closed by the job for this reason arrives over the WebSocket as an ordinary
`conversation.closed` with `reason: "window_expired"` — no new event to handle. Note it can land
**overnight**, unlike every other bot-initiated close.

### Authentication Flow

Always authenticate through the backend endpoint — never call Supabase Auth directly from the frontend. The backend enforces the `is_active` check before returning the token.

```javascript
// 1. Sign in via backend
const response = await fetch("/api/v1/panel/auth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

if (!response.ok) {
  const error = await response.json();
  // error.detail.code === "INVALID_TOKEN" → wrong credentials
  // error.detail.code === "ADVISOR_INACTIVE" → account disabled
  showLoginError(error.detail.message);
  return;
}

const data = await response.json();

// 2. Store the token
localStorage.setItem("panel_token", data.access_token);

// 3. Redirect to password change if required
if (data.must_change_password) {
  redirectToFirstLoginPage();
  return;
}

// 4. Use in every API call
const headers = {
  Authorization: `Bearer ${localStorage.getItem("panel_token")}`,
  "Content-Type": "application/json",
};

// 5. Handle token expiry (Supabase tokens expire in 1 hour)
// When any API call returns 401, redirect to login
// No automatic refresh — the advisor must log in again
```

---

### Loading the Inbox

```javascript
// 1. Fetch the advisor profile first (to know role, area, name)
const profile = await fetch("/api/v1/panel/advisors/me", { headers }).then(
  (r) => r.json(),
);

// 2. Fetch conversations
const inbox = await fetch("/api/v1/panel/conversations/?limit=20&offset=0", {
  headers,
}).then((r) => r.json());

// conversations in inbox.data.conversations, total in inbox.data.total
```

Use `status=escalada` to show only the escalation queue, or omit to show all conversations.

---

### Displaying the Case Number

Every conversation carries a `case_number` field (e.g. `"CE-2026-000043"`) — a short, human-readable reference clients and advisors can cite instead of the internal UUID. Show it in the inbox row and in the chat header:

```javascript
function CaseNumberBadge({ caseNumber }) {
  return <span className="case-badge">{caseNumber ?? "—"}</span>;
}
```

- **Always handle `null`**: conversations created before this feature shipped have `case_number: null` — render `—` (or hide the badge), never `"CE-null"` or similar.
- **It's static for the life of the conversation** — no need to re-fetch it on every message; it never changes once assigned, including across bot-close/reuse cycles within the grace window.
- Arrives in the initial `GET /conversations/` and `GET /conversations/{id}` payloads, and again in the `escalation.new` WebSocket event (see below) — no dedicated endpoint or extra fetch is needed to keep it in sync in real time.

---

### Rendering Messages

Each message object has a `msg_type` field that determines how it should be displayed. Use `msg_type` — not `content` or `media_url` nullability — as the source of truth for rendering decisions.

```javascript
function renderMessage(msg) {
  switch (msg.msg_type) {
    case "text":
      return <TextBubble text={msg.content} direction={msg.direction} />;

    case "audio":
      // Always render an audio player. Do NOT display transcription as text.
      // transcription is internal context for the AI — hidden from the advisor by default.
      return <AudioPlayer src={msg.media_url} direction={msg.direction} />;

    case "image":
      return <img src={msg.media_url} alt="Imagen" />;

    case "video":
      return <video src={msg.media_url} controls />;

    case "document":
      return (
        <a href={msg.media_url} target="_blank">
          Descargar documento
        </a>
      );

    default:
      return null;
  }
}
```

**`media_url` is always a signed Supabase Storage URL** (valid for 1 year) for any non-text message — never a raw Meta media ID. You can use it directly in `<img>`, `<audio>`, `<video>`, or `<a>` tags.

**`transcription`** is populated only for inbound audio messages processed by the bot. It contains the Whisper transcription text. Do not show it as message content — it exists so the AI has context across turns. You may optionally expose it as a collapsible "Ver transcripción" toggle beneath the audio player.

---

### Opening a Chat

```javascript
// offset=0 returns the LATEST 50 messages (ASC order within that window) —
// this is what a chat should open with, not the beginning of the conversation.
const detail = await fetch(
  `/api/v1/panel/conversations/${conversationId}?limit=50&offset=0`,
  { headers },
).then((r) => r.json());

const { messages, total_messages } = detail.data.conversation;
let loadedOffset = messages.length; // offset to request on the NEXT (older) page

// Register the subscription on the WebSocket
ws.send(
  JSON.stringify({
    type: "subscribe_conversation",
    conversation_id: conversationId,
  }),
);

// Load older messages on scroll (infinite scroll upward): increase offset by
// how many messages are already loaded — never decrease it or "jump to the end",
// offset=0 already is the end.
if (loadedOffset < total_messages) {
  const older = await fetch(
    `/api/v1/panel/conversations/${conversationId}/messages?limit=100&offset=${loadedOffset}`,
    { headers },
  ).then((r) => r.json());
  loadedOffset += older.data.messages.length;
  // Prepend older.data.messages to the currently rendered list.
}
```

---

### Sending a Message

**Text:**

```javascript
const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/reply`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "Tu respuesta aquí" }),
  },
).then((r) => r.json());

// response.data.message contains the saved message object
```

**Media (image, video, document):**

```javascript
const formData = new FormData();
formData.append("file", file); // File object from input
formData.append("caption", "Adjunto el estado de cuenta"); // optional

const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/reply/media`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` }, // NO Content-Type — let browser set multipart boundary
    body: formData,
  },
).then((r) => r.json());
```

**Audio (voice note):**

```javascript
const formData = new FormData();
formData.append("file", audioBlob, "voice_note.ogg");

const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/reply/audio`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData,
  },
).then((r) => r.json());
```

---

### Taking / Returning a Conversation

**Taking (self-assign):**

```javascript
const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/assign`,
  { method: "PATCH", headers },
).then((r) => r.json());
```

**Taking direct control (any non-closed conversation, no escalation needed):**

Use this instead of `assign` when the conversation is not `escalada` yet (the bot is still handling it) — or any time an advisor wants to step in immediately regardless of who it's routed to. No area/channel check, no `max_conversations` limit. A `409 CONTROL_ALREADY_TAKEN` means someone else got there first — `error.detail.message` already names them, safe to show directly in a toast.

```javascript
async function takeDirectControl(conversationId) {
  const response = await fetch(
    `/api/v1/panel/conversations/${conversationId}/take-control`,
    { method: "PATCH", headers },
  );

  if (response.status === 409) {
    const { detail } = await response.json();
    if (detail.code === "CONTROL_ALREADY_TAKEN") {
      showToast(detail.message, "warning"); // "X ya tiene el control..."
      return null;
    }
  }

  return response.json(); // { data: { conversation, escalation } }
}
```

Calling it again while you already hold control is safe — it returns `200` unchanged (idempotent), so a UI can call it on every "Take control" click without checking local state first.

**Returning to bot:**

Releases control taken either via `assign` or via `take-control` — same endpoint for both, no branching needed in the frontend.

```javascript
const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/return-bot`,
  { method: "PATCH", headers },
).then((r) => r.json());
```

**Closing:**

```javascript
// With full resolution data (from the modal)
const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/close`,
  {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      resolution_type: "consulta_cartera_resuelta",
      resolution_notes: "El propietario confirmó recibo.",
      client_satisfied: "si",
    }),
  },
).then((r) => r.json());

// Without body — applies defaults (resolution_type: "otro", client_satisfied: "sin_confirmar")
const response = await fetch(
  `/api/v1/panel/conversations/${conversationId}/close`,
  { method: "PATCH", headers },
).then((r) => r.json());

// response.data.conversation includes: status, resolution_type, resolution_notes,
// client_satisfied, closed_by, closed_at
```

---

### WebSocket Integration

```javascript
const jwt = localStorage.getItem("panel_token");
const ws = new WebSocket(
  `wss://<host>/api/v1/panel/ws?token=${encodeURIComponent(jwt)}`,
);

// Keepalive
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}, 30000);

ws.onmessage = (event) => {
  const { event: type, data } = JSON.parse(event.data);

  switch (type) {
    case "message.new":
      // Append message to the active conversation if it matches
      if (data.message.conversation_id === currentConversationId) {
        appendMessage(data.message);
      }
      // Update unread badge on conversation list
      updateConversationLastActivity(data.message.conversation_id);
      break;

    case "escalation.new":
      // New escalation arrived from the bot. data.case_number lets you show
      // the reference (e.g. in a toast) without an extra fetch — may be null
      // if the backend failed to look it up (fail-soft); re-fetch the
      // conversation detail in that case if you need to display it.
      if (data.advisor_id) {
        // Auto-assigned — update the card to show the assigned advisor
        updateConversationAssignment(
          data.conversation_id,
          data.advisor_id,
          null,
        );
      } else {
        // Unassigned queue — add or highlight in the inbox
        addToUnassignedQueue(
          data.conversation_id,
          data.channel,
          data.case_number,
        );
        showToast(
          `Nueva conversación en cola (${data.case_number ?? data.channel})`,
          "warning",
        );
      }
      break;

    case "queue.pending":
      // Received once at connection time when unassigned escalations exist.
      // Only sent to role='asesor' — never to admins.
      showToast(data.message, "info", { duration: 6000 });
      // Reload the inbox so it reflects the current queue state
      refreshBandeja();
      break;

    case "escalation.assigned":
      // An advisor self-assigned via the panel — update the conversation card
      updateConversationAssignment(
        data.conversation_id,
        data.advisor_id,
        data.advisor_name,
      );
      break;

    case "conversation.returned":
      // Conversation returned to bot control
      markConversationReturnedToBot(data.conversation_id);
      break;

    case "conversation.control_taken":
      // An advisor took direct manual control (no prior bot escalation
      // required) — same card update as escalation.assigned
      updateConversationAssignment(
        data.conversation_id,
        data.advisor_id,
        data.advisor_name,
      );
      break;

    case "conversation.closed":
      // Remove from inbox or update status indicator
      markConversationClosed(data.conversation_id);
      break;

    case "conversation.reopened":
      // A closed conversation was reopened (still within the WhatsApp 24h
      // window) — move it out of the closed view, same card update as
      // conversation.control_taken. No message.new follows automatically.
      updateConversationAssignment(
        data.conversation_id,
        data.advisor_id,
        data.advisor_name,
      );
      break;

    case "advisor.status_changed":
      // Update advisor availability badge in the team view
      updateAdvisorStatus(data.advisor_id, data.availability_status);
      break;

    case "advisor.connected":
    case "advisor.disconnected":
      // Update online presence indicators
      updateAdvisorPresence(data.advisor_id, type === "advisor.connected");
      break;

    case "behavior.alert":
      // Admin-only: show notification badge and fetch the new alert
      if (currentAdvisorRole === "admin") {
        showBehaviorAlertNotification(data.alert_id);
        refreshBehaviorAlerts();
      }
      break;

    case "notification.new":
    case "notification.updated":
      // Every advisor: upsert the row by id and update the nav badge
      upsertNotification(data.notification);
      setNotificationBadge(data.pending_count);
      break;
  }
};

ws.onclose = (event) => {
  if (event.code === 4001) {
    // Invalid JWT — redirect to login
    redirectToLogin();
  } else {
    // Reconnect with exponential backoff
    scheduleReconnect();
  }
};
```

---

### Loading Admin Dashboard Metrics

```javascript
// Admin-only — returns 403 for non-admins
const result = await apiCall("/api/v1/panel/metrics");
const metrics = result.data.metrics;
// metrics.activas, metrics.escaladas, metrics.en_atencion,
// metrics.tiempo_promedio_min, metrics.bot_ok_pct,
// metrics.capacidad_actual, metrics.capacidad_total
```

---

### Global Error Handling

```javascript
async function apiCall(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${localStorage.getItem("panel_token")}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json();
    const code = error.detail?.code;
    const message = error.detail?.message;

    switch (response.status) {
      case 401:
        showModal("Sesión expirada. Por favor inicia sesión nuevamente.");
        redirectToLogin();
        break;

      case 403:
        if (code === "ADVISOR_INACTIVE") {
          showModal(
            "Tu cuenta ha sido desactivada. Contacta a un administrador.",
          );
          redirectToLogin();
        } else if (code === "FORBIDDEN") {
          showToast("No tienes permiso para realizar esta acción.", "error");
        } else if (code === "CONVERSATION_OUTSIDE_AREA") {
          showToast("Esta conversación no pertenece a tu área.", "warning");
        } else if (code === "BOT_IS_ACTIVE") {
          showToast("El bot tiene el control de esta conversación.", "warning");
        } else if (code === "NOT_ASSIGNED") {
          showToast("No estás asignado a esta conversación.", "warning");
        } else if (code === "BOT_ALREADY_ACTIVE") {
          showToast("El bot ya controla esta conversación.", "info");
        } else {
          showToast(message || "Acceso denegado.", "error");
        }
        break;

      case 404:
        showEmptyState("El recurso no fue encontrado.");
        break;

      case 409:
        if (code === "ALREADY_ASSIGNED") {
          showToast("Otro asesor tomó esta conversación primero.", "warning");
        } else if (code === "MAX_CONVERSATIONS_REACHED") {
          showToast(message, "warning"); // message includes counts
        } else if (code === "ALREADY_CLOSED") {
          showToast("Esta conversación ya fue cerrada.", "info");
        } else if (code === "ALREADY_REVIEWED") {
          showToast("Esta alerta ya fue revisada.", "info");
        } else if (code === "CONVERSATION_NOT_ESCALATED") {
          showToast("La conversación no está en estado escalado.", "warning");
        } else if (code === "CONTROL_ALREADY_TAKEN") {
          showToast(message, "warning"); // message already names the advisor who has it
        } else if (code === "CONVERSATION_NOT_ACTIVE") {
          showToast("Esta conversación está cerrada.", "warning");
        } else {
          showToast(
            message || "Conflicto al procesar la solicitud.",
            "warning",
          );
        }
        break;

      case 500:
        showToast("Error interno del servidor. Intenta nuevamente.", "error");
        break;

      case 502:
        if (code === "META_API_ERROR") {
          showToast(
            "No se pudo enviar el mensaje a WhatsApp. Intenta nuevamente.",
            "error",
          );
        } else if (code === "STORAGE_ERROR") {
          showToast(
            "Error al guardar el archivo. Intenta nuevamente.",
            "error",
          );
        } else {
          showToast("Error de comunicación con un servicio externo.", "error");
        }
        break;

      case 503:
        showToast("Servicio de almacenamiento no disponible.", "error");
        break;

      default:
        showToast(`Error inesperado (${response.status}).`, "error");
    }

    throw new Error(code || `HTTP ${response.status}`);
  }

  return response.json();
}
```

---

## Inconsistencies Found

The following gaps were found between the current code and the CLAUDE.md specification:

1. **CLAUDE.md marks PW-2..6 (`bandeja`, `reply`, `media`) as `⬜ Pendientes`** but all of these endpoints (`GET /conversations/`, `GET /{id}`, `POST /reply`, `POST /reply/media`, `POST /reply/audio`) are fully implemented in the code.

2. **CLAUDE.md marks PW-12 (`PATCH /advisors/{id}`) as `⬜ Pendiente`** but it is fully implemented in the code.

3. **CLAUDE.md marks PW-13..18 (alerts + schedules) as `⬜ Pendientes`** but all of these endpoints are fully implemented in the code.

4. **CLAUDE.md marks PW-21 (`PATCH /advisors/me/availability`) as `⬜ Pendiente`** but it is fully implemented in the code.

5. **`POST /api/v1/panel/advisors/` does not validate `specialty` against `area`** — The `_validate_specialty_area` helper exists and is used by `PATCH /{advisor_id}`, but it is not called during `POST /`. It is possible to create an advisor with an invalid area/specialty combination.

6. **`behavior.alert` WebSocket event payload contains only `alert_id`** — This is an intentional design choice per the code comment, but it requires the frontend to make a follow-up API call to get the full alert. This is not documented anywhere in CLAUDE.md.

7. **`AdvisorRepository.update_availability` stores `status_until` as a naive Bogotá local time** — The `status_until` value returned from any endpoint echoing the advisor object will be a naive ISO string without a timezone suffix. Frontend code that parses this field must not assume UTC.
