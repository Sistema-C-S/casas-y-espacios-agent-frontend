import { useToastStore, type Toast, type ToastType } from '../../store/toastStore'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'

const AUTO_DISMISS_MS = 4000

const STYLES: Record<ToastType, { border: string; bg: string; color: string }> = {
  success: { border: 'border-l-success',    bg: 'bg-success/10',    color: 'text-success' },
  error:   { border: 'border-l-error',      bg: 'bg-error/10',      color: 'text-error' },
  warning: { border: 'border-l-warning',    bg: 'bg-warning/10',    color: 'text-warning' },
  info:    { border: 'border-l-brand-blue', bg: 'bg-brand-blue/10', color: 'text-brand-blue' },
}

const TITLES: Record<ToastType, string> = {
  success: 'Operación Exitosa',
  error:   'Error',
  warning: 'Atención',
  info:    'Información',
}

function ToastIcon({ type }: { type: ToastType }) {
  if (type === 'success') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  if (type === 'error') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  if (type === 'warning') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  }
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const style = STYLES[toast.type]

  useAutoDismiss(toast.id, removeToast, toast.durationMs ?? AUTO_DISMISS_MS)

  return (
    <div
      className={`bg-bg-secondary border-l-4 ${style.border} border border-border-default rounded-r-lg shadow-2xl p-3.5 w-80 flex items-start gap-3 pointer-events-auto animate-in slide-in-from-right duration-300`}
    >
      <div className={`${style.bg} p-2 rounded-lg ${style.color} shrink-0`}>
        <ToastIcon type={toast.type} />
      </div>
      <div className="flex-1 text-xs min-w-0">
        <h5 className="font-bold text-white">{TITLES[toast.type]}</h5>
        <p className="text-[11px] text-text-secondary mt-1 break-words">{toast.message}</p>
      </div>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-text-secondary hover:text-white shrink-0 mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 transition"
        aria-label="Cerrar notificación"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export default function ToastStack() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      id="toast-stack"
      className="fixed top-24 right-4 flex flex-col gap-2 z-[998] pointer-events-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
