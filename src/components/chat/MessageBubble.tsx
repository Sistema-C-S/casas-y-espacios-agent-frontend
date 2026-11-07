import { memo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import type { Message } from '../../types'
import { downloadMedia, downloadRotatedImage } from '../../lib/mediaDownload'
import { clientDisplayName } from '../../lib/clientName'

type Rotation = 0 | 90 | 180 | 270

function nextRotation(current: Rotation, direction: 1 | -1): Rotation {
  const steps: Rotation[] = [0, 90, 180, 270]
  const index = steps.indexOf(current)
  return steps[(index + direction + steps.length) % steps.length]
}

interface MessageBubbleProps {
  message: Message
  advisorName?: string
  /**
   * Who the inbound messages are from. Null/unknown (and the generic
   * placeholders the pages substitute for a missing name) fall back to
   * "Cliente" — see lib/clientName.ts.
   */
  clientName?: string | null
  /** Retries a failed outbound message by its `_localId`; the button is hidden without it. */
  onRetry?: (localId: string) => void
}

function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), 'HH:mm')
  } catch {
    return ''
  }
}

function getFileTypeLabel(mimeType: string | null): string {
  if (!mimeType) return 'Archivo'
  const MIME_LABELS: Record<string, string> = {
    // Images
    'image/jpeg':                'Imagen JPEG',
    'image/png':                 'Imagen PNG',
    'image/webp':                'Imagen WebP',
    // Videos
    'video/mp4':                 'Video MP4',
    'video/3gpp':                'Video 3GP',
    // Documents
    'application/pdf':           'Documento PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                                 'Documento Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                                 'Hoja de cálculo Excel',
    'application/msword':        'Documento Word',
    'application/vnd.ms-excel':  'Hoja de cálculo Excel',
    // Audio
    'audio/ogg':                 'Nota de voz',
    'audio/mpeg':                'Audio MP3',
    'audio/mp4':                 'Audio',
    'audio/aac':                 'Audio AAC',
    'audio/amr':                 'Nota de voz',
  }
  return MIME_LABELS[mimeType] ?? 'Archivo'
}

function getFileIcon(mimeType: string | null): { icon: string; color: string } {
  if (!mimeType) {
    return { icon: '📄', color: 'var(--color-text-secondary)' }
  }
  if (mimeType === 'application/pdf') {
    return { icon: '📕', color: 'var(--color-error)' }
  }
  if (mimeType.includes('wordprocessingml') ||
      mimeType.includes('msword')) {
    return { icon: '📘', color: 'var(--color-brand-blue)' }
  }
  if (mimeType.includes('spreadsheetml') ||
      mimeType.includes('ms-excel')) {
    return { icon: '📗', color: 'var(--color-success)' }
  }
  if (mimeType.startsWith('video/')) {
    return { icon: '🎥', color: 'var(--color-warning)' }
  }
  if (mimeType.startsWith('audio/')) {
    return { icon: '🎤', color: 'var(--color-brand-blue)' }
  }
  return { icon: '📄', color: 'var(--color-text-secondary)' }
}

// ── Optimistic UI status indicator ────────────────────────

// WhatsApp-shaped checkmark path — offsetX lets a second tick sit slightly
// right of the first, the same way WhatsApp draws its double check.
function CheckPath({ offsetX = 0 }: { offsetX?: number }) {
  return (
    <path
      d="M11.071 1.501a.75.75 0 011.06.057l.006.007a.75.75 0 01-.057 1.06L5.503 9.87a.75.75 0 01-1.02.005L1.42 7.048a.75.75 0 01.98-1.134l2.545 2.199 6.126-6.612z"
      fill="currentColor"
      transform={offsetX ? `translate(${offsetX}, 0)` : undefined}
    />
  )
}

const MessageStatus = memo(function MessageStatus({ status }: { status?: 'sending' | 'failed' }) {
  if (status === 'sending') {
    return (
      <span
        className="inline-block w-2.5 h-2.5 border-[1.5px] border-text-secondary border-t-transparent rounded-full animate-spin"
        title="Enviando..."
      />
    )
  }
  if (status === 'failed') {
    return (
      <svg className="w-3 h-3 shrink-0 text-error" viewBox="0 0 16 16" fill="none" role="img" aria-label="No se pudo enviar">
        <title>No se pudo enviar</title>
        <path
          d="M4 4l8 8m0-8l-8 8"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    )
  }
  // Confirmed by the server (status is neither 'sending' nor 'failed') — a
  // double checkmark, like WhatsApp's own "sent" tick pair.
  return (
    <svg
      className="w-3.5 h-3 text-text-secondary shrink-0"
      viewBox="0 0 17 15"
      fill="none"
      role="img"
      aria-label="Enviado"
    >
      <title>Enviado</title>
      <CheckPath />
      <CheckPath offsetX={4} />
    </svg>
  )
})

function getFileName(url: string | null, mimeType: string | null = null): string {
  if (!url) return 'Archivo'
  try {
    const parts = url.split('/')
    const last = parts[parts.length - 1]
    const name = last.split('?')[0]
    const decodedName = decodeURIComponent(name) || 'Archivo'

    // Split base name and extension (looking for a dot followed by 1-5 alphanumeric chars at the end)
    const matchExt = decodedName.match(/\.[a-zA-Z0-9]{1,5}$/)
    const extIndex = matchExt ? matchExt.index : -1
    const baseName = extIndex !== -1 ? decodedName.slice(0, extIndex) : decodedName
    let ext = extIndex !== -1 ? decodedName.slice(extIndex).toLowerCase() : ''

    // If no extension in URL but we have mimeType, try to infer the extension
    if (!ext && mimeType) {
      const mimeExtensions: Record<string, string> = {
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-excel': '.xls',
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/3gpp': '.3gp',
        'audio/ogg': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'audio/aac': '.aac',
        'audio/amr': '.amr',
      }
      ext = mimeExtensions[mimeType] ?? ''
    }

    let cleanBase = baseName

    // Remove timestamp prefix (e.g.: 1719543592_ or 1719543592-)
    cleanBase = cleanBase.replace(/^\d{10,15}[_-]/, '')

    // Remove UUID prefix (e.g.: f48ea92a-3b32-4d7a-b280-9a2c1b82fbcd_ or f48ea92a-3b32-4d7a-b280-9a2c1b82fbcd-)
    cleanBase = cleanBase.replace(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[_-]/, '')

    // Remove WhatsApp wam_id prefix (e.g.: wamid.HBgMNTczMTM1ODIwOTc1...EIA___). Inbound
    // Storage paths are "{wam_id}_{real filename or media type}" — without stripping
    // this, the real filename after it (or the bare "document"/"image"/... when Meta
    // sent none) never surfaces, because the whole string still contains "wamid" and
    // trips the isWamid generic-fallback check below.
    cleanBase = cleanBase.replace(/^wamid\.[a-zA-Z0-9+/=]+[_-]+/i, '')

    // Remove timestamp suffix (e.g.: _1719543592 or -1719543592)
    cleanBase = cleanBase.replace(/[_-]\d{10,15}$/, '')

    // Identify if it is a wamid, UUID, hexadecimal hash, or long alphanumeric string
    const cleanLower = cleanBase.toLowerCase()
    const isWamid = cleanLower.includes('wamid')
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanBase)
    const isHash = /^[0-9a-f]{24,}$/i.test(cleanBase) || /^[a-zA-Z0-9]{30,}$/.test(cleanBase) || /[a-zA-Z0-9]{20,}/.test(cleanBase)
    const isDigits = /^\d+$/.test(cleanBase)
    // Matches both the legacy "{wam_id}_document" shape (leftover "_document" when
    // no real filename made it to Storage) and the wamid-stripped bare "document"
    // (nothing left after the prefix strip above).
    const isGenericDocument = /(?:^|_)(document|image|video|audio)$/.test(cleanLower)

    if (!cleanBase || isWamid || isUuid || isHash || isDigits || isGenericDocument) {
      const standardNames: Record<string, string> = {
        '.pdf': 'Documento',
        '.docx': 'Documento Word',
        '.doc': 'Documento Word',
        '.xlsx': 'Hoja de Cálculo',
        '.xls': 'Hoja de Cálculo',
        '.csv': 'Archivo CSV',
        '.pptx': 'Presentación',
        '.ppt': 'Presentación',
        '.png': 'Imagen',
        '.jpg': 'Imagen',
        '.jpeg': 'Imagen',
        '.webp': 'Imagen',
        '.mp4': 'Video',
        '.3gp': 'Video',
        '.ogg': 'Audio',
        '.mp3': 'Audio',
        '.wav': 'Audio',
        '.m4a': 'Audio',
      }
      // Deducir el nombre si no coincide con las extensiones directas
      let defaultName = standardNames[ext]
      if (!defaultName) {
        if (/(?:^|_)document$/.test(cleanLower) || (mimeType && mimeType.toLowerCase().includes('pdf'))) {
          defaultName = 'Documento'
        } else if (/(?:^|_)image$/.test(cleanLower) || (mimeType && mimeType.toLowerCase().startsWith('image/'))) {
          defaultName = 'Imagen'
        } else if (/(?:^|_)video$/.test(cleanLower) || (mimeType && mimeType.toLowerCase().startsWith('video/'))) {
          defaultName = 'Video'
        } else if (/(?:^|_)audio$/.test(cleanLower) || (mimeType && mimeType.toLowerCase().startsWith('audio/'))) {
          defaultName = 'Audio'
        } else {
          defaultName = 'Archivo'
        }
      }
      cleanBase = defaultName
    }

    return cleanBase + ext
  } catch {
    return 'Archivo'
  }
}

// Some upstream messages arrive with their text content percent-encoded
// (e.g. "%20", "%C3%A1"). Decode defensively so advisors see natural text;
// malformed sequences or already-plain text fall back to the original string.
function decodeMessageContent(content: string | null): string | null {
  if (!content || !/%[0-9A-Fa-f]{2}/.test(content)) return content
  try {
    return decodeURIComponent(content)
  } catch {
    return content
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Media placeholders ────────────────────────────────────

function DownloadIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

// Floating icon-only download button, meant to sit over a thumbnail (image/video).
function FloatingDownloadButton({ onClick, title = 'Descargar' }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="absolute top-2 left-2 p-1.5 bg-black/60 hover:bg-black/85 rounded-control text-white/95 opacity-0 group-hover/video:opacity-100 transition duration-200 shadow-lg border border-white/10 z-10 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
    >
      <DownloadIcon />
    </button>
  )
}

function LightboxToolButton({
  onClick,
  title,
  children,
}: {
  onClick: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
    >
      {children}
    </button>
  )
}

// Fullscreen image viewer: pan/zoom (react-zoom-pan-pinch) for inspecting
// detail, plus 90°-step rotation baked into the file on download (the CSS
// rotation here is preview-only — downloadRotatedImage re-renders the pixels
// on a canvas so the saved file actually comes out rotated).
function ImageLightbox({
  src,
  alt,
  caption,
  filename,
  onClose,
}: {
  src: string
  alt: string
  caption: string | null
  filename: string
  onClose: () => void
}) {
  const [rotation, setRotation] = useState<Rotation>(0)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2 z-50">
        <LightboxToolButton
          title="Descargar"
          onClick={(e) => {
            e.stopPropagation()
            downloadRotatedImage(src, filename, rotation)
          }}
        >
          <DownloadIcon className="w-5 h-5" />
        </LightboxToolButton>
        <LightboxToolButton title="Cerrar" onClick={onClose}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </LightboxToolButton>
      </div>

      <div
        className="relative max-w-4xl max-h-[85vh] w-full h-full flex items-center justify-center cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <TransformWrapper initialScale={1} minScale={1} maxScale={4} centerOnInit doubleClick={{ mode: 'toggle' }}>
          {({ zoomIn, zoomOut }) => (
            <>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50 mb-1">
                <LightboxToolButton title="Alejar" onClick={() => zoomOut()}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
                  </svg>
                </LightboxToolButton>
                <LightboxToolButton
                  title="Girar 90°"
                  onClick={() => setRotation((r) => nextRotation(r, 1))}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </LightboxToolButton>
                <LightboxToolButton title="Acercar" onClick={() => zoomIn()}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                  </svg>
                </LightboxToolButton>
              </div>
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={src}
                  alt={alt}
                  className="max-w-full max-h-[75vh] object-contain shadow-2xl"
                  style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 200ms ease' }}
                />
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>

      {caption && (
        <p className="mt-4 text-sm text-text-primary bg-black/60 px-4 py-2 rounded-xl border border-white/5 max-w-xl text-center shadow-lg">
          {caption}
        </p>
      )}
    </div>
  )
}

const ImageBubble = memo(function ImageBubble({ msg }: { msg: Message }) {
  const [isExpanded, setIsExpanded] = useState(false)
  // Keyed by URL, not a bare boolean: the message.new event for an inbound image
  // carries the raw Meta media ID as media_url (the backend only has the signed
  // Storage URL once it finishes downloading, and patches it in via
  // message.media_updated seconds later). A boolean "this failed" survived that
  // patch, so the advisor kept the grey placeholder until they reloaded the page
  // — exactly the turns where the bot is handling the chat and they are only
  // watching. Storing WHICH url failed makes the retry automatic.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const fileName = msg._fileName ?? getFileName(msg.media_url, msg.media_mime_type)
  // Same guard VideoBubble already had: a raw media ID is not something an
  // <img> can load, so don't even try — show the placeholder until the real
  // URL arrives, without an error in the console.
  const hasDisplayableUrl = !!msg.media_url && /^https?:\/\//i.test(msg.media_url)
  const imageFailed = failedUrl !== null && failedUrl === msg.media_url

  const handleDownload = () => {
    downloadMedia(msg.media_url, fileName)
  }

  if (msg.media_url && hasDisplayableUrl && !imageFailed) {
    return (
      <div className="flex flex-col gap-1.5 w-full min-w-0 max-w-[280px]">
        <div className="relative group/video rounded-lg overflow-hidden">
          <img
            src={msg.media_url}
            alt={decodeMessageContent(msg.content) ?? 'Imagen'}
            loading="lazy"
            className="rounded-lg w-full h-auto max-h-[300px] object-cover cursor-pointer hover:opacity-90 hover:scale-[1.01] active:scale-[0.98] transition-all duration-200"
            onClick={() => setIsExpanded(true)}
            onError={() => {
              console.error('[ImageBubble] failed to load', {
                msg_id: msg.id,
                media_url: msg.media_url,
              })
              setFailedUrl(msg.media_url)
            }}
          />
          <FloatingDownloadButton onClick={handleDownload} />
        </div>
        {msg.content && (
          <p className="text-sm text-text-primary px-1 whitespace-pre-wrap wrap-anywhere">
            {decodeMessageContent(msg.content)}
          </p>
        )}

        {isExpanded && (
          <ImageLightbox
            src={msg.media_url}
            alt={decodeMessageContent(msg.content) ?? 'Imagen'}
            caption={decodeMessageContent(msg.content)}
            filename={fileName}
            onClose={() => setIsExpanded(false)}
          />
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 w-full min-w-0 max-w-[280px]">
      <div className="rounded overflow-hidden border border-border-default">
        <div className="w-full h-32 bg-border-default flex items-center justify-center">
          <svg className="w-8 h-8 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      </div>
      {msg.content && (
        <p className="text-sm text-text-primary px-1 whitespace-pre-wrap wrap-anywhere">
          {decodeMessageContent(msg.content)}
        </p>
      )}
    </div>
  )
})

const DocumentBubble = memo(function DocumentBubble({ msg }: { msg: Message }) {
  const isAdvisor = msg.direction === 'outbound_advisor'
  const fileName = msg._fileName ?? getFileName(msg.media_url, msg.media_mime_type)
  return (
    <div className="flex flex-col gap-2.5 min-w-[220px] p-2">
      <div
        className={`flex items-center gap-3 border rounded-xl p-3 transition duration-200 group shadow-inner ${
          isAdvisor
            ? 'bg-black/10 border-white/20 hover:bg-black/20 hover:border-white/30'
            : 'bg-black/15 border-white/5 hover:border-white/10 hover:bg-black/25'
        }`}
      >
        <a
          href={msg.media_url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 flex-1 min-w-0 no-underline"
          title="Abrir en pestaña nueva"
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0 shadow-sm transition group-hover:scale-105"
            style={{
              backgroundColor: `${getFileIcon(msg.media_mime_type).color}20`
            }}
          >
            {getFileIcon(msg.media_mime_type).icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold truncate transition ${
              isAdvisor ? 'text-white group-hover:text-white' : 'text-text-primary group-hover:text-white'
            }`}>
              {fileName}
            </p>
            <p className={`text-[10px] mt-0.5 font-medium ${
              isAdvisor ? 'text-white/70' : 'text-text-secondary'
            }`}>
              {getFileTypeLabel(msg.media_mime_type)}
              {msg.media_size_bytes && ` • ${formatFileSize(msg.media_size_bytes)}`}
            </p>
          </div>
        </a>
        <button
          type="button"
          onClick={() => downloadMedia(msg.media_url, fileName)}
          title="Descargar"
          className={`w-7 h-7 rounded-full border flex items-center justify-center transition duration-200 flex-shrink-0 shadow-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 ${
            isAdvisor
              ? 'bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30'
              : 'bg-white/5 border-white/5 text-text-secondary hover:text-text-primary hover:border-white/10'
          }`}
        >
          <DownloadIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {msg.content && (
        <p className={`mt-2 px-1 text-sm whitespace-pre-wrap wrap-anywhere leading-relaxed ${
          isAdvisor ? 'text-white font-medium animate-fade-in' : 'text-text-primary'
        }`}>
          {decodeMessageContent(msg.content)}
        </p>
      )}
    </div>
  )
})

const AudioBubble = memo(function AudioBubble({ msg }: { msg: Message }) {
  if (msg.media_url) {
    return (
      <div className="p-1.5 min-w-[220px] flex flex-col items-stretch gap-2.5">
        <div className="flex items-center gap-2">
          <audio
            src={msg.media_url}
            controls
            preload="none"
            className="h-8 w-full max-w-[240px] shadow-sm rounded-lg"
            style={{ accentColor: 'var(--color-brand-blue)' }}
          />
          <button
            type="button"
            onClick={() => downloadMedia(msg.media_url, msg._fileName ?? getFileName(msg.media_url, msg.media_mime_type))}
            title="Descargar audio"
            className="p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-white/10 transition duration-200 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
        </div>
        {msg.transcription && (
          <details className="text-[10px] text-text-secondary cursor-pointer select-none">
            <summary className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition outline-none font-bold">
              <svg className="w-3.5 h-3.5 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
              </svg>
              <span>Ver transcripción</span>
            </summary>
            <div className="mt-2 p-2.5 bg-black/15 border-l-2 border-brand-blue rounded-r-lg whitespace-pre-wrap leading-relaxed text-[11px] text-text-primary/85 cursor-text select-text shadow-inner">
              {msg.transcription}
            </div>
          </details>
        )}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-text-secondary">
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
      </svg>
      <span className="text-xs">Mensaje de voz</span>
    </div>
  )
})

const VideoBubble = memo(function VideoBubble({ msg }: { msg: Message }) {
  const [isExpanded, setIsExpanded] = useState(false)
  // Keyed by URL for the same reason as ImageBubble: media_url is patched in by
  // message.media_updated, and a failure against the old value must not outlive it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const isAdvisor = msg.direction === 'outbound_advisor'
  const hasPlayableUrl = !!msg.media_url && /^https?:\/\//i.test(msg.media_url)
  const playbackFailed = failedUrl !== null && failedUrl === msg.media_url

  if (msg.media_url && !hasPlayableUrl) {
    console.error('[VideoBubble] media_url is not a valid URL — backend likely returned a raw Meta media ID instead of a signed Storage URL', {
      msg_id: msg.id,
      media_url: msg.media_url,
    })
  }

  if (hasPlayableUrl && !playbackFailed) {
    return (
      <div className="flex flex-col gap-1.5 max-w-[240px]">
        <div className="rounded-xl overflow-hidden border border-border-default/60 shadow-md bg-black w-full max-h-[320px] flex items-center justify-center relative group/video">
          <video
            src={msg.media_url ?? undefined}
            controls
            preload="metadata"
            playsInline
            className="w-full min-h-[135px] max-h-[320px] object-contain bg-black"
            onError={(e) => {
              const el = e.currentTarget
              console.error('[VideoBubble] failed to load', {
                msg_id: msg.id,
                media_url: msg.media_url,
                media_mime_type: msg.media_mime_type,
                error_code: el.error?.code,
                error_message: el.error?.message,
                network_state: el.networkState,
              })
              setFailedUrl(msg.media_url)
            }}
          >
            Tu navegador no soporta la reproducción de video.
          </video>

          <FloatingDownloadButton
            onClick={() => downloadMedia(msg.media_url, msg._fileName ?? getFileName(msg.media_url, msg.media_mime_type))}
          />

          {/* Botón flotante para expandir */}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/85 rounded-control text-white/95 opacity-0 group-hover/video:opacity-100 transition duration-200 shadow-lg border border-white/10 z-10 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            title="Ver en grande"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
          </button>
        </div>
        
        {/* Enlace de descarga de respaldo siempre visible */}
        <div className={`flex items-center justify-between px-1 text-[10px] border-b pb-1 ${
          isAdvisor ? 'text-white/70 border-white/20' : 'text-text-secondary border-white/5'
        }`}>
          <span className="text-label uppercase">Video</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className={`font-bold flex items-center transition cursor-pointer ${
                isAdvisor ? 'text-white hover:text-white/80' : 'text-brand-blue hover:text-brand-blue-light'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90`}
            >
              <span>Ver en grande</span>
            </button>
            <span className={isAdvisor ? 'text-white/25' : 'text-white/10'}>•</span>
            <button
              type="button"
              onClick={() => downloadMedia(msg.media_url, msg._fileName ?? getFileName(msg.media_url, msg.media_mime_type))}
              className={`font-bold flex items-center gap-1 transition cursor-pointer ${
                isAdvisor ? 'text-white hover:text-white/80' : 'text-brand-blue hover:text-brand-blue-light'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90`}
            >
              <span>Descargar</span>
              <DownloadIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {msg.content && (
          <p className={`mt-2.5 px-1 text-sm whitespace-pre-wrap wrap-anywhere leading-relaxed ${
            isAdvisor ? 'text-white font-medium animate-fade-in' : 'text-text-primary'
          }`}>
            {decodeMessageContent(msg.content)}
          </p>
        )}

        {isExpanded && (
          <div
            className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-fade-in"
            onClick={() => setIsExpanded(false)}
          >
            {/* Botón Descargar */}
            <button
              type="button"
              className="absolute top-4 right-16 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition duration-200 z-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
              onClick={(e) => {
                e.stopPropagation()
                downloadMedia(msg.media_url, msg._fileName ?? getFileName(msg.media_url, msg.media_mime_type))
              }}
              title="Descargar"
            >
              <DownloadIcon className="w-5 h-5" />
            </button>

            {/* Botón Cerrar */}
            <button
              type="button"
              className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition duration-200 z-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
              onClick={() => setIsExpanded(false)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Contenedor del video expandido */}
            <div className="relative max-w-4xl max-h-[85vh] w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <video
                src={msg.media_url ?? undefined}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-full rounded-lg object-contain shadow-2xl bg-black"
                onError={(e) => {
                  const el = e.currentTarget
                  console.error('[VideoBubble] failed to load (expanded view)', {
                    msg_id: msg.id,
                    media_url: msg.media_url,
                    media_mime_type: msg.media_mime_type,
                    error_code: el.error?.code,
                    error_message: el.error?.message,
                    network_state: el.networkState,
                  })
                  setFailedUrl(msg.media_url)
                  setIsExpanded(false)
                }}
              />
            </div>

            {/* Caption */}
            {msg.content && (
              <p className="mt-4 text-sm text-text-primary bg-black/60 px-4 py-2 rounded-xl border border-white/5 max-w-xl text-center shadow-lg">
                {decodeMessageContent(msg.content)}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 max-w-[240px]">
      <div className="w-48 h-32 bg-border-default rounded-xl flex flex-col items-center justify-center gap-1.5 border border-border-default/60 shadow-md">
        <svg className="w-8 h-8 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636a9 9 0 010 12.728m-3.536-9.192a5 5 0 010 7.072M12 12h.01M4.222 4.222l15.556 15.556" />
        </svg>
        <span className="text-[10px] text-text-secondary font-medium px-2 text-center">Video no disponible</span>
      </div>
      {msg.content && (
        <p className="text-sm text-text-primary px-1 whitespace-pre-wrap wrap-anywhere leading-relaxed">
          {decodeMessageContent(msg.content)}
        </p>
      )}
    </div>
  )
})

// ── Bubble content ────────────────────────────────────────

const BubbleContent = memo(function BubbleContent({ msg, isDocument }: { msg: Message; isDocument: boolean }) {
  if (isDocument) return <DocumentBubble msg={msg} />
  switch (msg.msg_type) {
    case 'image': return <ImageBubble msg={msg} />
    case 'audio': return <AudioBubble msg={msg} />
    case 'video': return <VideoBubble msg={msg} />
    default: return (
      <p className="text-sm leading-relaxed wrap-anywhere">{decodeMessageContent(msg.content)}</p>
    )
  }
})

// ── Main component ────────────────────────────────────────

export default memo(function MessageBubble({ message, advisorName, clientName, onRetry }: MessageBubbleProps) {
  const time = formatTime(message.timestamp)
  const isDocument = message.msg_type === 'document'

  if (message.direction === 'inbound') {
    return (
      <div className="flex flex-col items-start max-w-[75%] space-y-0.5 shrink-0">
        <div className={`bg-bg-tertiary text-text-primary rounded-xl rounded-tl-none ${isDocument ? '' : 'p-3'} leading-relaxed shadow-sm border border-white/5`}>
          <BubbleContent msg={message} isDocument={isDocument} />
        </div>
        <span className="text-[9px] text-text-secondary ml-1">
          {time} • {clientDisplayName(clientName) ?? 'Cliente'}
        </span>
      </div>
    )
  }

  if (message.direction === 'outbound_bot') {
    return (
      <div className="flex flex-col items-end max-w-[75%] ml-auto space-y-0.5 shrink-0">
        <div className={`bg-bg-secondary text-text-primary rounded-xl rounded-tr-none ${isDocument ? '' : 'p-3'} leading-relaxed border border-border-default/60 shadow-sm`}>
          <div className="flex items-center space-x-1 text-success text-label uppercase opacity-80 mb-1 px-3 pt-3">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span>Bot</span>
          </div>
          <div className={isDocument ? '' : 'px-3 pb-3'}>
            <BubbleContent msg={message} isDocument={isDocument} />
          </div>
        </div>
        <span className="text-[9px] text-text-secondary mr-1">{time}</span>
      </div>
    )
  }

  // outbound_advisor
  return (
    <div className="flex flex-col items-end max-w-[75%] ml-auto space-y-0.5 shrink-0">
      <div
        className={`bg-gradient-to-br from-brand-blue-light to-brand-blue text-white rounded-xl rounded-tr-none ${isDocument ? '' : 'p-3'} leading-relaxed shadow-md border ${
          message._status === 'failed' ? 'border-error/60' : 'border-brand-blue/10'
        } ${message._status === 'sending' ? 'opacity-70' : ''}`}
      >
        <BubbleContent msg={message} isDocument={isDocument} />
      </div>
      <span className="text-[9px] text-text-secondary mr-1 inline-flex items-center gap-1">
        <MessageStatus status={message._status} />
        {time}{advisorName ? ` • ${advisorName}` : ''}
      </span>
      {message._status === 'failed' && (
        <span className="text-[9px] text-error font-semibold mr-1 inline-flex items-center gap-1.5">
          No se pudo enviar
          {onRetry && message._localId && (
            <button
              type="button"
              onClick={() => onRetry(message._localId!)}
              className="underline hover:no-underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
            >
              Reintentar
            </button>
          )}
        </span>
      )}
    </div>
  )
})
