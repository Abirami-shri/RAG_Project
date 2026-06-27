"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, ChevronDown, Plus, Trash2 } from "lucide-react"
import { useChat } from "@/app/hooks/useChat"
import { useQuery } from "@tanstack/react-query"
import { documentsApi } from "@/app/lib/api"
import MessageBubble from "./MessageBubble"

export default function ChatInterface() {
  const [input, setInput] = useState("")
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [showDocPicker, setShowDocPicker] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data } = useQuery({
    queryKey: ["documents"],
    queryFn: () => documentsApi.list().then((r) => r.data),
  })

  const readyDocs = data?.documents.filter((d) => d.status === "ready") ?? []
  const { messages, streaming, send, clear } = useChat(
    selectedDocIds.length ? selectedDocIds : undefined
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || streaming) return
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    await send(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    )
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-rose-100 via-purple-100 to-indigo-200">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 text-white shrink-0">
        <h2 className="text-sm font-semibold">Chat</h2>
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center pb-16">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-400 via-purple-500 to-indigo-500 flex items-center justify-center mb-4 shadow-lg shadow-purple-100">
              <Send className="w-7 h-7 text-white" />
            </div>
            <p className="text-lg font-semibold text-slate-500 mb-1">
              Ask your notes anything
            </p>
            <p className="text-sm text-slate-400">
              {readyDocs.length > 0
                ? `${readyDocs.length} document${readyDocs.length !== 1 ? "s" : ""} ready to search`
                : "Upload documents in the Library to get started"}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            streaming={
              streaming &&
              i === messages.length - 1 &&
              msg.role === "assistant"
            }
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-purple-200 bg-purple-50 p-4">
        {/* Document scope selector */}
        {readyDocs.length > 0 && (
          <div className="mb-2 relative">
            <button
              onClick={() => setShowDocPicker(!showDocPicker)}
              className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg transition-colors"
            >
              <span>
                {selectedDocIds.length === 0
                  ? "All documents"
                  : `${selectedDocIds.length} document${selectedDocIds.length !== 1 ? "s" : ""} selected`}
              </span>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showDocPicker ? "rotate-180" : ""}`}
              />
            </button>

            {showDocPicker && (
              <div className="absolute bottom-full mb-2 left-0 bg-rose-50 border border-purple-200 rounded-xl shadow-xl shadow-purple-100 p-2 z-10 w-72 max-h-52 overflow-y-auto">
                <p className="text-xs text-slate-400 px-2 py-1 font-medium">
                  Leave all unchecked to search across all documents
                </p>
                {readyDocs.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-purple-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocIds.includes(doc.id)}
                      onChange={() => toggleDoc(doc.id)}
                      className="rounded accent-purple-600"
                    />
                    <span className="text-sm text-slate-700 truncate">
                      {doc.name}
                    </span>
                  </label>
                ))}
                {selectedDocIds.length > 0 && (
                  <button
                    onClick={() => setSelectedDocIds([])}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500 px-2 py-1.5 mt-1 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear selection
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              autoResize()
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents…"
            disabled={streaming}
            rows={1}
            className="flex-1 resize-none border border-purple-300 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent disabled:opacity-60 overflow-y-auto bg-rose-50 placeholder:text-purple-400"
            style={{ minHeight: "42px", maxHeight: "128px" }}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={streaming || !input.trim()}
            className="p-2.5 bg-gradient-to-br from-rose-400 via-purple-500 to-indigo-500 text-white rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0 shadow-md shadow-purple-100"
          >
            {streaming ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
