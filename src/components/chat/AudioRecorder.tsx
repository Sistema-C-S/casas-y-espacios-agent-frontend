import { useEffect, useRef, useState } from 'react'
// @ts-ignore
import MicRecorder from 'mic-recorder-to-mp3-fixed'
import { conversationsService } from '../../services/conversations'
import type { Message } from '../../types'
import { windowClosedReason } from '../../lib/whatsappWindow'

interface AudioRecorderProps {
  conversationId: string
  currentAdvisorName?: string
  onOptimisticMessage: (message: Message) => void
  onMessageConfirmed: (localId: string, message: Message) => void
  onMessageFailed: (localId: string) => void
  disabled?: boolean
  /** Display name of the client, used to address them in the window copy. */
  clientName?: string | null
  /** The backend refused the send with 409 WINDOW_EXPIRED (Meta's 24h window). */
  onWindowExpired?: () => void
  onStateChange?: (state: RecorderState) => void
}

function makeLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type RecorderState =
  | 'idle'
  | 'requesting_permission'
  | 'recording'
  | 'preview'
  | 'sending'
  | 'error'

const MAX_DURATION_SECONDS = 300 // 5 minutes

export default function AudioRecorder({
  conversationId,
  currentAdvisorName,
  onOptimisticMessage,
  onMessageConfirmed,
  onMessageFailed,
  disabled = false,
  clientName,
  onWindowExpired,
  onStateChange,
}: AudioRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const recorderRef = useRef<any>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const retryLocalIdRef = useRef<string | null>(null)
  // Idempotency key for the backend (client_message_id): one per recording, reused on
  // every retry, so a retry after a lost response never sends the audio twice.
  const retryClientMessageIdRef = useRef<string | null>(null)

  useEffect(() => {
    // @ts-ignore
    recorderRef.current = new MicRecorder({ bitRate: 128 })
  }, [])

  async function startRecording() {
    retryLocalIdRef.current = null
    retryClientMessageIdRef.current = null
    setState('requesting_permission')
    setErrorMessage(null)

    try {
      await recorderRef.current.start()
      setState('recording')
      startTimer()
    } catch (error: any) {
      if (error?.name === 'NotAllowedError') {
        setErrorMessage('Debes permitir el acceso al micrófono para enviar audios')
      } else {
        setErrorMessage('No se pudo acceder al micrófono')
      }
      setState('error')
    }
  }

  function stopRecording() {
    if (!recorderRef.current) return
    recorderRef.current
      .stop()
      .getMp3()
      .then(([_buffer, blob]: [any, Blob]) => {
        const url = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioUrl(url)
        setState('preview')
        stopTimer()
      })
      .catch((_err: any) => {
        setErrorMessage('Error al detener la grabación')
        setState('error')
        stopTimer()
      })
  }

  function cancelRecording() {
    stopTimer()
    try {
      if (recorderRef.current) {
        recorderRef.current.stop()
      }
    } catch {}
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    // A discarded or delivered clip never lends its idempotency key to the next one:
    // the backend would answer the new audio with the old message.
    retryLocalIdRef.current = null
    retryClientMessageIdRef.current = null
    setAudioBlob(null)
    setAudioUrl(null)
    setElapsedSeconds(0)
    setState('idle')
  }

  async function sendAudio() {
    if (!audioBlob) return
    // The recorder can already hold a clip when sending becomes impossible —
    // Meta's 24h window closing mid-preview, or control moving to someone else.
    // Both the preview and the retry button are disabled for that, this is the
    // guard behind them. The recording is kept so it can still be discarded,
    // or sent if the client writes again and reopens the window.
    if (disabled) return
    setState('sending')

    const localId = retryLocalIdRef.current ?? makeLocalId()
    retryLocalIdRef.current = null
    const clientMessageId = retryClientMessageIdRef.current ?? crypto.randomUUID()
    retryClientMessageIdRef.current = null

    // Show the recorded clip as a bubble immediately — uploading + delivering
    // via Meta can take a few seconds and shouldn't block the perceived send.
    onOptimisticMessage({
      id: localId,
      conversation_id: conversationId,
      wam_id: null,
      direction: 'outbound_advisor',
      msg_type: 'audio',
      content: null,
      media_url: audioUrl,
      media_mime_type: 'audio/mpeg',
      media_size_bytes: audioBlob.size,
      transcription: null,
      delivered_via: 'panel',
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
      advisor_name: currentAdvisorName ?? null,
      _localId: localId,
      _status: 'sending',
    })

    try {
      const { message } = await conversationsService.replyAudio(
        conversationId,
        audioBlob,
        clientMessageId,
      )
      onMessageConfirmed(localId, message)
      cancelRecording() // Clear state after success

      // Auto scroll to bottom
      setTimeout(() => {
        const feed = document.getElementById('chat-message-feed')
        if (feed) feed.scrollTop = feed.scrollHeight
      }, 50)
    } catch (error) {
      onMessageFailed(localId)
      retryLocalIdRef.current = localId
      retryClientMessageIdRef.current = clientMessageId
      const err = error as { response?: { data?: { detail?: { code?: string } } } }
      const code = err.response?.data?.detail?.code
      if (code === 'FILE_TOO_LARGE') {
        setErrorMessage('El audio supera el límite de 16MB')
      } else if (code === 'FILE_TYPE_NOT_ALLOWED') {
        setErrorMessage('Tipo de audio no permitido')
      } else if (code === 'META_API_ERROR') {
        setErrorMessage('No se pudo enviar el audio a WhatsApp. Intenta nuevamente.')
      } else if (code === 'STORAGE_ERROR') {
        setErrorMessage('Error al subir el audio a almacenamiento. Intenta de nuevo.')
      } else if (code === 'BOT_IS_ACTIVE') {
        setErrorMessage('El bot tiene el control de esta conversación.')
      } else if (code === 'NOT_ASSIGNED') {
        setErrorMessage('No estás asignado a esta conversación.')
      } else if (code === 'WINDOW_EXPIRED') {
        // Backend message is already written for the advisor — show it verbatim.
        // The recording itself is kept (cancelRecording is not called), same as
        // the text composer keeps the typed message.
        const backendMsg = (error as { response?: { data?: { detail?: { message?: string } } } })
          .response?.data?.detail?.message
        setErrorMessage(backendMsg || windowClosedReason(clientName))
        onWindowExpired?.()
      } else {
        setErrorMessage('No se pudo enviar el audio. Intenta de nuevo.')
      }
      setState('error')
    }
  }

  function startTimer() {
    setElapsedSeconds(0)
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1
        if (next >= MAX_DURATION_SECONDS) {
          stopRecording()
          return prev
        }
        return next
      })
    }, 1000)
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  // Stream release is managed by mic-recorder-to-mp3 internally

  function formatTime(seconds: number): string {
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer()
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  // Notify state changes to parent
  useEffect(() => {
    onStateChange?.(state)
  }, [state, onStateChange])

  // RENDER PER STATE
  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={startRecording}
        disabled={disabled}
        className="p-2 text-text-secondary hover:text-white hover:bg-border-default rounded-control transition disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
        title="Grabar audio"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z"
          />
        </svg>
      </button>
    )
  }

  if (state === 'requesting_permission') {
    return (
      <div className="p-2">
        <div className="w-4 h-4 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (state === 'recording') {
    return (
      <div className="flex items-center gap-2 px-2">
        <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
        <span className="text-error text-xs font-mono font-bold">
          {formatTime(elapsedSeconds)}
        </span>
        {elapsedSeconds >= MAX_DURATION_SECONDS - 30 && (
          <span className="text-warning text-[10px]">
            Límite próximo
          </span>
        )}
        <button
          type="button"
          onClick={stopRecording}
          className="p-1.5 bg-error/10 hover:bg-error/20 border border-error/30 rounded-control text-error transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          title="Detener grabación"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
      </div>
    )
  }

  if (state === 'preview') {
    return (
      <div className="flex items-center gap-2 px-2 w-full">
        <audio
          src={audioUrl!}
          controls
          className="h-8 flex-1 min-w-0"
          style={{ accentColor: 'var(--color-brand-blue)' }}
        />
        <button
          type="button"
          onClick={sendAudio}
          disabled={disabled}
          className="p-2 bg-brand-blue hover:bg-brand-blue-hover text-white rounded-control transition shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary/90"
          title={disabled ? 'No se puede enviar en este momento' : 'Enviar audio'}
        >
          <svg className="w-3.5 h-3.5 transform rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={cancelRecording}
          className="p-2 text-text-secondary hover:text-error hover:bg-error/10 rounded-control transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          title="Cancelar"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  if (state === 'sending') {
    return (
      <div className="flex items-center gap-2 px-2">
        <div className="w-3.5 h-3.5 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
        <span className="text-text-secondary text-xs">Enviando audio...</span>
      </div>
    )
  }

  // error state
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="text-error text-xs">{errorMessage}</span>
      <button
        type="button"
        onClick={sendAudio}
        disabled={disabled}
        className="text-[10px] text-brand-blue hover:text-brand-blue-hover font-bold uppercase transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
      >
        Reintentar
      </button>
      <button
        type="button"
        onClick={cancelRecording}
        className="text-[10px] text-text-secondary hover:text-error transition ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
      >
        Cancelar
      </button>
    </div>
  )
}
