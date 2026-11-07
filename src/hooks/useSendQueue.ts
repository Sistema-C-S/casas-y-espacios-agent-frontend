import { useCallback, useEffect, useRef, useState } from 'react'

export interface QueuedSend {
  /** Performs the request. Rejecting marks the send as failed. */
  run: () => Promise<void>
  /** Called once when `run` rejects. */
  onFailure: (error: unknown) => void
  /** Called instead of `run` when an earlier send failed and this one never left. */
  onSkipped: () => void
}

/**
 * Serial send queue for the chat composer.
 *
 * Sends run strictly one after another so messages reach WhatsApp in the order
 * the advisor wrote them, while the composer stays free to type the next one.
 * After a failure, the sends already queued behind it are skipped (reported via
 * `onSkipped`) rather than sent: letting them through would deliver them ahead
 * of the failed message, and with an expired 24h window they would all fail
 * anyway. The queue accepts sends normally again once it has drained.
 */
export function useSendQueue() {
  const tailRef = useRef<Promise<void>>(Promise.resolve())
  const pendingRef = useRef(0)
  const haltedRef = useRef(false)
  const mountedRef = useRef(true)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const enqueue = useCallback((send: QueuedSend) => {
    pendingRef.current += 1
    setPendingCount(pendingRef.current)

    tailRef.current = tailRef.current.then(async () => {
      try {
        if (haltedRef.current) {
          send.onSkipped()
          return
        }
        try {
          await send.run()
        } catch (error) {
          haltedRef.current = true
          send.onFailure(error)
        }
      } catch {
        // A throwing callback must never break the chain for the sends behind it.
      } finally {
        pendingRef.current -= 1
        if (pendingRef.current === 0) haltedRef.current = false
        if (mountedRef.current) setPendingCount(pendingRef.current)
      }
    })
  }, [])

  return { enqueue, pendingCount }
}
