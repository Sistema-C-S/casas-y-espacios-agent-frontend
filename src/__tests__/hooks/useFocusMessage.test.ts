import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFocusMessage, MAX_FOCUS_PAGES, BUSY_RETRY_MS, MAX_BUSY_RETRIES } from '../../hooks/useFocusMessage'
import { useToastStore } from '../../store/toastStore'
import type { Message } from '../../types'

function message(id: string, wamId: string): Message {
  return {
    id,
    conversation_id: 'conv-1',
    wam_id: wamId,
    direction: 'inbound',
    msg_type: 'image',
    content: null,
    media_url: null,
    media_mime_type: null,
    media_size_bytes: null,
    transcription: null,
    delivered_via: 'whatsapp',
    timestamp: '2026-10-04T15:00:00Z',
    created_at: '2026-10-04T15:00:00Z',
    advisor_name: null,
  }
}

function feedWith(wamIds: string[]) {
  const feed = document.createElement('div')
  for (const wamId of wamIds) {
    const node = document.createElement('div')
    node.setAttribute('data-wam-id', wamId)
    node.scrollIntoView = vi.fn()
    feed.appendChild(node)
  }
  return { current: feed }
}

describe('useFocusMessage', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('scrolls to and highlights a message already loaded', async () => {
    const feedRef = feedWith(['wamid.A'])
    const loadOlder = vi.fn()
    const { result } = renderHook(() =>
      useFocusMessage({
        focusWamId: 'wamid.A',
        messages: [message('m1', 'wamid.A')],
        isReady: true,
        feedRef,
        loadOlder,
        canLoadOlder: () => true,
      }),
    )

    await waitFor(() => expect(result.current).toBe('wamid.A'))
    expect(feedRef.current.firstElementChild?.scrollIntoView).toHaveBeenCalled()
    expect(loadOlder).not.toHaveBeenCalled()
  })

  it('pages back until the message shows up', async () => {
    const feedRef = feedWith(['wamid.OLD'])
    let messages = [message('m2', 'wamid.NEW')]
    const loadOlder = vi.fn(async () => {
      messages = [message('m1', 'wamid.OLD'), ...messages]
      return 1
    })
    const { result, rerender } = renderHook(() =>
      useFocusMessage({
        focusWamId: 'wamid.OLD',
        messages,
        isReady: true,
        feedRef,
        loadOlder,
        canLoadOlder: () => true,
      }),
    )

    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1))
    rerender()
    await waitFor(() => expect(result.current).toBe('wamid.OLD'))
  })

  it(`gives up with a notice after ${MAX_FOCUS_PAGES} pages`, async () => {
    const loadOlder = vi.fn(async () => 100)
    renderHook(() =>
      useFocusMessage({
        focusWamId: 'wamid.MISSING',
        messages: [message('m1', 'wamid.X')],
        isReady: true,
        feedRef: feedWith([]),
        loadOlder,
        canLoadOlder: () => true,
      }),
    )

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    expect(loadOlder).toHaveBeenCalledTimes(MAX_FOCUS_PAGES)
    expect(useToastStore.getState().toasts[0].message).toMatch(/No se encontró el mensaje/)
  })

  it('waits instead of giving up when another page load is in flight', async () => {
    const loadOlder = vi.fn(async () => null)
    const stable = [message('m1', 'wamid.X')]
    renderHook(() =>
      useFocusMessage({
        focusWamId: 'wamid.MISSING',
        messages: stable,
        isReady: true,
        feedRef: feedWith([]),
        loadOlder,
        canLoadOlder: () => true,
      }),
    )
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(1))
    await act(async () => {
      await Promise.resolve()
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does nothing until the chat is ready, nor without a target', async () => {
    const loadOlder = vi.fn(async () => 0)
    const { rerender } = renderHook(
      ({ ready, target }: { ready: boolean; target: string | null }) =>
        useFocusMessage({
          focusWamId: target,
          messages: [],
          isReady: ready,
          feedRef: feedWith([]),
          loadOlder,
          canLoadOlder: () => false,
        }),
      { initialProps: { ready: false, target: 'wamid.A' as string | null } },
    )
    rerender({ ready: true, target: null })
    await act(async () => {
      await Promise.resolve()
    })
    expect(loadOlder).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('scrolls again when the same notification is opened a second time', async () => {
    const feedRef = feedWith(['wamid.A'])
    const messages = [message('m1', 'wamid.A')]
    const { result, rerender } = renderHook(
      ({ target }: { target: string | null }) =>
        useFocusMessage({
          focusWamId: target,
          messages,
          isReady: true,
          feedRef,
          loadOlder: vi.fn(),
          canLoadOlder: () => true,
        }),
      { initialProps: { target: 'wamid.A' as string | null } },
    )
    await waitFor(() => expect(result.current).toBe('wamid.A'))
    const node = feedRef.current.firstElementChild as HTMLElement
    expect(node.scrollIntoView).toHaveBeenCalledTimes(1)

    rerender({ target: null })
    rerender({ target: 'wamid.A' })
    await waitFor(() => expect(node.scrollIntoView).toHaveBeenCalledTimes(2))
  })

  it('scrolls again for the same wam id after the chat reloads (not ready, then ready)', async () => {
    const feedRef = feedWith(['wamid.A'])
    const messages = [message('m1', 'wamid.A')]
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useFocusMessage({
          focusWamId: 'wamid.A',
          messages,
          isReady: ready,
          feedRef,
          loadOlder: vi.fn(),
          canLoadOlder: () => true,
        }),
      { initialProps: { ready: true } },
    )
    const node = feedRef.current.firstElementChild as HTMLElement
    await waitFor(() => expect(node.scrollIntoView).toHaveBeenCalledTimes(1))

    rerender({ ready: false })
    rerender({ ready: true })
    await waitFor(() => expect(node.scrollIntoView).toHaveBeenCalledTimes(2))
  })

  it('gives each conversation its own page budget', async () => {
    const loadOlder = vi.fn(async () => 100)
    const messages = [message('m1', 'wamid.X')]
    const { rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) =>
        useFocusMessage({
          focusWamId: 'wamid.MISSING',
          conversationId,
          messages,
          isReady: true,
          feedRef: feedWith([]),
          loadOlder,
          canLoadOlder: () => true,
        }),
      { initialProps: { conversationId: 'conv-1' } },
    )
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(MAX_FOCUS_PAGES))
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))

    rerender({ conversationId: 'conv-2' })
    await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(MAX_FOCUS_PAGES * 2))
  })

  describe('when another load keeps the page busy', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('ends the search with the notice instead of waiting forever', async () => {
      const loadOlder = vi.fn(async () => null)
      const stable = [message('m1', 'wamid.X')]
      renderHook(() =>
        useFocusMessage({
          focusWamId: 'wamid.MISSING',
          messages: stable,
          isReady: true,
          feedRef: feedWith([]),
          loadOlder,
          canLoadOlder: () => true,
        }),
      )
      // One act per tick: React only re-renders (and re-runs the search) when act exits.
      for (let tick = 0; tick < MAX_BUSY_RETRIES + 2; tick += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS)
        })
      }
      expect(useToastStore.getState().toasts).toHaveLength(1)
      expect(useToastStore.getState().toasts[0].message).toMatch(/No se encontró el mensaje/)
    })
  })
})
