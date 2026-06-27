"use client"

import { useState, useCallback, useRef } from "react"
import { streamChat } from "@/app/lib/api"
import type { ChatMessage } from "@/app/lib/types"

export function useChat(documentIds?: string[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const convId = useRef(crypto.randomUUID())

  const send = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      }
      setMessages((prev) => [...prev, userMsg])
      setStreaming(true)

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        sources: [],
      }
      setMessages((prev) => [...prev, assistantMsg])

      try {
        for await (const event of streamChat({
          message: text,
          conversation_id: convId.current,
          document_ids: documentIds,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if (event.type === "chunk") {
            setMessages((prev) => {
              const updated = [...prev]
              const last = { ...updated[updated.length - 1] }
              last.content += event.content
              updated[updated.length - 1] = last
              return updated
            })
          } else if (event.type === "sources") {
            setMessages((prev) => {
              const updated = [...prev]
              const last = { ...updated[updated.length - 1] }
              last.sources = event.sources
              updated[updated.length - 1] = last
              return updated
            })
          } else if (event.type === "error") {
            setMessages((prev) => {
              const updated = [...prev]
              const last = { ...updated[updated.length - 1] }
              last.content = `Error: ${event.message}`
              updated[updated.length - 1] = last
              return updated
            })
          }
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev]
          const last = { ...updated[updated.length - 1] }
          last.content =
            last.content || "Something went wrong. Please try again."
          updated[updated.length - 1] = last
          return updated
        })
      } finally {
        setStreaming(false)
      }
    },
    [messages, documentIds]
  )

  const clear = useCallback(() => {
    setMessages([])
    convId.current = crypto.randomUUID()
  }, [])

  return { messages, streaming, send, clear, conversationId: convId.current }
}
