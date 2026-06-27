export type DocumentStatus = "uploading" | "processing" | "ready" | "error"

export interface DocumentMeta {
  id: string
  name: string
  content_type: string
  size_bytes: number
  status: DocumentStatus
  chunk_count: number
  created_at: string
  updated_at: string
  error_message?: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: ChatSource[]
}

export interface ChatSource {
  document_id: string
  document_name: string
  page_number?: number
  excerpt: string
}

export interface ChatRequest {
  message: string
  conversation_id: string
  document_ids?: string[]
  history: { role: "user" | "assistant"; content: string }[]
}

export type SSEEvent =
  | { type: "chunk"; content: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "done" }
  | { type: "error"; message: string }

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  document_ids: string[]
  created_at: string
}
