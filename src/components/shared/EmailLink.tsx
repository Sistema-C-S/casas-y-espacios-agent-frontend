import { useToastStore } from '../../store/toastStore'
import { isValidEmail } from '../../lib/mailto'

interface EmailLinkProps {
  email: string
  className?: string
}

// One clickable email for every place that shows a client's email (chat panel, Contactos).
// Click copies the address. It is always shown in full: a line break is offered right before
// the '@' so, where the container is narrow, it splits as "local-part / @domain" instead of
// mid-word; overflow-wrap only breaks inside a part if that part alone does not fit.
export function EmailLink({ email, className = '' }: EmailLinkProps) {
  const value = email.trim()
  const valid = isValidEmail(value)
  const at = value.lastIndexOf('@')

  const showToast = useToastStore((s) => s.showToast)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      showToast('Correo copiado', 'success')
    } catch {
      showToast('No se pudo copiar el correo', 'error')
    }
  }

  return (
    <span className={`block ${className}`}>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copiar correo ${value}`}
        title={valid ? 'Clic para copiar' : `Correo no válido: ${value}`}
        className={`text-left [overflow-wrap:anywhere] cursor-copy hover:text-brand-blue transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/90 rounded-sm ${
          valid ? '' : 'line-through decoration-text-secondary/60'
        }`}
      >
        {at > 0 ? (
          <>
            {value.slice(0, at)}
            <wbr />
            {value.slice(at)}
          </>
        ) : (
          value
        )}
      </button>
      {!valid && <span className="block text-[10px] font-sans text-amber-400">Correo no válido</span>}
    </span>
  )
}
