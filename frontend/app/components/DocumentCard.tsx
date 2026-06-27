"use client"

import { useState } from "react"
import {
  FileText,
  File,
  FileCode,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
} from "lucide-react"
import { documentsApi } from "@/app/lib/api"
import { useQueryClient } from "@tanstack/react-query"
import type { DocumentMeta } from "@/app/lib/types"

function FileIcon({ type }: { type: string }) {
  if (type === "application/pdf")
    return <FileText className="w-8 h-8 text-red-500" />
  if (type.includes("wordprocessing"))
    return <FileText className="w-8 h-8 text-blue-500" />
  if (type === "text/markdown")
    return <FileCode className="w-8 h-8 text-purple-500" />
  return <File className="w-8 h-8 text-gray-400" />
}

function StatusBadge({ status }: { status: DocumentMeta["status"] }) {
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
        <CheckCircle className="w-3 h-3" /> Ready
      </span>
    )
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
        <Loader2 className="w-3 h-3 animate-spin" /> Processing
      </span>
    )
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
        <AlertCircle className="w-3 h-3" /> Error
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
      <Clock className="w-3 h-3" /> Uploading
    </span>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentCard({ doc }: { doc: DocumentMeta }) {
  const [deleting, setDeleting] = useState(false)
  const queryClient = useQueryClient()

  const handleDelete = async () => {
    if (!confirm(`Delete "${doc.name}"?`)) return
    setDeleting(true)
    try {
      await documentsApi.delete(doc.id)
      queryClient.invalidateQueries({ queryKey: ["documents"] })
    } catch {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <FileIcon type={doc.content_type} />
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium text-gray-900 truncate"
            title={doc.name}
          >
            {doc.name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatBytes(doc.size_bytes)}
            {doc.chunk_count > 0 && ` · ${doc.chunk_count} chunks`}
          </p>
          <div className="mt-2">
            <StatusBadge status={doc.status} />
          </div>
          {doc.error_message && (
            <p className="text-xs text-red-500 mt-1 truncate">
              {doc.error_message}
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 shrink-0"
          title="Delete document"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-3">
        {new Date(doc.created_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </p>
    </div>
  )
}
