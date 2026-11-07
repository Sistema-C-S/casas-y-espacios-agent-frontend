import type { AxiosRequestConfig } from 'axios'
import apiClient from '../lib/axios'
import { withSignal } from './requestConfig'
import type {
  AgentNotification,
  CloseNotificationBody,
  NotificationList,
  NotificationListParams,
} from '../types'

const BASE = '/api/v1/panel/notifications'

/**
 * `silent` keeps the axios interceptor from toasting a failure — for callers
 * that report it themselves (the inbox's close) or must not bother the advisor
 * at all (the sidebar badge sync).
 */
export interface NotificationRequestOptions {
  silent?: boolean
}

function withSilent<T extends AxiosRequestConfig>(config: T, options?: NotificationRequestOptions): T {
  return options?.silent ? { ...config, silent: true } : config
}

export const notificationsService = {

  async list(
    params?: NotificationListParams,
    signal?: AbortSignal,
    options?: NotificationRequestOptions,
  ): Promise<NotificationList> {
    const { data } = await apiClient.get(BASE, withSilent(withSignal({ params }, signal), options))
    return data.data
  },

  async getById(
    id: string,
    signal?: AbortSignal,
    options?: NotificationRequestOptions,
  ): Promise<{ notification: AgentNotification }> {
    const { data } = await apiClient.get(
      `${BASE}/${encodeURIComponent(id)}`,
      withSilent(withSignal({}, signal), options),
    )
    return data.data
  },

  // The closing advisor comes from the JWT. A blank note is dropped instead of
  // sent — the backend would store it as null anyway.
  async close(
    id: string,
    body: CloseNotificationBody,
    options?: NotificationRequestOptions,
  ): Promise<{ notification: AgentNotification }> {
    const note = body.note?.trim()
    const payload: CloseNotificationBody = note ? { status: body.status, note } : { status: body.status }
    const url = `${BASE}/${encodeURIComponent(id)}`
    // Third argument only when silent, so a plain close keeps its exact request shape.
    const { data } = options?.silent
      ? await apiClient.patch(url, payload, { silent: true })
      : await apiClient.patch(url, payload)
    return data.data
  },
}
