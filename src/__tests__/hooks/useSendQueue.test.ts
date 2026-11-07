// The composer used to lock itself until each HTTP send finished. The queue lets
// the advisor keep typing while earlier sends are in flight, and it must keep
// those sends strictly in order: WhatsApp shows messages in delivery order, so a
// second message overtaking the first would scramble the conversation.
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useSendQueue } from '../../hooks/useSendQueue'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => act(async () => { await Promise.resolve() })

describe('useSendQueue', () => {
  it('starts the next send only after the previous one settled', async () => {
    const { result } = renderHook(() => useSendQueue())
    const first = deferred()
    const run1 = vi.fn(() => first.promise)
    const run2 = vi.fn(() => Promise.resolve())

    act(() => {
      result.current.enqueue({ run: run1, onFailure: vi.fn(), onSkipped: vi.fn() })
      result.current.enqueue({ run: run2, onFailure: vi.fn(), onSkipped: vi.fn() })
    })
    await flush()

    expect(run1).toHaveBeenCalledTimes(1)
    expect(run2).not.toHaveBeenCalled()

    await act(async () => { first.resolve() })
    await flush()

    expect(run2).toHaveBeenCalledTimes(1)
  })

  it('tracks how many sends are still pending', async () => {
    const { result } = renderHook(() => useSendQueue())
    const first = deferred()

    act(() => {
      result.current.enqueue({ run: () => first.promise, onFailure: vi.fn(), onSkipped: vi.fn() })
      result.current.enqueue({ run: () => Promise.resolve(), onFailure: vi.fn(), onSkipped: vi.fn() })
    })
    expect(result.current.pendingCount).toBe(2)

    await act(async () => { first.resolve() })
    await flush()

    expect(result.current.pendingCount).toBe(0)
  })

  it('skips the sends queued behind a failure instead of letting them overtake it', async () => {
    const { result } = renderHook(() => useSendQueue())
    const first = deferred()
    const error = new Error('boom')
    const onFailure = vi.fn()
    const run2 = vi.fn(() => Promise.resolve())
    const onSkipped2 = vi.fn()

    act(() => {
      result.current.enqueue({ run: () => first.promise, onFailure, onSkipped: vi.fn() })
      result.current.enqueue({ run: run2, onFailure: vi.fn(), onSkipped: onSkipped2 })
    })

    await act(async () => { first.reject(error) })
    await flush()

    expect(onFailure).toHaveBeenCalledWith(error)
    expect(run2).not.toHaveBeenCalled()
    expect(onSkipped2).toHaveBeenCalledTimes(1)
    expect(result.current.pendingCount).toBe(0)
  })

  it('sends normally again once the queue has drained after a failure', async () => {
    const { result } = renderHook(() => useSendQueue())
    const run = vi.fn(() => Promise.resolve())

    act(() => {
      result.current.enqueue({
        run: () => Promise.reject(new Error('boom')),
        onFailure: vi.fn(),
        onSkipped: vi.fn(),
      })
    })
    await flush()
    await flush()

    act(() => {
      result.current.enqueue({ run, onFailure: vi.fn(), onSkipped: vi.fn() })
    })
    await flush()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps draining when a callback throws', async () => {
    const { result } = renderHook(() => useSendQueue())
    const run2 = vi.fn(() => Promise.resolve())

    act(() => {
      result.current.enqueue({
        run: () => Promise.reject(new Error('boom')),
        onFailure: () => { throw new Error('callback bug') },
        onSkipped: vi.fn(),
      })
      result.current.enqueue({ run: run2, onFailure: vi.fn(), onSkipped: vi.fn() })
    })
    await flush()
    await flush()

    expect(result.current.pendingCount).toBe(0)
  })

  it('keeps independent queues per key so one key never blocks another', async () => {
    const { result } = renderHook(() => useSendQueue())
    const stuck = deferred()
    const runA = vi.fn(() => stuck.promise)
    const runB = vi.fn(() => Promise.resolve())

    act(() => {
      result.current.enqueue({ run: runA, onFailure: vi.fn(), onSkipped: vi.fn() }, 'a')
      result.current.enqueue({ run: runB, onFailure: vi.fn(), onSkipped: vi.fn() }, 'b')
    })
    await flush()

    expect(runB).toHaveBeenCalledTimes(1)
  })

  it('keeps FIFO order within a key and halts only that key after a failure', async () => {
    const { result } = renderHook(() => useSendQueue())
    const first = deferred()
    const onSkippedA = vi.fn()
    const onSkippedB = vi.fn()
    const runA2 = vi.fn(() => Promise.resolve())
    const runB = vi.fn(() => Promise.resolve())

    act(() => {
      result.current.enqueue({ run: () => first.promise, onFailure: vi.fn(), onSkipped: vi.fn() }, 'a')
      result.current.enqueue({ run: runA2, onFailure: vi.fn(), onSkipped: onSkippedA }, 'a')
      result.current.enqueue({ run: runB, onFailure: vi.fn(), onSkipped: onSkippedB }, 'b')
    })
    await flush()
    await act(async () => { first.reject(new Error('network')) })
    await flush()
    await flush()

    expect(runA2).not.toHaveBeenCalled()
    expect(onSkippedA).toHaveBeenCalledTimes(1)
    expect(runB).toHaveBeenCalledTimes(1)
    expect(onSkippedB).not.toHaveBeenCalled()
  })
})
