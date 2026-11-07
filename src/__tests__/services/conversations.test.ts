import { describe, it, expect, beforeEach, vi } from 'vitest'
import { conversationsService } from '../../services/conversations'
import apiClient from '../../lib/axios'

vi.mock('../../lib/axios')

describe('conversationsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('should fetch conversations with default params', async () => {
      const mockResponse = {
        data: {
          data: {
            items: [
              { id: 'conv-1', client_name: 'John' },
              { id: 'conv-2', client_name: 'Jane' },
            ],
            total: 2,
          },
        },
      }
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.list()

      // list() has no default value for `params` — calling it with no args
      // forwards `undefined` straight through to axios (functionally identical
      // to `{}` in the resulting query string, but not the same JS value).
      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/conversations/', { params: undefined })
      expect(result).toEqual(mockResponse.data.data)
    })

    it('should fetch conversations with filters', async () => {
      const mockResponse = { data: { data: { items: [], total: 0 } } }
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse as any)

      await conversationsService.list({
        status: 'activa',
        channel: 'administrativa',
        limit: 50,
        offset: 0,
      })

      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/conversations/', {
        params: {
          status: 'activa',
          channel: 'administrativa',
          limit: 50,
          offset: 0,
        },
      })
    })

    it('should propagate API errors', async () => {
      const error = new Error('Network error')
      vi.mocked(apiClient.get).mockRejectedValue(error)

      await expect(conversationsService.list()).rejects.toThrow('Network error')
    })
  })

  describe('getById', () => {
    it('should fetch conversation details with messages', async () => {
      const mockResponse = {
        data: {
          data: {
            conversation: {
              id: 'conv-1',
              client_name: 'John',
              messages: [{ id: 'msg-1', content: 'Hello' }],
              total_messages: 1,
            },
          },
        },
      }
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.getById('conv-1')

      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1', {
        params: { limit: 50, offset: 0 },
      })
      expect(result.conversation.id).toBe('conv-1')
      expect(result.messages).toHaveLength(1)
      expect(result.total_messages).toBe(1)
    })

    it('should handle conversations without messages', async () => {
      const mockResponse = {
        data: {
          data: {
            conversation: {
              id: 'conv-1',
              client_name: 'John',
              messages: undefined,
              total_messages: undefined,
            },
          },
        },
      }
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.getById('conv-1')

      expect(result.messages).toEqual([])
      expect(result.total_messages).toBe(0)
    })

    it('should support custom limit parameter', async () => {
      const mockResponse = { data: { data: { conversation: {}, messages: [], total_messages: 0 } } }
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse as any)

      await conversationsService.getById('conv-1', 100)

      expect(apiClient.get).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1', {
        params: { limit: 100, offset: 0 },
      })
    })
  })

  describe('replyText', () => {
    it('should send text message', async () => {
      const mockResponse = { data: { data: { message: { id: 'msg-1', content: 'Reply' } } } }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.replyText('conv-1', 'Hello')

      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1/reply', {
        text: 'Hello',
      })
      expect(result.message.id).toBe('msg-1')
    })

    it('sends client_message_id in the JSON body when given', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { data: { message: { id: 'm' } } } } as never)

      await conversationsService.replyText('conv-1', 'Hello', 'uuid-1')

      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1/reply', {
        text: 'Hello',
        client_message_id: 'uuid-1',
      })
    })

    it('should propagate text message errors', async () => {
      const error = new Error('Message too long')
      vi.mocked(apiClient.post).mockRejectedValue(error)

      await expect(conversationsService.replyText('conv-1', 'x'.repeat(5000))).rejects.toThrow(
        'Message too long'
      )
    })
  })

  describe('replyMedia', () => {
    it('should send media with FormData', async () => {
      const mockResponse = { data: { data: { message: { id: 'msg-1', media_url: 'url' } } } }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
      const result = await conversationsService.replyMedia('conv-1', file)

      expect(apiClient.post).toHaveBeenCalled()
      const call = vi.mocked(apiClient.post).mock.calls[0]
      expect(call[0]).toBe('/api/v1/panel/conversations/conv-1/reply/media')
      expect(call[1]).toBeInstanceOf(FormData)
      expect(result.message.id).toBe('msg-1')
    })

    it('should send media with caption', async () => {
      const mockResponse = { data: { data: { message: { id: 'msg-1' } } } }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' })
      await conversationsService.replyMedia('conv-1', file, 'Look at this')

      const call = vi.mocked(apiClient.post).mock.calls[0]
      expect(call[1]).toBeInstanceOf(FormData)
    })
  })

  describe('client_message_id on media and audio', () => {
    it('appends client_message_id to the media form', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { data: { message: { id: 'm' } } } } as never)
      const file = new File(['c'], 'a.jpg', { type: 'image/jpeg' })

      await conversationsService.replyMedia('conv-1', file, 'cap', 'uuid-2')

      const form = vi.mocked(apiClient.post).mock.calls[0][1] as FormData
      expect(form.get('client_message_id')).toBe('uuid-2')
      expect(form.get('caption')).toBe('cap')
    })

    it('appends client_message_id to the audio form', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { data: { message: { id: 'm' } } } } as never)

      await conversationsService.replyAudio('conv-1', new Blob(['a'], { type: 'audio/ogg' }), 'uuid-3')

      const form = vi.mocked(apiClient.post).mock.calls[0][1] as FormData
      expect(form.get('client_message_id')).toBe('uuid-3')
    })

    it('omits the field when no id is given (previous behaviour)', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { data: { message: { id: 'm' } } } } as never)

      await conversationsService.replyMedia('conv-1', new File(['c'], 'a.jpg', { type: 'image/jpeg' }))
      await conversationsService.replyAudio('conv-1', new Blob(['a'], { type: 'audio/ogg' }))

      for (const call of vi.mocked(apiClient.post).mock.calls) {
        expect((call[1] as FormData).has('client_message_id')).toBe(false)
      }
    })
  })

  describe('replyAudio', () => {
    it('should send audio as FormData with correct filename', async () => {
      const mockResponse = { data: { data: { message: { id: 'msg-1' } } } }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      const audioBlob = new Blob(['audio'], { type: 'audio/ogg' })
      await conversationsService.replyAudio('conv-1', audioBlob)

      expect(apiClient.post).toHaveBeenCalled()
      const call = vi.mocked(apiClient.post).mock.calls[0]
      expect(call[0]).toBe('/api/v1/panel/conversations/conv-1/reply/audio')
      expect(call[1]).toBeInstanceOf(FormData)
    })

    it('should handle MP3 audio', async () => {
      const mockResponse = { data: { data: { message: { id: 'msg-1' } } } }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      const audioBlob = new Blob(['audio'], { type: 'audio/mpeg' })
      await conversationsService.replyAudio('conv-1', audioBlob)

      const call = vi.mocked(apiClient.post).mock.calls[0]
      expect(call[0]).toBe('/api/v1/panel/conversations/conv-1/reply/audio')
    })
  })

  describe('assign', () => {
    it('should assign conversation to current advisor', async () => {
      const mockResponse = {
        data: {
          data: {
            escalation: { id: 'esc-1', advisor_id: 'adv-1', advisor_name: 'Ana' },
          },
        },
      }
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.assign('conv-1')

      expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1/assign')
      expect(result.escalation.advisor_id).toBe('adv-1')
    })

    it('should propagate assignment errors', async () => {
      const error = new Error('Already assigned')
      vi.mocked(apiClient.patch).mockRejectedValue(error)

      await expect(conversationsService.assign('conv-1')).rejects.toThrow('Already assigned')
    })
  })

  describe('returnToBot', () => {
    it('should return conversation to bot', async () => {
      const mockResponse = {
        data: { data: { conversation: { id: 'conv-1', bot_activo: true } } },
      }
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.returnToBot('conv-1')

      expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1/return-bot')
      expect(result.conversation.bot_activo).toBe(true)
    })
  })

  describe('close', () => {
    it('should close conversation with default params', async () => {
      const mockResponse = {
        data: { data: { conversation: { id: 'conv-1', status: 'cerrada' } } },
      }
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.close('conv-1')

      expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1/close', {})
      expect(result.conversation.status).toBe('cerrada')
    })

    it('should close conversation with custom data', async () => {
      const mockResponse = {
        data: { data: { conversation: { id: 'conv-1', status: 'cerrada' } } },
      }
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse as any)

      await conversationsService.close('conv-1', {
        resolution_type: 'resuelto',
        resolution_notes: 'All good',
        client_satisfied: 'si',
      })

      const call = vi.mocked(apiClient.patch).mock.calls[0]
      expect(call[1]).toEqual({
        resolution_type: 'resuelto',
        resolution_notes: 'All good',
        client_satisfied: 'si',
      })
    })
  })

  describe('transfer', () => {
    it('should transfer conversation to another advisor', async () => {
      const mockResponse = {
        data: {
          data: {
            escalation: {
              id: 'esc-1',
              advisor_id: 'adv-2',
              advisor_name: 'Carlos',
            },
          },
        },
      }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      const result = await conversationsService.transfer('conv-1', { target_advisor_id: 'adv-2' })

      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/panel/conversations/conv-1/transfer', {
        target_advisor_id: 'adv-2',
      })
      expect(result.escalation.advisor_id).toBe('adv-2')
    })

    it('should transfer with reason', async () => {
      const mockResponse = { data: { data: { escalation: { id: 'esc-1' } } } }
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse as any)

      await conversationsService.transfer('conv-1', {
        target_advisor_id: 'adv-2',
        reason: 'Specialist needed',
      })

      const call = vi.mocked(apiClient.post).mock.calls[0]
      expect(call[1]).toEqual({
        target_advisor_id: 'adv-2',
        reason: 'Specialist needed',
      })
    })
  })
})
