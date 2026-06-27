import axios from "axios"
import type { DocumentMeta, ChatRequest, SSEEvent } from "./types"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001"

const api = axios.create({ baseURL: BASE_URL })

export const documentsApi = {
  upload: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append("file", file)
    return api.post<DocumentMeta>("/api/documents/upload", form, {
      onUploadProgress: (e) =>
        onProgress?.(Math.round((e.loaded / (e.total ?? 1)) * 100)),
    })
  },
  list: () =>
    api.get<{ documents: DocumentMeta[]; total: number }>("/api/documents"),
  get: (id: string) => api.get<DocumentMeta>(`/api/documents/${id}`),
  delete: (id: string) => api.delete(`/api/documents/${id}`),
}

export async function* streamChat(
  request: ChatRequest
): AsyncGenerator<SSEEvent> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`Chat error: ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          yield JSON.parse(line.slice(6)) as SSEEvent
        } catch {
          // skip malformed events
        }
      }
    }
  }
}
