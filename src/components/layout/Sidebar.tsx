import { useEffect, useCallback, memo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useWSStore } from '../../store/wsStore'
import { alertsService } from '../../services/alerts'
import { useNotificationsStore } from '../../store/notificationsStore'
import { ROUTES } from '../../constants/routes'
import type { AvailabilityStatus, WSStatus } from '../../types'

function getSystemStatus(wsStatus: WSStatus): { emoji: string; label: string; subtitle: string; color: string; pulse: boolean } {
  switch (wsStatus) {
    case 'connected':
      return { emoji: '🟢', label: 'Estado del sistema', subtitle: 'Todo en orden', color: 'var(--color-success)', pulse: false }
    case 'reconnecting':
      return { emoji: '🟡', label: 'Estado del sistema', subtitle: 'Conexión inestable', color: 'var(--color-warning)', pulse: true }
    case 'disconnected':
      return { emoji: '🔴', label: 'Estado del sistema', subtitle: 'Sin conexión', color: 'var(--color-error)', pulse: false }
    default:
      return { emoji: '🔵', label: 'Estado del sistema', subtitle: 'Conectando...', color: 'var(--color-text-secondary)', pulse: true }
  }
}

export interface SidebarProps {
  mobileOpen: boolean
  onClose: () => void
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

interface NavItemProps {
  to: string
  active: boolean
  label: string
  icon: React.ReactNode
  badge?: number
  badgeId?: string
}

const NavItem = memo(function NavItem({ to, active, label, icon, badge, badgeId }: NavItemProps) {
  return (
    <Link
      to={to}
      // Anchors are natively draggable. When switching pages quickly, the few
      // pixels the mouse travels while pressed start a link drag instead of a
      // click: the navigation never happens, and on Windows the OS drag loop
      // can keep swallowing mouse input, leaving the panel painted but
      // unclickable until a reload. Sidebar links are never meant to be dragged.
      draggable={false}
      className={[
        'flex items-center justify-between pr-3.5 py-2.5 rounded-md text-xs font-semibold transition w-full',
        active
          ? 'text-white'
          : 'text-text-secondary hover:text-white hover:bg-bg-tertiary/50 pl-4',
      ].join(' ')}
      style={
        active
          ? {
              background: 'linear-gradient(135deg, var(--color-brand-blue) 0%, var(--color-brand-blue-hover) 100%)',
              borderLeft: '4px solid var(--color-success)',
              paddingLeft: '0.75rem',
            }
          : undefined
      }
    >
      <span className="flex items-center space-x-2.5">
        {icon}
        <span>{label}</span>
      </span>
      {badge !== undefined && badge > 0 && (
        <span
          id={badgeId}
          className="bg-error text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
})

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  
  // Zustand selectors (Rule 1: no usar el store completo como dependencia para evitar re-renders)
  const advisor = useAuthStore((s) => s.advisor)
  const role = useAuthStore((s) => s.role)
  const reset = useAuthStore((s) => s.reset)
  
  const wsStatus = useWSStore((s) => s.status)
  const unreadAlerts = useWSStore((s) => s.unreadAlerts)
  const pendingNotifications = useNotificationsStore((s) => s.pendingCount)

  const AVAILABILITY_DOT_CLASSES: Record<AvailabilityStatus, string> = {
    available: 'bg-success',
    break: 'bg-warning',
    offline: 'bg-error',
  }

  useEffect(() => {
    onClose()
  }, [location.pathname, onClose])

  // Carga inicial de alertas sin revisar desde BD al montar o cambiar rol (solo admin)
  useEffect(() => {
    if (role !== 'admin') {
      useWSStore.getState().setUnreadAlerts(0)
      return
    }

    alertsService
      .list({ reviewed: false, limit: 1 })
      .then((result) => {
        useWSStore.getState().setUnreadAlerts(result.total)
      })
      .catch(() => {
        // Fallar silenciosamente en caso de error
      })
  }, [role])

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const handleSignOut = useCallback(() => {
    reset()
    navigate('/login')
  }, [reset, navigate])

  return (
    <>
      <style>{`
        @keyframes wsPulse {
          0%   { transform: scale(0.9); opacity: 0.6; }
          50%  { transform: scale(1.25); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.6; }
        }
        .ws-pulse-dot {
          animation: wsPulse 1.6s infinite ease-in-out;
        }
      `}</style>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-30 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        id="main-sidebar"
        className={[
          'fixed top-0 bottom-0 left-0 w-64',
          'border-r border-border-default flex flex-col justify-between p-4 shrink-0 z-40',
          'transition-transform duration-300',
          'md:sticky md:top-0 md:h-screen md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        style={{
          background: 'rgba(37,37,34,0.8)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div className="space-y-6">
          {/* User profile card */}
          <div className="flex items-center space-x-3.5 p-3 bg-gradient-to-r from-bg-tertiary/60 to-bg-secondary/60 rounded-xl border border-border-default hover:border-brand-blue/35 shadow-lg shadow-black/10 hover:shadow-brand-blue/5 hover:bg-bg-tertiary/85 transition-all duration-300 ease-in-out cursor-pointer group">
            <div className="relative shrink-0">
              {advisor?.avatar_url ? (
                <img
                  src={advisor.avatar_url}
                  alt={advisor.full_name ?? 'Avatar'}
                  className="w-10 h-10 rounded-full object-cover border border-brand-blue/30 shadow-sm ring-1 ring-brand-blue/15 transition duration-300 group-hover:ring-brand-blue/30"
                />
              ) : (
                <div className="w-10 h-10 rounded-full border border-brand-blue/30 bg-gradient-to-br from-brand-blue/20 to-brand-blue/5 flex items-center justify-center shadow-sm ring-1 ring-brand-blue/15 transition duration-300 group-hover:ring-brand-blue/30">
                  <span className="text-xs font-bold text-brand-blue tracking-wider">
                    {getInitials(advisor?.full_name)}
                  </span>
                </div>
              )}
              <div
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg-secondary ${
                  AVAILABILITY_DOT_CLASSES[advisor?.availability_status ?? 'offline']
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-label text-text-primary group-hover:text-brand-blue truncate transition duration-300">
                {advisor?.full_name ?? 'Asesor'}
              </h4>
              <p className="text-[11px] font-medium text-text-secondary truncate mt-0.5" title={advisor?.email}>
                {advisor?.email}
              </p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                <span
                  className={[
                    'text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase inline-block border tracking-wider transition duration-300',
                    role === 'admin'
                      ? 'bg-error/10 text-error border-error/20 shadow-[0_0_6px_rgba(255,91,91,0.05)] group-hover:border-error/35'
                      : 'bg-brand-blue/10 text-brand-blue border-brand-blue/20 shadow-[0_0_6px_rgba(1,164,227,0.05)] group-hover:border-brand-blue/35',
                  ].join(' ')}
                >
                  {role ?? 'asesor'}
                </span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="space-y-1.5" id="sidebar-navigation-container">
            <NavItem
              to="/"
              active={isActive('/')}
              label="Bandeja de Entrada"
              icon={
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
            />

            <NavItem
              to={ROUTES.NOTIFICACIONES}
              active={isActive(ROUTES.NOTIFICACIONES)}
              label="Notificaciones"
              badge={pendingNotifications}
              badgeId="sidebar-notifications-badge"
              icon={
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              }
            />

            <NavItem
              to="/historial"
              active={isActive('/historial')}
              label="Historial Cerrados"
              icon={
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />

            <NavItem
              to="/contactos"
              active={isActive('/contactos')}
              label="Contactos"
              icon={
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4" />
                </svg>
              }
            />

            {/*
              NOTA: El badge de "Gestión Asesores" muestra unreadAlerts (alertas de comportamiento sin revisar).
              Zustand se encarga de incrementarlo por WebSocket (evento behavior.alert).
              Se debe llamar a useWSStore.getState().decrementAlerts() en GestionPage.tsx 
              cuando el admin marque una alerta como revisada (alertsService.markReviewed).
            */}
            {role === 'admin' && (
              <NavItem
                to="/gestion"
                active={isActive('/gestion')}
                label="Gestión Asesores"
                badge={unreadAlerts}
                badgeId="sidebar-gestion-badge"
                icon={
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                }
              />
            )}

            <NavItem
              to="/perfil"
              active={isActive('/perfil')}
              label="Mi Perfil"
              icon={
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              }
            />
          </nav>
        </div>

        {/* Bottom section */}
        <div className="mt-8 pt-4 border-t border-border-default/60 space-y-3">
          {/* System status indicator */}
          {(() => {
            const sys = getSystemStatus(wsStatus)
            return (
              <div className="px-4 py-3.5 bg-bg-main rounded-lg border border-border-default flex items-start gap-3">
                <span className="text-base leading-6 shrink-0">{sys.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-primary">{sys.label}</p>
                  <p className="text-[11px] mt-1 truncate" style={{ color: sys.color }}>
                    {sys.subtitle}
                  </p>
                  {sys.pulse && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full mt-1.5"
                      style={{
                        backgroundColor: sys.color,
                        animation: 'wsPulse 1.6s infinite ease-in-out',
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })()}

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2.5 border border-error/30 hover:border-error text-error hover:bg-error/10 rounded-control text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>
    </>
  )
}
