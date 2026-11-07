import { describe, it, expect, beforeEach, vi } from 'vitest'
import { notificationsService } from '../../services/notifications'
import apiClient from '../../lib/axios'
import { notification } from '../fixtures/notifications'

vi.mock('../../lib/axios')

describe('notificationsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists with filters and unwraps the envelope', async () => {
    const payload = { notifications: [notification()], total: 1, limit: 20, offset: 0, pending_count: 1 }
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: payload } } as never)

    const result = await notificationsService.list({ status: 'pendiente', limit: 20, offset: 0 })

    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/notifications', {
      params: { status: 'pendiente', limit: 20, offset: 0 },
    })
    expect(result).toEqual(payload)
  })

  it('passes the abort signal through', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: {} } } as never)
    const controller = new AbortController()
    await notificationsService.getById('n-1', controller.signal)
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/notifications/n-1', { signal: controller.signal })
  })

  it('trims the note and omits it when blank', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { data: { notification: notification() } } } as never)

    await notificationsService.close('n-1', { status: 'resuelta', note: '  Registrado  ' })
    expect(apiClient.patch).toHaveBeenLastCalledWith('/api/v1/panel/notifications/n-1', {
      status: 'resuelta',
      note: 'Registrado',
    })

    await notificationsService.close('n-1', { status: 'resuelta', note: '   ' })
    expect(apiClient.patch).toHaveBeenLastCalledWith('/api/v1/panel/notifications/n-1', { status: 'resuelta' })
  })

  it('encodes the id in the path', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: {} } } as never)
    await notificationsService.getById('a/b')
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/notifications/a%2Fb', {})
  })

  it('forwards the silent flag on list, getById and close', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: {} } } as never)
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { data: {} } } as never)

    await notificationsService.list({ status: 'pendiente', limit: 1 }, undefined, { silent: true })
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/v1/panel/notifications', {
      params: { status: 'pendiente', limit: 1 },
      silent: true,
    })

    await notificationsService.getById('n-1', undefined, { silent: true })
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/v1/panel/notifications/n-1', { silent: true })

    await notificationsService.close('n-1', { status: 'resuelta' }, { silent: true })
    expect(apiClient.patch).toHaveBeenLastCalledWith(
      '/api/v1/panel/notifications/n-1',
      { status: 'resuelta' },
      { silent: true },
    )
  })
})
