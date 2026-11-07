import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import ToastStack from '../../components/shared/ToastStack'
import { useToastStore } from '../../store/toastStore'

beforeEach(() => {
  vi.useFakeTimers()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastStack — per-toast duration', () => {
  it('keeps the default 4s lifetime when no duration is given', () => {
    render(<ToastStack />)
    act(() => useToastStore.getState().showToast('corto', 'info'))

    act(() => vi.advanceTimersByTime(3_900))
    expect(screen.getByText('corto')).toBeTruthy()

    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText('corto')).toBeNull()
  })

  it('honors a longer duration for a toast that asks the advisor to act', () => {
    render(<ToastStack />)
    act(() => useToastStore.getState().showToast('largo', 'warning', { durationMs: 15_000 }))

    act(() => vi.advanceTimersByTime(14_900))
    expect(screen.getByText('largo')).toBeTruthy()

    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText('largo')).toBeNull()
  })
})
