import { useEffect, useId, useRef, useState } from 'react'
import type { NotificationCloseStatus } from '../../types'
import { NOTE_MAX_LENGTH, buildCloseNoteSchema } from '../../lib/notificationNote'

const COPY: Record<NotificationCloseStatus, { title: string; subtitle: string; confirm: string; placeholder: string }> = {
  resuelta: {
    title: 'Marcar como resuelta',
    subtitle: 'Confirma que el comprobante ya quedó registrado.',
    confirm: 'Marcar como resuelta',
    placeholder: 'Ej: Registrado en el sistema contable',
  },
  descartada: {
    title: 'Descartar notificación',
    subtitle: 'Úsalo si no es un comprobante válido o está duplicado.',
    confirm: 'Descartar',
    placeholder: 'Ej: Comprobante duplicado del caso anterior',
  },
}

interface CloseNotificationDialogProps {
  status: NotificationCloseStatus
  /** Which notification this acts on, e.g. "Juan Pérez · $ 1.850.000 · Canon". */
  context: string
  isSubmitting: boolean
  error: string | null
  onConfirm: (note: string) => void
  onCancel: () => void
}

export default function CloseNotificationDialog({
  status,
  context,
  isSubmitting,
  error,
  onConfirm,
  onCancel,
}: CloseNotificationDialogProps) {
  const [note, setNote] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const copy = COPY[status]
  const required = status === 'descartada'

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        event.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isSubmitting, onCancel])

  function handleConfirm() {
    const result = buildCloseNoteSchema(status).safeParse(note)
    if (!result.success) {
      setValidationError(result.error.issues[0]?.message ?? 'Nota inválida.')
      return
    }
    setValidationError(null)
    onConfirm(result.data)
  }

  const shownError = validationError ?? error

  return (
    // Solid scrim, no backdrop-blur (CLAUDE.md §16.1).
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-bg-secondary border border-border-default rounded-panel max-w-md w-full max-h-[90vh] flex flex-col shadow-md"
      >
        <header className="p-5 pb-3 shrink-0">
          <h3 id={titleId} className="text-h3 text-text-primary">{copy.title}</h3>
          <p className="text-xs text-text-secondary mt-0.5">{copy.subtitle}</p>
          <p className="mt-2 rounded-control bg-bg-tertiary border border-border-default px-2.5 py-1.5 text-[11px] text-text-primary break-words">
            {context}
          </p>
        </header>

        <div className="app-scroll px-5 overflow-y-auto min-h-0 space-y-1.5">
          <label htmlFor={`${titleId}-note`} className="text-label text-text-secondary uppercase block">
            Nota{' '}
            <span className="ml-1 normal-case font-normal">{required ? '(obligatoria)' : '(opcional)'}</span>
          </label>
          <textarea
            id={`${titleId}-note`}
            ref={textareaRef}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              if (validationError) setValidationError(null)
            }}
            placeholder={copy.placeholder}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            aria-invalid={Boolean(validationError)}
            className="w-full bg-bg-tertiary border border-border-default rounded-md p-2.5 text-white text-xs outline-none focus:border-brand-blue transition resize-none placeholder-text-secondary/50"
          />
          <div className="flex justify-between gap-2 text-[10px]">
            <span className="text-error" role="alert">{shownError}</span>
            <span className="text-text-secondary shrink-0">{note.length}/{NOTE_MAX_LENGTH}</span>
          </div>
        </div>

        <footer className="p-5 pt-3 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 py-2.5 text-xs border border-border-default text-text-secondary rounded-control hover:border-text-primary hover:text-text-primary transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={[
              'flex-1 py-2.5 text-xs font-bold rounded-control transition disabled:opacity-50 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90',
              status === 'resuelta'
                ? 'bg-success/15 border border-success/40 text-success hover:bg-success/25'
                : 'bg-error/10 border border-error/30 text-error hover:bg-error/20',
            ].join(' ')}
          >
            {isSubmitting && (
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            )}
            {copy.confirm}
          </button>
        </footer>
      </div>
    </div>
  )
}
