import { memo, useMemo, useCallback } from 'react'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import type { Message } from '../../types'
import MessageBubble from './MessageBubble'

// ── Local sub-components ──────────────────────────────────

const DateSeparator = memo(function DateSeparator({ date }: { date: Date }) {
  let label: string
  if (isToday(date)) label = `Hoy, ${format(date, "d 'de' MMMM")}`
  else if (isYesterday(date)) label = `Ayer, ${format(date, "d 'de' MMMM")}`
  else label = format(date, "d 'de' MMMM 'de' yyyy")

  return (
    <div className="text-center my-3 shrink-0 flex items-center justify-center gap-4 select-none">
      <div className="flex-1 h-[1px] bg-white/5" />
      <span className="bg-bg-secondary/95 text-text-secondary text-label uppercase px-3.5 py-1.5 rounded-xl border border-border-default/50 shadow-sm">
        {label}
      </span>
      <div className="flex-1 h-[1px] bg-white/5" />
    </div>
  )
})

const EscalationEvent = memo(function EscalationEvent() {
  return (
    <div className="text-center my-3 shrink-0 select-none">
      <span className="bg-error/8 text-error text-label uppercase px-4 py-2 rounded-xl border border-error/20 shadow-sm inline-flex items-center gap-2">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Conversación escalada al asesor
      </span>
    </div>
  )
})

const ReturnedBotEvent = memo(function ReturnedBotEvent() {
  return (
    <div className="text-center my-3 shrink-0 select-none">
      <span className="bg-success/8 text-success text-label uppercase px-4 py-2 rounded-xl border border-success/20 shadow-sm inline-flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
        Conversación devuelta al bot de forma autónoma
      </span>
    </div>
  )
})

const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div className="flex items-center space-x-2 text-[10px] text-text-secondary italic py-1 shrink-0">
      <span className="flex space-x-1 items-center">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 bg-text-secondary rounded-full animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span>Escribiendo...</span>
    </div>
  )
})

function ChatSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex flex-col items-start max-w-[70%] space-y-1">
        <div className="h-10 bg-bg-tertiary rounded-xl w-60" />
      </div>
      <div className="flex flex-col items-end max-w-[70%] self-end space-y-1">
        <div className="h-8 bg-bg-secondary rounded-xl w-40" />
      </div>
      <div className="flex flex-col items-start max-w-[70%] space-y-1">
        <div className="h-12 bg-bg-tertiary rounded-xl w-48" />
      </div>
    </div>
  )
}

// ── Group messages by day ─────────────────────────────────

interface DayGroup {
  date: Date
  messages: Message[]
}

function groupByDay(messages: Message[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const msg of messages) {
    let date: Date
    try {
      date = parseISO(msg.timestamp)
      if (isNaN(date.getTime())) throw new Error('Invalid date')
    } catch {
      console.warn('[MessageFeed] unparseable timestamp, using now as fallback', msg.id, msg.timestamp)
      date = new Date()
    }
    const dayKey = format(date, 'yyyy-MM-dd')
    const last = groups[groups.length - 1]
    if (last && format(last.date, 'yyyy-MM-dd') === dayKey) {
      last.messages.push(msg)
    } else {
      groups.push({ date, messages: [msg] })
    }
  }
  return groups
}

// ── Props & component ─────────────────────────────────────

interface MessageFeedProps {
  messages: Message[]
  isLoading: boolean
  isLoadingMore: boolean
  showEscalationEvent: boolean
  showReturnedEvent: boolean
  advisorName?: string
  /** Author label for inbound bubbles; falls back to "Cliente" when unknown. */
  clientName?: string | null
  onScrollTop: () => void
  feedRef: React.RefObject<HTMLDivElement | null>
  isTyping?: boolean
  /** wam_id of the message to highlight briefly (deep link from a notification). */
  highlightedWamId?: string | null
  /** Retries a failed outbound message by its `_localId` (see ChatInput). */
  onRetryMessage?: (localId: string) => void
}

export default memo(function MessageFeed({
  messages,
  isLoading,
  isLoadingMore,
  showEscalationEvent,
  showReturnedEvent,
  advisorName,
  clientName,
  onScrollTop,
  feedRef,
  isTyping,
  highlightedWamId = null,
  onRetryMessage,
}: MessageFeedProps) {
  const handleScroll = useCallback(() => {
    if (feedRef.current && feedRef.current.scrollTop === 0) {
      onScrollTop()
    }
  }, [feedRef, onScrollTop])

  const groups = useMemo(() => groupByDay(messages), [messages])

  return (
    <div
      ref={feedRef}
      id="chat-message-feed"
      onScroll={handleScroll}
      className="app-scroll flex-1 p-4 overflow-y-auto space-y-4 flex flex-col min-h-0 bg-bg-main"
      style={{
        backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 0)',
        backgroundSize: '24px 24px'
      }}
    >
      {isLoading ? (
        <ChatSkeleton />
      ) : (
        <>
          {isLoadingMore && (
            <div className="text-center py-2">
              <div className="w-4 h-4 border border-brand-blue border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          )}

          {groups.map((group) => (
            <div key={format(group.date, 'yyyy-MM-dd')}>
              <DateSeparator date={group.date} />
              {group.messages.map((msg, index) => {
                const isSameSender =
                  index > 0 && group.messages[index - 1].direction === msg.direction
                return (
                  <div
                    key={msg.id}
                    data-wam-id={msg.wam_id ?? undefined}
                    className={[
                      isSameSender ? 'mt-1' : 'mt-3',
                      highlightedWamId && msg.wam_id === highlightedWamId ? 'message-focus-highlight' : '',
                    ].join(' ')}
                  >
                    <MessageBubble
                      message={msg}
                      advisorName={
                        msg.direction === 'outbound_advisor'
                          ? (msg.advisor_name ?? advisorName)
                          : undefined
                      }
                      clientName={clientName}
                      onRetry={onRetryMessage}
                    />
                  </div>
                )
              })}
            </div>
          ))}

          {showEscalationEvent && <EscalationEvent />}
          {showReturnedEvent && <ReturnedBotEvent />}

          {isTyping && (
            <TypingIndicator />
          )}
        </>
      )}
    </div>
  )
})
