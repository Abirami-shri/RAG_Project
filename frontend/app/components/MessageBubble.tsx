import type { ChatMessage } from "@/app/lib/types"
import SourceCitation from "./SourceCitation"
import { Brain } from "lucide-react"

interface Props {
  message: ChatMessage
  streaming?: boolean
}

export default function MessageBubble({ message, streaming }: Props) {
  const isUser = message.role === "user"

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-rose-400 via-purple-500 to-indigo-500 flex items-center justify-center shrink-0 mt-0.5 shadow-md shadow-purple-200">
          <Brain className="w-4 h-4 text-white" />
        </div>
      )}
      <div className={`max-w-[80%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
            isUser
              ? "bg-gradient-to-br from-rose-400 via-purple-500 to-indigo-500 text-white rounded-tr-sm"
              : "bg-purple-100 text-slate-700 rounded-tl-sm border border-purple-200"
          }`}
        >
          {message.content}
          {streaming && !message.content && (
            <span className="inline-flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" />
            </span>
          )}
          {streaming && message.content && (
            <span className="inline-block w-0.5 h-3.5 bg-current animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="w-full">
            <SourceCitation sources={message.sources} />
          </div>
        )}
      </div>
    </div>
  )
}
