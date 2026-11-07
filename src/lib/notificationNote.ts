import { z } from 'zod'
import type { NotificationCloseStatus } from '../types'

export const NOTE_MAX_LENGTH = 500

// Frontend-only rule: discarding requires a reason so the team can tell later
// why a receipt was not registered. The backend accepts the note as optional.
export function buildCloseNoteSchema(status: NotificationCloseStatus) {
  const base = z.string().trim().max(NOTE_MAX_LENGTH, `Máximo ${NOTE_MAX_LENGTH} caracteres.`)
  return status === 'descartada' ? base.min(1, 'Indica por qué descartas esta notificación.') : base
}
