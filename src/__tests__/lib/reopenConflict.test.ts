import { beforeEach, describe, it, expect } from 'vitest'
import {
  ACTIVE_CONVERSATION_NOTICE_MS,
  activeConversationNotice,
  extractActiveConversation,
  notifyActiveConversation,
} from '../../lib/reopenConflict'
import { useToastStore } from '../../store/toastStore'

function axiosError(detail: unknown) {
  return { response: { status: 409, data: { detail } } }
}

const ACTIVE = {
  id: 'conv-live',
  status: 'activa',
  bot_activo: true,
  case_number: 'CE-2026-000123',
}

describe('extractActiveConversation', () => {
  it('reads the live conversation from a CLIENT_HAS_ACTIVE_CONVERSATION 409', () => {
    const err = axiosError({
      code: 'CLIENT_HAS_ACTIVE_CONVERSATION',
      message: 'El cliente ya tiene una conversación activa',
      active_conversation: ACTIVE,
    })
    expect(extractActiveConversation(err)).toEqual(ACTIVE)
  })

  it('returns null when the backend did not send it (older backend)', () => {
    // A backend from before this field must keep the previous behavior:
    // toast only, no navigation to an id we do not have.
    const err = axiosError({ code: 'CLIENT_HAS_ACTIVE_CONVERSATION', message: 'x' })
    expect(extractActiveConversation(err)).toBeNull()
  })

  it('returns null for a malformed payload instead of navigating to garbage', () => {
    expect(extractActiveConversation(axiosError({ active_conversation: { id: '' } }))).toBeNull()
    expect(extractActiveConversation(axiosError({ active_conversation: { id: 42 } }))).toBeNull()
    expect(extractActiveConversation(axiosError({ active_conversation: 'conv-live' }))).toBeNull()
    expect(extractActiveConversation(new Error('network'))).toBeNull()
    expect(extractActiveConversation(undefined)).toBeNull()
  })

  it('tolerates a missing case number and status', () => {
    const err = axiosError({ active_conversation: { id: 'conv-live', bot_activo: false } })
    expect(extractActiveConversation(err)).toEqual({
      id: 'conv-live',
      status: null,
      bot_activo: false,
      case_number: null,
    })
  })
})

describe('activeConversationNotice', () => {
  it('names the exact take-control button when the bot is handling it', () => {
    // The advisor has to find the button on the page she just landed on —
    // "take control" in the abstract did not tell her which button to press.
    const notice = activeConversationNotice(ACTIVE)
    expect(notice).toContain('CE-2026-000123')
    expect(notice).toContain('«Tomar control manual»')
  })

  it('does not ask for take-control when an advisor already has it', () => {
    const notice = activeConversationNotice({ ...ACTIVE, bot_activo: false })
    expect(notice).toContain('CE-2026-000123')
    expect(notice).not.toContain('Tomar control manual')
  })

  it('omits the case number when there is none', () => {
    const notice = activeConversationNotice({ ...ACTIVE, case_number: null })
    expect(notice).not.toContain('(')
  })
})

describe('notifyActiveConversation', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('shows a long-lived warning when the advisor still has to take control', () => {
    // The default 4s toast vanished while the new chat was still loading.
    notifyActiveConversation(ACTIVE)
    const [toast] = useToastStore.getState().toasts
    expect(toast.type).toBe('warning')
    expect(toast.durationMs).toBe(ACTIVE_CONVERSATION_NOTICE_MS)
    expect(ACTIVE_CONVERSATION_NOTICE_MS).toBeGreaterThanOrEqual(10_000)
  })

  it('stays informational when an advisor already has the conversation', () => {
    notifyActiveConversation({ ...ACTIVE, bot_activo: false })
    const [toast] = useToastStore.getState().toasts
    expect(toast.type).toBe('info')
    expect(toast.durationMs).toBe(ACTIVE_CONVERSATION_NOTICE_MS)
  })
})
