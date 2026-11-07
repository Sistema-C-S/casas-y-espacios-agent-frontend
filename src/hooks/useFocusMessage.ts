// Scrolls the chat to a specific message (by wam_id) and highlights it once —
// used when an advisor opens a conversation from a notification attachment to
// check the receipt the client actually sent.
//
// The chat loads the latest window first; an older receipt may not be in it,
// so this pages backwards up to MAX_FOCUS_PAGES before giving up with a notice.
import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import { useToastStore } from '../store/toastStore'

export const MAX_FOCUS_PAGES = 3
export const FOCUS_HIGHLIGHT_MS = 2500
/** How long to wait before asking again when another load owned the page. */
export const BUSY_RETRY_MS = 300
/** Consecutive "busy" answers tolerated before the search ends with the notice. */
export const MAX_BUSY_RETRIES = 5

interface UseFocusMessageParams {
  focusWamId: string | null | undefined
  /** The open conversation; a change starts a fresh search with a fresh page budget. */
  conversationId?: string | null
  messages: Message[]
  /** True once the initial load finished and the feed is rendered. */
  isReady: boolean
  feedRef: React.RefObject<HTMLDivElement | null>
  /**
   * Loads the previous page; resolves to how many messages it added (0 = no
   * older history or the request failed), or null when a load was already in
   * flight — then the search simply waits for that load's messages.
   */
  loadOlder: () => Promise<number | null>
  canLoadOlder: () => boolean
}

export function useFocusMessage({
  focusWamId,
  conversationId,
  messages,
  isReady,
  feedRef,
  loadOlder,
  canLoadOlder,
}: UseFocusMessageParams): string | null {
  const [highlightedWamId, setHighlightedWamId] = useState<string | null>(null)
  const handledRef = useRef<string | null>(null)
  const pagesLoadedRef = useRef(0)
  const inFlightRef = useRef(false)
  const busyRetriesRef = useRef(0)
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped on every reset so a page request from the previous search settles
  // into the void instead of touching the new one.
  const epochRef = useRef(0)
  // Bumped when a page request settles, so the search re-runs even if React
  // committed the new messages while the request was still flagged in flight.
  const [settledPages, setSettledPages] = useState(0)

  // Latest callbacks without re-running the search effect on every render.
  const loadOlderRef = useRef(loadOlder)
  const canLoadOlderRef = useRef(canLoadOlder)
  useEffect(() => {
    loadOlderRef.current = loadOlder
    canLoadOlderRef.current = canLoadOlder
  })

  // ChatPage is not remounted when the advisor opens another chat or the same
  // notification again, so the bookkeeping of the previous search is cleared here.
  // Declared before the search effect: it must run first in the same commit.
  useEffect(() => {
    epochRef.current += 1
    handledRef.current = null
    pagesLoadedRef.current = 0
    busyRetriesRef.current = 0
    inFlightRef.current = false
    if (busyTimerRef.current) {
      clearTimeout(busyTimerRef.current)
      busyTimerRef.current = null
    }
    return () => {
      if (busyTimerRef.current) {
        clearTimeout(busyTimerRef.current)
        busyTimerRef.current = null
      }
    }
  }, [focusWamId, conversationId, isReady])

  useEffect(() => {
    if (!focusWamId || !isReady || inFlightRef.current || handledRef.current === focusWamId) return

    const giveUp = () => {
      handledRef.current = focusWamId
      useToastStore.getState().showToast('No se encontró el mensaje en el historial cargado.', 'info')
    }

    if (messages.some((message) => message.wam_id === focusWamId)) {
      // After the chat's own scroll-to-bottom / scroll-restore, which run on
      // the next frame or tick. Marked handled only once the jump really
      // happened: if a dependency changes first, the cleanup cancels this and
      // the next run schedules it again.
      let frame = 0
      const timer = setTimeout(() => {
        frame = requestAnimationFrame(() => {
          const target = feedRef.current?.querySelector<HTMLElement>(`[data-wam-id="${CSS.escape(focusWamId)}"]`)
          if (!target) return
          handledRef.current = focusWamId
          // Programmatic one-off jump: smooth is fine here (CLAUDE.md §16.1).
          target.scrollIntoView({ block: 'center', behavior: 'smooth' })
          setHighlightedWamId(focusWamId)
        })
      }, 0)
      return () => {
        clearTimeout(timer)
        cancelAnimationFrame(frame)
      }
    }

    if (pagesLoadedRef.current >= MAX_FOCUS_PAGES || !canLoadOlderRef.current()) {
      giveUp()
      return
    }

    const epoch = epochRef.current
    pagesLoadedRef.current += 1
    inFlightRef.current = true
    loadOlderRef.current()
      .then((added) => {
        if (epoch !== epochRef.current) return
        inFlightRef.current = false
        if (added === null) {
          // Another load (the advisor scrolling up) owns this page: not a
          // failed attempt. Its messages re-run this effect, but if it adds
          // nothing nothing would — so ask again shortly, a bounded number of
          // times, and then end the search instead of waiting forever.
          pagesLoadedRef.current -= 1
          busyRetriesRef.current += 1
          if (busyRetriesRef.current > MAX_BUSY_RETRIES) {
            giveUp()
            return
          }
          busyTimerRef.current = setTimeout(() => {
            busyTimerRef.current = null
            if (epoch === epochRef.current) setSettledPages((count) => count + 1)
          }, BUSY_RETRY_MS)
          return
        }
        busyRetriesRef.current = 0
        // Nothing new means no re-render will retrigger this effect.
        if (added <= 0) giveUp()
        setSettledPages((count) => count + 1)
      })
      .catch(() => {
        if (epoch !== epochRef.current) return
        inFlightRef.current = false
        giveUp()
      })
  }, [focusWamId, conversationId, isReady, messages, feedRef, settledPages])

  useEffect(() => {
    if (!highlightedWamId) return
    const timer = setTimeout(() => setHighlightedWamId(null), FOCUS_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightedWamId])

  return highlightedWamId
}
