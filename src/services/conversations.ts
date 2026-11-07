import apiClient from '../lib/axios'
import { withSignal } from './requestConfig'
import type { PaginatedConversations, PaginatedMessages, Message, Conversation, ConversationStatus } from '../types'

type ConversationListParams = { status?: string; channel?: string; agent?: string; limit?: number; offset?: number }
type PaginationParams = { limit?: number; offset?: number }
type CloseConversationData = { resolution_type?: string; resolution_notes?: string | null; client_satisfied?: string }
type AssignResponse = { escalation: { id: string; advisor_id: string; advisor_name: string } }
type ReturnToBotResponse = { conversation: Conversation }
type TakeControlResponse = {
  conversation: { id: string; bot_activo: boolean; status: ConversationStatus }
  escalation: { id: string; advisor_id: string; advisor_name: string }
}
type ReopenResponse = {
  conversation: { id: string; bot_activo: boolean; status: ConversationStatus; case_number: string | null }
  escalation: { id: string; advisor_id: string; advisor_name: string; reason: string }
}
type CloseResponse = { conversation: Conversation }
type TransferResponse = {
  escalation: { id: string; advisor_id: string; advisor_name: string; transfer_reason?: string | null }
}

export const conversationsService = {

  async list(params?: ConversationListParams, signal?: AbortSignal): Promise<PaginatedConversations> {
    const { data } = await apiClient.get('/api/v1/panel/conversations/', withSignal({ params }, signal))
    return data.data
  },

  async getById(id: string, limit = 50, signal?: AbortSignal): Promise<{ conversation: Conversation; messages: Message[]; total_messages: number }> {
    const { data } = await apiClient.get(`/api/v1/panel/conversations/${id}`, withSignal({
      params: { limit, offset: 0 },
    }, signal))
    const conversation = data.data.conversation
    return {
      conversation,
      messages: conversation.messages || [],
      total_messages: conversation.total_messages || 0,
    }
  },

  async getMessages(id: string, params?: PaginationParams, signal?: AbortSignal): Promise<PaginatedMessages> {
    const { data } = await apiClient.get(`/api/v1/panel/conversations/${id}/messages`, withSignal({ params }, signal))
    return data.data
  },

  // `clientMessageId` (a UUID generated once per message) makes a retry idempotent:
  // the backend returns the already-sent message instead of sending it again.
  async replyText(id: string, text: string, clientMessageId?: string): Promise<{ message: Message }> {
    const body = clientMessageId ? { text, client_message_id: clientMessageId } : { text }
    const { data } = await apiClient.post(`/api/v1/panel/conversations/${id}/reply`, body)
    return data.data
  },

  async replyMedia(
    id: string,
    file: File,
    caption?: string,
    clientMessageId?: string,
  ): Promise<{ message: Message }> {
    const formData = new FormData()
    formData.append('file', file)
    if (caption) {
      formData.append('caption', caption)
    }
    if (clientMessageId) {
      formData.append('client_message_id', clientMessageId)
    }
    const { data } = await apiClient.post(`/api/v1/panel/conversations/${id}/reply/media`, formData)
    return data.data
  },

  async replyAudio(id: string, file: Blob, clientMessageId?: string): Promise<{ message: Message }> {
    const formData = new FormData()
    
    let audioFile = file
    let filename = 'voice_note.ogg'
    
    if (file.type.includes('mpeg') || file.type.includes('mp3')) {
      filename = 'voice_note.mp3'
      audioFile = new Blob([file], { type: 'audio/mpeg' })
    } else if (file.type.includes('mp4')) {
      filename = 'voice_note.mp4'
      audioFile = new Blob([file], { type: 'audio/mp4' })
    } else if (file.type.includes('ogg')) {
      filename = 'voice_note.ogg'
      audioFile = new Blob([file], { type: 'audio/ogg' })
    }

    formData.append('file', audioFile, filename)
    if (clientMessageId) {
      formData.append('client_message_id', clientMessageId)
    }
    const { data } = await apiClient.post(`/api/v1/panel/conversations/${id}/reply/audio`, formData)
    return data.data
  },

  async assign(id: string): Promise<AssignResponse> {
    const { data } = await apiClient.patch(`/api/v1/panel/conversations/${id}/assign`)
    return data.data
  },

  async returnToBot(id: string): Promise<ReturnToBotResponse> {
    const { data } = await apiClient.patch(`/api/v1/panel/conversations/${id}/return-bot`)
    return data.data
  },

  async takeControl(id: string): Promise<TakeControlResponse> {
    const { data } = await apiClient.patch(`/api/v1/panel/conversations/${id}/take-control`)
    return data.data
  },

  async reopen(id: string): Promise<ReopenResponse> {
    const { data } = await apiClient.patch(`/api/v1/panel/conversations/${id}/reopen`)
    return data.data
  },

  async close(id: string, body?: CloseConversationData): Promise<CloseResponse> {
    const { data } = await apiClient.patch(`/api/v1/panel/conversations/${id}/close`, body ?? {})
    return data.data
  },

  async markAsSeen(conversationId: string): Promise<{ unread_count: number }> {
    const { data } = await apiClient.patch(`/api/v1/panel/conversations/${conversationId}/seen`)
    return data.data
  },

  async transfer(id: string, body: { target_advisor_id: string; reason?: string | null }): Promise<TransferResponse> {
    const { data } = await apiClient.post(`/api/v1/panel/conversations/${id}/transfer`, body)
    return data.data
  },
}
