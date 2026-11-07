import { useCallback, useEffect, useRef, useState } from 'react'

export interface QueuedSend {
  /** Performs the request. Rejecting marks the send as failed. */
  run: () => Promise<void>
  /** Called once when `run` rejects. */
  onFailure: (error: unknown) => void
  /** Called instead of `run` when an earlier send failed and this one never left. */
  onSkipped: () => void
}

interface Lane {
  tail: Promise<void>
  pending: number
  halted: boolean
}

/** Lane used when the caller gives no key: a single queue, as before. */
const DEFAULT_KEY = ''

/**
 * Serial send queue for the chat composer, one lane per key (a conversation id).
 *
 * Within a key, sends run strictly one after another so messages reach WhatsApp
 * in the order the advisor wrote them, while the composer stays free to type the
 * next one. Different keys never wait on each other: a slow upload or a failure
 * in one chat must not hold up another. After a failure, the sends already queued
 * behind it in the same lane are skipped (reported via `onSkipped`) rather than
 * sent: letting them through would deliver them ahead of the failed message, and
 * with an expired 24h window they would all fail anyway. A lane accepts sends
 * normally again once it has drained.
 */
export function useSendQueue() {
  const lanesRef = useRef(new Map<string, Lane>())
  const totalPendingRef = useRef(0)
  const mountedRef = useRef(true)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const enqueue = useCallback((send: QueuedSend, key: string = DEFAULT_KEY) => {
    const lanes = lanesRef.current
    const lane: Lane = lanes.get(key) ?? { tail: Promise.resolve(), pending: 0, halted: false }
    lanes.set(key, lane)

    lane.pending += 1
    totalPendingRef.current += 1
    setPendingCount(totalPendingRef.current)

    lane.tail = lane.tail.then(async () => {
      try {
        if (lane.halted) {
          send.onSkipped()
          return
        }
        try {
          await send.run()
        } catch (error) {
          lane.halted = true
          send.onFailure(error)
        }
      } catch {
        // A throwing callback must never break the chain for the sends behind it.
      } finally {
        lane.pending -= 1
        totalPendingRef.current -= 1
        if (lane.pending === 0) {
          lane.halted = false
          if (lanes.get(key) === lane) lanes.delete(key)
        }
        if (mountedRef.current) setPendingCount(totalPendingRef.current)
      }
    })
  }, [])

  return { enqueue, pendingCount }
}
