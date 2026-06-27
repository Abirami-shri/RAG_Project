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
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-400 to-rose-600 flex items-center justify-center shadow-md shadow-red-100">
        <FileText className="w-5 h-5 text-white" />
      </div>
    )
  if (type.includes("wordprocessing"))
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-md shadow-blue-100">
        <FileText className="w-5 h-5 text-white" />
      </div>
    )
  if (type === "text/markdown")
    return (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-300 to-indigo-400 flex items-center justify-center shadow-md shadow-indigo-100">
        <FileCode className="w-5 h-5 text-white" />
      </div>
    )
  return (
    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center shadow-md shadow-slate-100">
      <File className="w-5 h-5 text-white" />
    </div>
  )
}

function StatusBadge({ status }: { status: DocumentMeta["status"] }) {
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-green-400 to-emerald-500 text-white rounded-full shadow-sm">
        <CheckCircle className="w-3 h-3" /> Ready
      </span>
    )
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded-full shadow-sm">
        <Loader2 className="w-3 h-3 animate-spin" /> Processing
      </span>
    )
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-red-400 to-rose-500 text-white rounded-full shadow-sm">
        <AlertCircle className="w-3 h-3" /> Error
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-gradient-to-r from-slate-400 to-slate-500 text-white rounded-full shadow-sm">
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
    <div className="group bg-purple-50 border border-purple-200 rounded-2xl p-4 hover:shadow-lg hover:shadow-purple-200 hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start gap-3">
        <FileIcon type={doc.content_type} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate" title={doc.name}>
            {doc.name}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {formatBytes(doc.size_bytes)}
            {doc.chunk_count > 0 && (
              <span className="ml-1 text-indigo-400 font-medium">· {doc.chunk_count} chunks</span>
            )}
          </p>
          <div className="mt-2">
            <StatusBadge status={doc.status} />
          </div>
          {doc.error_message && (
            <p className="text-xs text-red-500 mt-1 truncate">{doc.error_message}</p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 shrink-0 opacity-0 group-hover:opacity-100"
          title="Delete document"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="text-xs text-slate-300 mt-3 font-medium">
        {new Date(doc.created_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </p>
    </div>
  )
}
