import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useWSStore } from '../../store/wsStore'
import { ROUTES } from '../../constants/routes'
import Sidebar from './Sidebar'
import ToastStack from '../shared/ToastStack'
import EscalationToast from '../shared/EscalationToast'
import NotificationToast from '../shared/NotificationToast'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useNotificationsBadgeSync } from '../../hooks/useNotificationsBadgeSync'
import type { AdvisorRole, WSStatus } from '../../types'

interface Props {
  requiredRole?: AdvisorRole
}

export default function ProtectedRoute({ requiredRole }: Props) {
  const { token, role, isFirstLogin } = useAuthStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { reconnect } = useWebSocket()
  useNotificationsBadgeSync(Boolean(token) && !isFirstLogin)
  const location = useLocation()

  if (!token) return <Navigate to={ROUTES.LOGIN} state={{ from: location.pathname }} replace />
  if (isFirstLogin) return <Navigate to={ROUTES.FIRST_LOGIN} replace />
  if (requiredRole && role !== null && role !== requiredRole) {
    return <Navigate to={ROUTES.BANDEJA} replace />
  }

  return (
    <div className="h-screen overflow-hidden bg-bg-main flex">
      <Sidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <MobileHeader onOpenSidebar={() => setMobileOpen(true)} />
        <WSStatusBanner onReconnect={reconnect} />
        <main className="app-scroll flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <EscalationToast />
      <NotificationToast />
      <ToastStack />
    </div>
  )
}

function MobileHeader({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const location = useLocation()
  const { role } = useAuthStore()
  const { status: wsStatus } = useWSStore()

  const titleMap: Record<string, string> = {
    '/': 'Bandeja',
    '/historial': 'Historial',
    '/gestion': 'Gestión',
    '/perfil': 'Perfil',
    [ROUTES.CONTACTOS]: 'Contactos',
    [ROUTES.NOTIFICACIONES]: 'Notificaciones',
  }

  const getTitle = () => {
    if (location.pathname.startsWith('/chat/')) return 'Chat'
    return titleMap[location.pathname] ?? 'Bandeja'
  }

  const WS_DOT_CLASSES: Record<WSStatus, string> = {
    connecting: 'bg-text-secondary animate-pulse',
    connected: 'bg-brand-blue ws-pulse-dot',
    reconnecting: 'bg-warning',
    disconnected: 'bg-error',
  }

  return (
    <div className="md:hidden flex items-center justify-between bg-bg-secondary border-b border-border-default px-4 py-3 shrink-0">
      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenSidebar}
          className="text-text-secondary hover:text-white p-1 focus:outline-none transition"
          aria-label="Abrir menú"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-label text-text-primary uppercase">
          {getTitle()}
        </span>
      </div>
      <div className="flex items-center space-x-2">
        <span className={`w-2 h-2 rounded-full ${WS_DOT_CLASSES[wsStatus]}`} />
        <span className="text-[9px] text-text-secondary uppercase font-bold">
          {role ?? 'Asesor'}
        </span>
      </div>
    </div>
  )
}

// A reconnect after a dropped socket normally completes in 1–2s (1s backoff +
// token + handshake), and the browser drops the socket on its own often enough
// — a backgrounded/frozen tab, a wifi blip — that flashing a banner for every
// one of them is noise, right when the advisor is reading the message that just
// arrived. So the banner waits: if the socket is back before this delay, it
// never appears; a real outage still shows it, and nothing about the socket's
// own reconnection logic changes (this is display only).
const RECONNECTING_BANNER_DELAY_MS = 2500

export function WSStatusBanner({ onReconnect }: { onReconnect: () => void }) {
  const status = useWSStore((s) => s.status)

  if (status === 'disconnected') {
    return (
      <div
        id="ws-disconnected-banner"
        className="fixed top-0 left-0 right-0 bg-error/90 backdrop-blur-sm text-white text-xs text-center py-2 z-50 flex items-center justify-center gap-2"
      >
        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
        Sin conexión — los mensajes pueden no llegar en tiempo real.
        <button
          onClick={onReconnect}
          className="underline ml-1 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 transition"
        >
          Reconectar
        </button>
      </div>
    )
  }

  if (status === 'reconnecting') return <ReconnectingBanner />

  return null
}

// Mounted only while the socket is reconnecting, so every drop starts its own
// wait: it renders nothing until the delay above has passed, and unmounts the
// moment the socket is back.
function ReconnectingBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), RECONNECTING_BANNER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div
      id="ws-reconnecting-banner"
      className="fixed top-0 left-0 right-0 bg-warning/90 backdrop-blur-sm text-white text-xs text-center py-2 z-50 flex items-center justify-center gap-2"
    >
      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
      Reconectando...
    </div>
  )
}
