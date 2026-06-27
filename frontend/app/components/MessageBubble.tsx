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
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
          <Brain className="w-4 h-4 text-white" />
        </div>
      )}
      <div
        className={`max-w-[80%] flex flex-col ${isUser ? "items-end" : "items-start"}`}
      >
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-blue-600 text-white rounded-tr-sm"
              : "bg-gray-100 text-gray-900 rounded-tl-sm"
          }`}
        >
          {message.content}
          {streaming && !message.content && (
            <span className="inline-flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
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
