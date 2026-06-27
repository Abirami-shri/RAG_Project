"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, FileText } from "lucide-react"
import type { ChatSource } from "@/app/lib/types"

export default function SourceCitation({ sources }: { sources: ChatSource[] }) {
  const [open, setOpen] = useState(false)

  if (!sources.length) return null

  return (
    <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden text-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <span className="font-medium text-xs">
          {sources.length} source{sources.length > 1 ? "s" : ""}
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
      </button>
      {open && (
        <div className="divide-y divide-gray-100">
          {sources.map((s, i) => (
            <div key={i} className="px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-gray-700 font-medium text-xs mb-1">
                <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="truncate">{s.document_name}</span>
                {s.page_number && (
                  <span className="text-gray-400 shrink-0">p.{s.page_number}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">
                {s.excerpt}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
