import type { NotificationStatusFilter } from '../../types'
import {
  NOTIFICATION_FILTERS,
  NOTIFICATION_FILTER_LABELS,
  formatBadgeCount,
} from '../../lib/notificationFormat'

interface NotificationTabsProps {
  value: NotificationStatusFilter
  pendingCount: number
  onChange: (filter: NotificationStatusFilter) => void
}

export default function NotificationTabs({ value, pendingCount, onChange }: NotificationTabsProps) {
  return (
    <div role="tablist" aria-label="Filtrar notificaciones por estado" className="flex gap-1 overflow-x-auto">
      {NOTIFICATION_FILTERS.map((filter) => {
        const active = filter === value
        return (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(filter)}
            className={[
              'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-control text-[11px] font-bold border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90',
              active
                ? 'bg-brand-blue/10 border-brand-blue text-brand-blue'
                : 'border-border-default text-text-secondary hover:text-text-primary hover:border-text-secondary',
            ].join(' ')}
          >
            {NOTIFICATION_FILTER_LABELS[filter]}
            {filter === 'pendiente' && pendingCount > 0 && (
              <span className="bg-error text-white text-[9px] px-1.5 rounded-full min-w-[16px] text-center">
                {formatBadgeCount(pendingCount)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
