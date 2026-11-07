import axios from 'axios'

export interface ApiErrorInfo {
  /** HTTP status, or undefined for network errors / non-HTTP failures. */
  status?: number
  /** `detail.code` from the backend error envelope, when present. */
  code?: string
}

/** Reads the backend error envelope `{ detail: { code, message } }` safely. */
export function getApiErrorInfo(error: unknown): ApiErrorInfo {
  if (!axios.isAxiosError(error)) return {}
  const detail = (error.response?.data as { detail?: { code?: unknown } } | undefined)?.detail
  return {
    status: error.response?.status,
    code: typeof detail?.code === 'string' ? detail.code : undefined,
  }
}

export function isAbortError(error: unknown): boolean {
  return axios.isCancel(error) || (error instanceof DOMException && error.name === 'AbortError')
}
