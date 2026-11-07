import { useCallback, useEffect, useRef, useState } from 'react'
import { conversationsService } from '../../services/conversations'
import { useSendQueue } from '../../hooks/useSendQueue'
import AudioRecorder from './AudioRecorder'
import type { Message } from '../../types'
import {
  formatWindowCountdown,
  WINDOW_CLOSED_REASON,
  windowClosedReason,
  windowCountdownHint,
  type WhatsAppWindowInfo,
} from '../../lib/whatsappWindow'

const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    label: '😃',
    title: 'Expresiones',
    emojis: [
      '😊', '😂', '🤣', '🥰', '😍', '🤩', '😜', '😎', '🤔', '🤫', 
      '🙄', '😬', '😴', '😢', '😡', '🤯', '👍', '👎', '👏', '🙌', 
      '🙏', '👋', '❤️', '🔥', '✨', '🎉', '💡', '💯'
    ]
  },
  {
    id: 'realestate',
    label: '🏠',
    title: 'Inmobiliaria',
    emojis: [
      '🏠', '🏡', '🏢', '🏬', '🔑', '🗝️', '📅', '📆', '📍', '🗺️',
      '🤝', '✍️', '📞', '✉️', '💰', '💵', '📋', '🏷️', '🛠️', '🚧',
      '📌', '🛋️', '🛏️', '🚿', '🛀', '🚗', '🌳'
    ]
  },
  {
    id: 'symbols',
    label: '✅',
    title: 'Símbolos',
    emojis: [
      '✅', '❌', '⚠️', '🚀', '💬', 'ℹ️', '🔔', '🌟', '🔍', '🕒',
      '📣', '📌', '📈', '📉', '📎', '🔒', '🔓', '🛡️', '⚙️', '🔄'
    ]
  }
]

interface ChatInputProps {
  conversationId: string
  clientName: string
  /** Display label for the conversation's owning agent (see lib/agentLabels.ts) — not the WhatsApp line's `channel`. */
  agentDisplay: string
  waitMinutes: number | null
  currentAdvisorName?: string
  onOptimisticMessage: (message: Message) => void
  onMessageConfirmed: (localId: string, message: Message) => void
  onMessageFailed: (localId: string) => void
  variant?: string
  onTypingChange?: (isTyping: boolean) => void
  /** Live state of Meta's 24h window — see lib/whatsappWindow.ts. */
  whatsappWindow: WhatsAppWindowInfo
  /**
   * The backend refused a send with 409 WINDOW_EXPIRED: the window closed
   * between the last fetch and this attempt. Lets the page mark the
   * conversation as closed without waiting for the local timer to notice.
   */
  onWindowExpired?: () => void
  /**
   * Hands the page a stable function that retries a failed message by its
   * `_localId` (null on unmount). The page wires it to the bubble's retry button.
   */
  onRegisterRetry?: (retry: ((localId: string) => void) | null) => void
}

// What a failed bubble needs to be sent again — the optimistic bubble itself plus
// the payload. Entries live until the server confirms the message.
type OutboxEntry = {
  localId: string
  conversationId: string
  bubble: Message
} & (
  | { kind: 'text'; text: string }
  | { kind: 'media'; file: File; caption: string | undefined; bubbleUrl: string }
)

function makeLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// WhatsApp Cloud API only supports jpeg and png for images.
// webp is excluded: Meta accepts the upload but silently drops delivery.
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const FILE_TYPES = {
  image: {
    label: 'Imagen',
    accept: 'image/jpeg,image/png',
    maxMB: 5,
    iconColor: 'var(--color-brand-blue)',
  },
  document: {
    label: 'Documento',
    accept: 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    maxMB: 50,
    iconColor: 'var(--color-warning)',
  },
  video: {
    label: 'Video',
    accept: 'video/mp4,video/3gpp',
    maxMB: 16,
    iconColor: 'var(--color-success)',
  },
}

const FILE_ICON_COLORS: Record<keyof typeof FILE_TYPES, string> = {
  image:    'bg-brand-blue/15 border-brand-blue/30 text-brand-blue',
  document: 'bg-warning/15 border-warning/30 text-warning',
  video:    'bg-success/15 border-success/30 text-success',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileLabel(mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    return mimeType.split('/')[1].toUpperCase()  // JPEG, PNG
  }
  if (mimeType.includes('pdf')) return 'PDF'
  if (mimeType.includes('wordprocessingml')) return 'DOCX'
  if (mimeType.includes('spreadsheetml')) return 'XLSX'
  if (mimeType.startsWith('video/')) return 'MP4'
  return 'Archivo'
}

function getFileType(mimeType: string): keyof typeof FILE_TYPES | null {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.includes('pdf') ||
      mimeType.includes('wordprocessingml') ||
      mimeType.includes('spreadsheetml')) return 'document'
  return null
}

function getDocIconInfo(mimeType: string) {
  if (mimeType === 'application/pdf') {
    return { icon: '📕', color: 'var(--color-error)', label: 'documento PDF' }
  }
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) {
    return { icon: '📘', color: 'var(--color-brand-blue)', label: 'documento Word' }
  }
  if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) {
    return { icon: '📗', color: 'var(--color-success)', label: 'hoja de cálculo Excel' }
  }
  return { icon: '📄', color: 'var(--color-text-secondary)', label: 'documento' }
}

function FileIcon({ category }: { category: keyof typeof FILE_TYPES }) {
  if (category === 'image') return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
  if (category === 'video') return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  )
}

interface DocxPreviewProps {
  file: File
}

function DocxPreview({ file }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadDocx() {
      if (active) {
        setLoading(true)
        setError(null)
      }
      try {
        if (!containerRef.current) return
        // H-03: Replace innerHTML with replaceChildren to prevent XSS
        containerRef.current.replaceChildren()
        const { renderAsync } = await import('docx-preview')

        if (active && containerRef.current) {
          await renderAsync(file, containerRef.current, undefined, {
            className: 'docx-rendered',
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: false,
            experimental: true
          })
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to render DOCX preview:', {
          message: err instanceof Error ? err.message : 'unknown',
        })
        if (active) {
          setError('No se pudo renderizar la vista previa de Word.')
          setLoading(false)
        }
      }
    }

    loadDocx()

    return () => {
      active = false
    }
  }, [file])

  return (
    <div className="w-full h-full min-h-[420px] max-h-[58vh] overflow-auto rounded-lg border border-border-default/30 bg-doc-surface p-4 sm:p-6 relative docx-preview-scroll">
      <style>{`
        /* Scrollbars inside the preview */
        .docx-preview-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .docx-preview-scroll::-webkit-scrollbar-track {
          background: var(--color-doc-surface);
        }
        .docx-preview-scroll::-webkit-scrollbar-thumb {
          background: var(--color-doc-scroll-thumb);
          border-radius: 4px;
        }
        .docx-preview-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--color-doc-scroll-thumb-hover);
        }

        .docx-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          width: 100%;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }
        .docx-container section.docx {
          background: white !important;
          color: var(--color-doc-text) !important;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.05) !important;
          border-radius: 8px !important;
          padding: 24px !important;
          max-width: 800px !important;
          width: 100% !important;
          box-sizing: border-box !important;
          min-height: auto !important;
          margin: 0 auto !important;
        }
        @media (min-width: 640px) {
          .docx-container section.docx {
            padding: 48px !important;
          }
        }
        
        /* Overrides inside docx to look polished and cohesive */
        .docx-container section.docx span, 
        .docx-container section.docx p, 
        .docx-container section.docx h1, 
        .docx-container section.docx h2, 
        .docx-container section.docx h3, 
        .docx-container section.docx h4,
        .docx-container section.docx td,
        .docx-container section.docx th {
          font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
          color: var(--color-doc-text) !important;
        }
        
        .docx-container section.docx img {
          max-width: 100% !important;
          height: auto !important;
          border-radius: 4px;
        }

        .docx-container section.docx table {
          border-collapse: collapse !important;
          width: 100% !important;
          margin: 15px 0 !important;
        }

        .docx-container section.docx td,
        .docx-container section.docx th {
          border: 1px solid var(--color-doc-border) !important;
          padding: 8px !important;
        }
      `}</style>

      {loading && (
        <div className="absolute inset-0 bg-bg-tertiary/95 flex flex-col items-center justify-center gap-3 z-20">
          <div className="w-8 h-8 border-4 border-brand-blue border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-white/90">Procesando y mejorando vista de Word...</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 bg-bg-secondary flex flex-col items-center justify-center text-center p-4 z-20">
          <span className="text-3xl">📘</span>
          <p className="text-sm font-semibold text-white mt-3">{file.name}</p>
          <p className="text-xs text-error mt-1">{error}</p>
        </div>
      )}
      <div ref={containerRef} className="docx-container" />
    </div>
  )
}

// xlsx (SheetJS) was replaced with exceljs: the npm-published xlsx build
// carries unpatched prototype-pollution and ReDoS advisories with no fix
// available on the registry (2026-08 security audit finding F-03). Rendering
// via a real React <table> (instead of injecting xlsx-generated HTML through
// dangerouslySetInnerHTML) also removes the need for DOMPurify here entirely
// (finding F-04) — React's default escaping is the only sanitization needed.
type SheetData = string[][]

interface ExcelPreviewProps {
  file: File
}

function ExcelPreview({ file }: ExcelPreviewProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [sheetRows, setSheetRows] = useState<SheetData>([])
  const workbookRef = useRef<import('exceljs').Workbook | null>(null)

  useEffect(() => {
    let active = true

    async function loadExcel() {
      if (active) {
        setLoading(true)
        setError(null)
      }
      try {
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        const arrayBuffer = await file.arrayBuffer()
        await workbook.xlsx.load(arrayBuffer)
        workbookRef.current = workbook

        if (active) {
          if (workbook.worksheets.length === 0) {
            throw new Error('El archivo Excel no contiene hojas.')
          }
          setSheets(workbook.worksheets.map((ws) => ws.name))
          const firstSheet = workbook.worksheets[0]
          setActiveSheet(firstSheet.name)
          renderSheet(firstSheet)
        }
      } catch (err) {
        console.error('Failed to render Excel preview:', {
          message: err instanceof Error ? err.message : 'unknown',
        })
        if (active) {
          setError('No se pudo renderizar la vista previa de Excel.')
          setLoading(false)
        }
      }
    }

    loadExcel()

    return () => {
      active = false
    }
  }, [file])

  function renderSheet(worksheet: import('exceljs').Worksheet) {
    try {
      setLoading(true)
      const rows: SheetData = []
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        const cells: string[] = []
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.text ?? '')
        })
        rows.push(cells)
      })
      setSheetRows(rows)
      setLoading(false)
    } catch (err) {
      console.error('Failed to render sheet:', {
        message: err instanceof Error ? err.message : 'unknown',
      })
      setError('Error al cambiar de hoja.')
      setLoading(false)
    }
  }

  function handleSheetChange(sheetName: string) {
    const worksheet = workbookRef.current?.getWorksheet(sheetName)
    if (worksheet) {
      setActiveSheet(sheetName)
      renderSheet(worksheet)
    }
  }

  return (
    <div className="w-full h-full min-h-[420px] max-h-[58vh] flex flex-col rounded-lg border border-border-default/30 bg-doc-surface relative text-black overflow-hidden">
      <style>{`
        /* Excel Table styling */
        .excel-table-container table {
          border-collapse: collapse !important;
          width: 100% !important;
          font-size: 11px !important;
          font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
          color: var(--color-doc-text) !important;
          background-color: white !important;
        }
        .excel-table-container tr:nth-child(even) {
          background-color: var(--color-doc-surface) !important;
        }
        .excel-table-container tr:hover {
          background-color: var(--color-doc-surface-muted) !important;
        }
        .excel-table-container td {
          border: 1px solid var(--color-doc-border) !important;
          padding: 6px 12px !important;
          white-space: nowrap !important;
          min-width: 60px !important;
          text-align: left !important;
        }
        
        /* Excel sheets tab styling */
        .excel-tabs::-webkit-scrollbar {
          height: 4px;
        }
        .excel-tabs::-webkit-scrollbar-track {
          background: var(--color-doc-surface-muted);
        }
        .excel-tabs::-webkit-scrollbar-thumb {
          background: var(--color-doc-scroll-thumb);
          border-radius: 2px;
        }
      `}</style>

      {/* Sheets Navigation Bar */}
      {sheets.length > 1 && (
        <div className="excel-tabs flex items-center gap-1.5 px-4 py-2 border-b border-doc-border bg-white overflow-x-auto shrink-0 select-none">
          {sheets.map((sheet) => (
            <button
              key={sheet}
              type="button"
              onClick={() => handleSheetChange(sheet)}
              className={`px-3 py-1 text-label uppercase rounded-control border transition shrink-0 ${
                activeSheet === sheet
                  ? 'bg-success border-success text-white'
                  : 'bg-doc-surface-muted border-doc-border text-doc-text-muted hover:bg-doc-border'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90`}
            >
              {sheet}
            </button>
          ))}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-4 excel-table-container docx-preview-scroll">
        {loading && (
          <div className="absolute inset-0 bg-bg-tertiary/95 flex flex-col items-center justify-center gap-3 z-20">
            <div className="w-8 h-8 border-4 border-brand-blue border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-white/90">Cargando datos de Excel...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 bg-bg-secondary flex flex-col items-center justify-center text-center p-4 z-20">
            <span className="text-3xl">📗</span>
            <p className="text-sm font-semibold text-white mt-3">{file.name}</p>
            <p className="text-xs text-error mt-1">{error}</p>
          </div>
        )}
        {!loading && !error && (
          <table className="w-full inline-block min-w-full">
            <tbody>
              {sheetRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function isWindowExpired(error: unknown): boolean {
  const err = error as { response?: { data?: { detail?: { code?: string } } } }
  return err.response?.data?.detail?.code === 'WINDOW_EXPIRED'
}

function getErrorMessage(
  error: unknown,
  fallback: string,
  file?: File,
  // Client-specific wording for a closed window, resolved by the caller (this
  // helper is module-level and has no client name in scope).
  windowClosedText: string = WINDOW_CLOSED_REASON,
): string {
  const err = error as { response?: { data?: { detail?: { code?: string; message?: string } } } }
  const code = err.response?.data?.detail?.code
  const backendMsg = err.response?.data?.detail?.message

  switch (code) {
    case 'EMPTY_MESSAGE':
      return 'El mensaje no puede estar vacío o contener solo espacios.'
    case 'MESSAGE_TOO_LONG':
      return 'El mensaje supera el límite de 4096 caracteres.'
    case 'BOT_IS_ACTIVE':
      return 'El bot tiene el control de esta conversación.'
    case 'NOT_ASSIGNED':
      return 'No estás asignado a esta conversación.'
    case 'FILE_TOO_LARGE': {
      if (file) {
        const category = getFileType(file.type)
        const limitMB = category ? FILE_TYPES[category].maxMB : 20
        return `El archivo supera el límite de tamaño permitido (${limitMB} MB).`
      }
      return 'El archivo supera el límite de tamaño permitido.'
    }
    case 'FILE_TYPE_NOT_ALLOWED':
      return 'El tipo de archivo no está permitido.'
    case 'META_API_ERROR':
      return 'No se pudo enviar el mensaje a WhatsApp. Intenta nuevamente.'
    case 'STORAGE_ERROR':
      return 'Error de almacenamiento al subir el archivo. Intenta de nuevo.'
    case 'WINDOW_EXPIRED':
      // The backend message is already written for the advisor, in Spanish and
      // in "usted" — show it verbatim instead of paraphrasing it here.
      return backendMsg || windowClosedText
    default:
      return backendMsg || fallback
  }
}

export default function ChatInput({
  conversationId,
  clientName,
  agentDisplay,
  waitMinutes,
  currentAdvisorName,
  onOptimisticMessage,
  onMessageConfirmed,
  onMessageFailed,
  variant = 'assigned',
  onTypingChange,
  whatsappWindow,
  onWindowExpired,
  onRegisterRetry,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [emojiMenuOpen, setEmojiMenuOpen] = useState(false)
  const [emojiCategory, setEmojiCategory] = useState('smileys')
  const [sendError, setSendError] = useState<string | null>(null)
  const [recorderState, setRecorderState] = useState<string>('idle')

  // `unknown` (legacy conversations, no inbound message yet) must behave exactly
  // like an open window — only a window we KNOW is closed blocks the composer.
  const isWindowClosed = whatsappWindow.state === 'closed'
  const canCompose = variant === 'assigned' && !isWindowClosed
  // `clientName` arrives already defaulted to a generic placeholder when the
  // contact has no name, so the copy helpers resolve it instead of trusting it.
  const windowClosedText = windowClosedReason(clientName)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const emojiMenuRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Sends are queued so the composer never waits on the network and messages
  // leave in the order they were written (see hooks/useSendQueue.ts).
  const { enqueue } = useSendQueue()
  // Unconfirmed messages by `_localId`, kept so a failed bubble can be retried
  // in place instead of a duplicate "sending" bubble appearing.
  const outboxRef = useRef(new Map<string, OutboxEntry>())

  // Auto-focus textarea when switching conversations, loading, or when recording ends
  useEffect(() => {
    if (canCompose && recorderState === 'idle') {
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [conversationId, canCompose, recorderState])

  // Release the preview URL when unmounting
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const updateTypingStatus = (status: boolean) => {
    if (typingTimeoutRef.current && !status) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    if (onTypingChange) {
      onTypingChange(status)
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  // Cerrar al hacer clic fuera y con Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!attachMenuRef.current?.contains(e.target as Node)) {
        setAttachMenuOpen(false)
      }
      if (!emojiMenuRef.current?.contains(e.target as Node)) {
        setEmojiMenuOpen(false)
      }
    }
    function handleEscapeKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAttachMenuOpen(false)
        setEmojiMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscapeKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscapeKey)
    }
  }, [])

  function toggleAttachMenu() {
    setAttachMenuOpen((open) => !open)
  }

  function insertEmoji(emoji: string) {
    if (!textareaRef.current) return

    const start = textareaRef.current.selectionStart
    const end = textareaRef.current.selectionEnd
    const currentText = text

    const before = currentText.substring(0, start)
    const after = currentText.substring(end)
    const newText = before + emoji + after

    if (newText.length > 2000) {
      showError('El mensaje supera el límite de 2000 caracteres.')
      return
    }

    setText(newText)
    updateTypingStatus(true)

    // Focus the textarea and set the cursor position right after the inserted emoji
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const newCursorPos = start + emoji.length
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 10)
  }

  function triggerFileInput(type: keyof typeof FILE_TYPES) {
    setAttachMenuOpen(false)
    if (fileInputRef.current) {
      fileInputRef.current.accept = FILE_TYPES[type].accept
      fileInputRef.current.click()
    }
  }

  function processFile(file: File) {
    // Detect media type based on MIME
    const type = getFileType(file.type)
    if (!type) {
      showError('Tipo de archivo no permitido')
      return
    }
    // WhatsApp only delivers jpeg and png — reject webp before hitting the backend
    if (type === 'image' && !ALLOWED_IMAGE_TYPES.has(file.type)) {
      showError('Solo se permiten imágenes JPEG o PNG. WhatsApp no soporta WebP.')
      return
    }
    // Validate file size
    const maxBytes = FILE_TYPES[type].maxMB * 1024 * 1024
    if (file.size > maxBytes) {
      showError(
        `El archivo supera el límite de ${FILE_TYPES[type].maxMB}MB`
      )
      return
    }
    setSelectedFile(file)

    // Revoke old URL if exists
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    if (type === 'image' || type === 'video' || type === 'document') {
      setPreviewModalOpen(true)
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    processFile(file)
    // Limpiar el input para permitir seleccionar
    // el mismo archivo dos veces
    e.target.value = ''
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!canCompose || selectedFile) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          processFile(file)
        }
        return
      }
    }
  }

  function removeSelectedFile() {
    setSelectedFile(null)
    setPreviewModalOpen(false)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
  }

  function showError(message: string) {
    setSendError(message)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      updateTypingStatus(false)
      handleSend()
    }
  }

  function scrollFeedToEnd() {
    setTimeout(() => {
      const feed = document.getElementById('chat-message-feed')
      if (feed) feed.scrollTop = feed.scrollHeight
    }, 50)
  }

  // Queues the request for an already-painted bubble. The queue runs entries one
  // at a time, so the order the advisor wrote is the order Meta receives.
  function enqueueEntry(entry: OutboxEntry) {
    const { localId } = entry
    outboxRef.current.set(localId, entry)

    enqueue({
      run: async () => {
        const { message } =
          entry.kind === 'text'
            ? await conversationsService.replyText(entry.conversationId, entry.text)
            : await conversationsService.replyMedia(entry.conversationId, entry.file, entry.caption)
        outboxRef.current.delete(localId)
        onMessageConfirmed(localId, message)
        if (entry.kind === 'media') URL.revokeObjectURL(entry.bubbleUrl)
      },
      onFailure: (error) => {
        onMessageFailed(localId)
        setSendError(
          getErrorMessage(
            error,
            entry.kind === 'text'
              ? 'No pudimos enviar el mensaje. Revisa tu conexión e intenta de nuevo.'
              : 'No se pudo enviar el archivo.',
            entry.kind === 'media' ? entry.file : undefined,
            windowClosedText,
          ),
        )
        if (isWindowExpired(error)) onWindowExpired?.()
      },
      // Never left the browser: an earlier message failed first.
      onSkipped: () => onMessageFailed(localId),
    })
  }

  function retryMessage(localId: string) {
    const entry = outboxRef.current.get(localId)
    if (!entry) return
    if (isWindowClosed) {
      setSendError(windowClosedText)
      return
    }
    setSendError(null)
    onOptimisticMessage({ ...entry.bubble, _status: 'sending' })
    enqueueEntry(entry)
  }

  // The retry function handed to the page must stay stable across renders while
  // always calling the latest closure (current window state, callbacks).
  const retryMessageRef = useRef(retryMessage)
  useEffect(() => {
    retryMessageRef.current = retryMessage
  })
  const stableRetry = useCallback((localId: string) => retryMessageRef.current(localId), [])
  useEffect(() => {
    onRegisterRetry?.(stableRetry)
    return () => onRegisterRetry?.(null)
  }, [onRegisterRetry, stableRetry])

  function sendTextMessage() {
    const trimmed = text.trim()
    const localId = makeLocalId()
    const now = new Date().toISOString()

    // Paint the bubble immediately — the HTTP round-trip (Meta + Storage + DB)
    // can take a few seconds and shouldn't block the perceived send.
    const bubble: Message = {
      id: localId,
      conversation_id: conversationId,
      wam_id: null,
      direction: 'outbound_advisor',
      msg_type: 'text',
      content: trimmed,
      media_url: null,
      media_mime_type: null,
      media_size_bytes: null,
      transcription: null,
      delivered_via: 'panel',
      timestamp: now,
      created_at: now,
      advisor_name: currentAdvisorName ?? null,
      _localId: localId,
      _status: 'sending',
    }
    onOptimisticMessage(bubble)
    setText('')
    setSendError(null)
    scrollFeedToEnd()

    enqueueEntry({ kind: 'text', localId, conversationId, bubble, text: trimmed })
  }

  function sendSelectedFile(file: File) {
    // PW-5 — enviar multimedia
    const caption = text.trim() || undefined
    const category = getFileType(file.type) ?? 'document'
    const localId = makeLocalId()
    const now = new Date().toISOString()
    // The composer's own preview URL is released as soon as the composer clears,
    // so the bubble gets its own until the server's signed URL replaces it.
    const bubbleUrl = URL.createObjectURL(file)

    const bubble: Message = {
      id: localId,
      conversation_id: conversationId,
      wam_id: null,
      direction: 'outbound_advisor',
      msg_type: category,
      content: caption ?? null,
      media_url: bubbleUrl,
      media_mime_type: file.type,
      media_size_bytes: file.size,
      transcription: null,
      delivered_via: 'panel',
      timestamp: now,
      created_at: now,
      advisor_name: currentAdvisorName ?? null,
      _localId: localId,
      _status: 'sending',
      _fileName: file.name,
    }
    onOptimisticMessage(bubble)
    removeSelectedFile()
    setText('')
    setSendError(null)
    scrollFeedToEnd()

    enqueueEntry({ kind: 'media', localId, conversationId, bubble, file, caption, bubbleUrl })
  }

  function handleSend() {
    updateTypingStatus(false)
    // Belt and braces: every entry point is disabled while the window is closed,
    // but a stale keydown must not slip a doomed request past it either.
    if (isWindowClosed) {
      setSendError(windowClosedText)
      return
    }
    if (selectedFile) {
      sendSelectedFile(selectedFile)
      return
    }
    if (text.trim()) {
      // PW-4 — enviar texto
      sendTextMessage()
    }
  }

  const activeCategory = selectedFile ? (getFileType(selectedFile.type) ?? 'document') : 'document'

  return (
    <div className="p-3 bg-bg-secondary border-t border-border-default shrink-0 space-y-2">
      {/* Context bar */}
      <div
        id="chat-context-restriction-bar"
        className="bg-bg-tertiary/50 px-3.5 py-2 border border-border-default/50 rounded-lg flex flex-wrap justify-between items-center text-[10px] sm:text-[11px] text-text-secondary shadow-sm"
      >
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-blue animate-pulse" />
          <span>
            Respondiendo a: <strong className="text-white">{clientName}</strong>
            {' • '}Agente {agentDisplay}
          </span>
        </div>
        {waitMinutes !== null && waitMinutes > 0 && (
          <div className="text-warning flex items-center gap-1 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
            <span>⚠️ Esperando respuesta hace {waitMinutes} m</span>
          </div>
        )}
        {/* Countdown only when we actually know the expiry: a null window is
            UNKNOWN, and showing nothing is the correct render for it. */}
        {whatsappWindow.msLeft !== null && !isWindowClosed && (
          <div
            id="chat-window-countdown"
            className={`flex items-center gap-1 font-semibold ${
              whatsappWindow.state === 'closing' ? 'text-warning' : 'text-text-secondary'
            }`}
            title={windowCountdownHint(clientName)}
          >
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Ventana de 24 h: {formatWindowCountdown(whatsappWindow.msLeft)}</span>
          </div>
        )}
      </div>

      {/* Window closed — the composer is disabled and this says why. Suppressed
          while a send error is on screen: that banner already carries the
          backend's own WINDOW_EXPIRED message. */}
      {isWindowClosed && !sendError && (
        <div
          id="chat-window-expired-banner"
          role="status"
          className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning shadow-sm"
        >
          <svg className="w-4 h-4 shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{windowClosedText}</span>
        </div>
      )}

      {/* Send error banner */}
      {sendError && (
        <div
          id="chat-send-error-banner"
          className="flex items-center justify-between p-3 bg-error/10 border border-error/30 rounded-lg text-xs text-error shadow-md animate-pulse"
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{sendError}</span>
          </span>
          <button
            type="button"
            onClick={() => { setSendError(null); handleSend() }}
            className="shrink-0 ml-3 bg-error/20 hover:bg-error/40 text-error px-3 py-1.5 rounded-control font-bold text-[10px] uppercase border border-error/30 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* File preview bar */}
      {selectedFile && (
        <div
          id="file-preview-bar"
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-bg-tertiary/95 border border-border-default rounded-xl text-xs shadow-lg gap-3 animate-fade-in"
        >
          <div className="flex items-start sm:items-center gap-3 w-full sm:w-auto">
            {/* Contenedor del Preview más grande para Imagen/Video */}
            {(activeCategory === 'image' || activeCategory === 'video') ? (
              <div className="w-24 h-24 sm:w-32 sm:h-20 rounded-lg overflow-hidden border border-white/10 bg-black flex-shrink-0 relative shadow">
                {activeCategory === 'image' ? (
                  <img
                    src={previewUrl ?? ''}
                    alt="preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <video
                    src={previewUrl ?? ''}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                  />
                )}
              </div>
            ) : (
              // Documento
              <div className={`w-12 h-12 rounded-lg border flex items-center justify-center flex-shrink-0 shadow-sm ${FILE_ICON_COLORS[activeCategory]}`}>
                <FileIcon category={activeCategory} />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-white font-bold truncate max-w-[200px] sm:max-w-[300px]" id="file-preview-name">
                {selectedFile.name}
              </p>
              <p className="text-text-secondary text-[10px] mt-0.5" id="file-preview-size">
                {formatFileSize(selectedFile.size)} • {getFileLabel(selectedFile.type)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={removeSelectedFile}
            className="text-text-secondary hover:text-error hover:bg-error/10 p-2 rounded-control transition active:scale-[0.98] flex-shrink-0 self-end sm:self-center border border-transparent hover:border-error/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            title="Quitar archivo"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Typing area */}
      <div
        id="chat-input-typing-area"
        className="relative flex items-start bg-bg-tertiary/85 border border-border-default rounded-xl focus-within:border-brand-blue focus-within:ring-1 focus-within:ring-brand-blue/25 shadow-inner transition duration-200 p-2 gap-2"
      >
        {/* Attach button + dropdown */}
        {recorderState === 'idle' && (
          <div ref={attachMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={toggleAttachMenu}
              disabled={!canCompose || selectedFile !== null}
              className="p-2.5 text-text-secondary hover:text-white hover:bg-border-default rounded-control transition active:scale-[0.98] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
              title="Adjuntar archivo"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            {attachMenuOpen && (
              <div
                id="attach-menu"
                className="absolute bottom-full left-0 mb-2 bg-bg-secondary border border-border-default rounded-xl shadow-sm z-50 w-36 overflow-hidden animate-fade-in"
              >
                <button
                  type="button"
                  onClick={() => triggerFileInput('image')}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-text-primary hover:bg-bg-tertiary transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
                >
                  <svg className="w-4 h-4 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Imagen</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerFileInput('document')}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-text-primary hover:bg-bg-tertiary transition border-t border-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
                >
                  <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span>Documento</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerFileInput('video')}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-text-primary hover:bg-bg-tertiary transition border-t border-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
                >
                  <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Video</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Emoji button + dropdown */}
        {recorderState === 'idle' && (
          <div ref={emojiMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setEmojiMenuOpen((open) => !open)}
              disabled={!canCompose}
              className="p-2.5 text-text-secondary hover:text-white hover:bg-border-default rounded-control transition active:scale-[0.98] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
              title="Insertar emoji"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>

            {emojiMenuOpen && (
              <div
                id="emoji-picker-dropdown"
                className="absolute bottom-full left-0 mb-2 bg-bg-secondary border border-border-default rounded-xl shadow-lg z-50 w-72 p-3 overflow-hidden animate-fade-in flex flex-col space-y-2"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Category tabs */}
                <div className="flex border-b border-border-default/60 pb-1.5 justify-between">
                  <div className="flex gap-1">
                    {EMOJI_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setEmojiCategory(cat.id)}
                        className={`px-2.5 py-1 text-xs rounded-lg transition-colors duration-150 ${
                          emojiCategory === cat.id
                            ? 'bg-brand-blue/20 text-white border border-brand-blue/30'
                            : 'text-text-secondary hover:text-white hover:bg-bg-tertiary'
                        }`}
                        title={cat.title}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[9px] text-text-secondary uppercase self-center font-bold tracking-wider">
                    {EMOJI_CATEGORIES.find((c) => c.id === emojiCategory)?.title}
                  </span>
                </div>

                {/* Emojis grid */}
                <div className="grid grid-cols-7 gap-1 max-h-40 overflow-y-auto pr-1 py-1 app-scroll">
                  {EMOJI_CATEGORIES.find((cat) => cat.id === emojiCategory)?.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-bg-tertiary transition active:scale-95 cursor-pointer"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Audio recording mechanism */}
        <AudioRecorder
          conversationId={conversationId}
          currentAdvisorName={currentAdvisorName}
          onOptimisticMessage={onOptimisticMessage}
          onMessageConfirmed={onMessageConfirmed}
          onMessageFailed={onMessageFailed}
          disabled={!canCompose}
          clientName={clientName}
          onWindowExpired={onWindowExpired}
          onStateChange={setRecorderState}
        />

        {recorderState === 'idle' && (
          <>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={text}
              disabled={!canCompose}
              onChange={(e) => {
                const val = e.target.value
                if (val.length > 2000) {
                  setText(val.slice(0, 2000))
                  showError('El mensaje supera el límite de 2000 caracteres.')
                } else {
                  setText(val)
                }

                if (!val.trim()) {
                  updateTypingStatus(false)
                } else {
                  updateTypingStatus(true)
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current)
                  }
                  typingTimeoutRef.current = setTimeout(() => {
                    updateTypingStatus(false)
                  }, 1500)
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isWindowClosed
                  ? 'Ventana de 24 h cerrada — no se pueden enviar mensajes.'
                  : selectedFile
                    ? 'Añade una descripción opcional...'
                    : 'Escribe tu respuesta... (Enter para enviar, Shift+Enter para nueva línea)'
              }
              className="flex-1 bg-transparent outline-none border-none text-xs text-white placeholder-text-secondary/70 resize-none h-11 px-1 py-1 max-h-32 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            />

            {/* Counter + send */}
            <div className="flex items-center space-x-2 pl-2 border-l border-border-default shrink-0">
              <span className="text-[10px] text-text-secondary font-mono">{text.length}/2000</span>
              <button
                type="button"
                onClick={handleSend}
                disabled={!canCompose || (!text.trim() && !selectedFile)}
                className="bg-brand-blue hover:bg-brand-blue-hover active:scale-[0.98] text-white p-2.5 rounded-control transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
              >
                <svg className="w-3.5 h-3.5 transform rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />

      {/* Media Preview Modal Overlay */}
      {previewModalOpen && selectedFile && previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 animate-fade-in" onClick={removeSelectedFile}>
          <div 
            className={`bg-bg-secondary border border-border-default rounded-panel w-full overflow-hidden shadow-md flex flex-col max-h-[90vh] animate-scale-in transition-all duration-300 ${
              activeCategory === 'document' ? 'max-w-4xl' : 'max-w-xl'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border-default flex items-center justify-between bg-bg-tertiary/60">
              <h3 className="text-h3 text-text-primary uppercase">
                Confirmar envío de {activeCategory === 'image' ? 'imagen' : activeCategory === 'video' ? 'video' : getDocIconInfo(selectedFile.type).label}
              </h3>
              <button
                type="button"
                onClick={removeSelectedFile}
                className="text-text-secondary hover:text-white transition p-1.5 rounded-control hover:bg-error/10 active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Media Display */}
            <div className={`flex-1 bg-black/45 flex items-center justify-center p-6 overflow-hidden relative transition-all duration-300 ${
              activeCategory === 'document' 
                ? 'min-h-[450px] h-[60vh] max-h-[65vh]' 
                : 'min-h-[250px] max-h-[50vh]'
            }`}>
              {activeCategory === 'image' ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-w-full max-h-[45vh] rounded-lg object-contain shadow-md animate-fade-in"
                />
              ) : activeCategory === 'video' ? (
                <video
                  src={previewUrl}
                  controls
                  preload="auto"
                  playsInline
                  className="max-w-full max-h-[45vh] rounded-lg object-contain shadow-md bg-black animate-fade-in"
                />
              ) : selectedFile.type === 'application/pdf' ? (
                /* PDF Preview using iframe */
                <iframe
                  src={previewUrl}
                  title="PDF Preview"
                  className="w-full h-full min-h-[420px] max-h-[58vh] rounded-lg border border-border-default/20 bg-white shadow-md animate-fade-in"
                />
              ) : selectedFile.type.includes('word') || selectedFile.type.includes('msword') ? (
                /* Word Preview using DocxPreview component */
                <DocxPreview file={selectedFile} />
              ) : selectedFile.type.includes('spreadsheetml') || selectedFile.type.includes('excel') ? (
                /* Excel Preview using ExcelPreview component */
                <ExcelPreview file={selectedFile} />
              ) : (
                /* Document Preview Card (Excel or others) */
                <div className="flex flex-col items-center justify-center p-8 bg-bg-secondary/90 border border-border-default rounded-panel text-center gap-4 max-w-sm w-full shadow-md animate-scale-in">
                  <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center text-4xl shadow-inner relative"
                    style={{
                      backgroundColor: `${getDocIconInfo(selectedFile.type).color}20`
                    }}
                  >
                    <div 
                      className="absolute inset-0 rounded-xl filter blur-md opacity-30 animate-pulse"
                      style={{
                        backgroundColor: getDocIconInfo(selectedFile.type).color
                      }}
                    />
                    <span className="relative z-10">{getDocIconInfo(selectedFile.type).icon}</span>
                  </div>
                  <div className="space-y-1.5 w-full">
                    <p className="text-sm font-semibold text-text-primary break-all px-2 line-clamp-2">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {getDocIconInfo(selectedFile.type).label.charAt(0).toUpperCase() + getDocIconInfo(selectedFile.type).label.slice(1)} • {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Info & Caption Input */}
            <div className="p-4 border-t border-border-default bg-bg-tertiary/40 space-y-3">
              <div className="flex items-center justify-between text-[10px] text-text-secondary">
                <span className="truncate max-w-[320px] font-semibold text-white/90">{selectedFile.name}</span>
                <span>{formatFileSize(selectedFile.size)}</span>
              </div>

              <div className="flex items-center gap-2 bg-bg-secondary border border-border-default rounded-xl px-3 py-2 focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/90 transition duration-200 shadow-inner">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Añade un comentario o descripción (opcional)..."
                  className="flex-1 bg-transparent text-xs text-white outline-none placeholder-text-secondary/70"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={removeSelectedFile}
                  className="px-4 py-2 text-xs font-semibold text-text-secondary hover:text-white transition rounded-control hover:bg-white/5 active:scale-[0.98] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isWindowClosed}
                  className="bg-brand-blue hover:bg-brand-blue-hover active:scale-[0.98] text-white text-xs font-bold px-5 py-2.5 rounded-control transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
                >
                  <span>Enviar</span>
                  <svg className="w-3.5 h-3.5 transform rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
