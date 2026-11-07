import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
  /** Overrides ToastStack's default lifetime — for a toast the reader must act on. */
  durationMs?: number
}

export interface ToastOptions {
  durationMs?: number
}

const MAX_TOASTS = 3

let nextId = 0

interface ToastState {
  toasts: Toast[]
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void
  removeToast: (id: number) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  showToast: (message, type = 'success', options) => {
    const id = nextId++
    const toast: Toast = options?.durationMs
      ? { id, message, type, durationMs: options.durationMs }
      : { id, message, type }
    set((s) => ({
      toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), toast],
    }))
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
