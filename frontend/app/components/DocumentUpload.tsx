"use client"

import { useState, useRef, useCallback } from "react"
import { File, CheckCircle, XCircle, Loader2, AlertCircle, Trash2, CloudUpload } from "lucide-react"
import { documentsApi } from "@/app/lib/api"
import { useQueryClient } from "@tanstack/react-query"
import type { DocumentMeta } from "@/app/lib/types"

interface UploadItem {
  id: string
  name: string
  progress: number
  status: "uploading" | "processing" | "ready" | "error"
  error?: string
}

export default function DocumentUpload({
  onSuccess,
}: {
  onSuccess?: () => void
}) {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [duplicates, setDuplicates] = useState<DocumentMeta[]>([])
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }, [])

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files)
      const { data: existing } = await documentsApi.list()
      const existingByName = new Map(existing.documents.map((d) => [d.name, d]))

      const newFiles: File[] = []
      const dupes: DocumentMeta[] = []

      for (const file of fileArr) {
        const match = existingByName.get(file.name)
        if (match) dupes.push(match)
        else newFiles.push(file)
      }

      if (dupes.length > 0) {
        setDuplicates((prev) => {
          const existing = new Set(prev.map((d) => d.id))
          return [...prev, ...dupes.filter((d) => !existing.has(d.id))]
        })
      }

      if (newFiles.length === 0) return

      const items: UploadItem[] = newFiles.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        progress: 0,
        status: "uploading" as const,
      }))

      setUploads((prev) => [...prev, ...items])

      await Promise.allSettled(
        newFiles.map(async (file, i) => {
          const itemId = items[i].id
          try {
            const { data } = await documentsApi.upload(file, (pct) => {
              update(itemId, { progress: pct })
            })
            update(itemId, { status: "processing", progress: 100 })
            await new Promise<void>((resolve) => {
              const poll = setInterval(async () => {
                try {
                  const { data: meta } = await documentsApi.get(data.id)
                  if (meta.status === "ready" || meta.status === "error") {
                    clearInterval(poll)
                    update(itemId, { status: meta.status, error: meta.error_message ?? undefined })
                    queryClient.invalidateQueries({ queryKey: ["documents"] })
                    if (meta.status === "ready") onSuccess?.()
                    resolve()
                  }
                } catch { clearInterval(poll); resolve() }
              }, 3000)
            })
          } catch (err: unknown) {
            update(itemId, { status: "error", error: err instanceof Error ? err.message : "Upload failed" })
          }
        })
      )
    },
    [update, queryClient, onSuccess]
  )

  const handleDelete = useCallback(
    async (doc: DocumentMeta) => {
      setDeleting((prev) => new Set(prev).add(doc.id))
      try {
        await documentsApi.delete(doc.id)
        setDuplicates((prev) => prev.filter((d) => d.id !== doc.id))
        queryClient.invalidateQueries({ queryKey: ["documents"] })
      } catch { /* leave in list */ } finally {
        setDeleting((prev) => { const next = new Set(prev); next.delete(doc.id); return next })
      }
    },
    [queryClient]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  return (
    <div className="space-y-3">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all select-none overflow-hidden ${
          dragging
            ? "border-purple-500 bg-purple-100 scale-[1.01]"
            : "border-purple-300 hover:border-purple-400 hover:bg-purple-100/70 bg-purple-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="relative">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-rose-400 via-purple-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-200">
            <CloudUpload className="w-8 h-8 text-white" />
          </div>
          <p className="text-sm font-semibold text-slate-700">
            Drop files here or click to upload
          </p>
          <p className="text-xs text-slate-400 mt-1">
            PDF, DOCX, TXT, MD — up to 50 MB
          </p>
        </div>
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 overflow-hidden shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-100/50">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              Already in storage — delete to re-upload
            </p>
          </div>
          <ul className="divide-y divide-amber-100">
            {duplicates.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <File className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 text-sm text-slate-700 truncate font-medium">{doc.name}</span>
                <button
                  onClick={() => handleDelete(doc)}
                  disabled={deleting.has(doc.id)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {deleting.has(doc.id) ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div
              key={u.id}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                u.status === "ready"
                  ? "bg-emerald-50/80 border-emerald-200"
                  : u.status === "error"
                  ? "bg-red-50/80 border-red-200"
                  : "bg-purple-100 border-purple-200"
              }`}
            >
              <File className={`w-4 h-4 shrink-0 ${
                u.status === "ready" ? "text-green-500" :
                u.status === "error" ? "text-red-400" : "text-purple-400"
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{u.name}</p>
                {u.status === "uploading" && (
                  <div className="mt-1.5 h-1.5 bg-purple-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 transition-all duration-300"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                )}
                {u.status === "processing" && (
                  <p className="text-xs text-amber-600 mt-0.5 font-medium">Processing...</p>
                )}
                {u.status === "ready" && (
                  <p className="text-xs text-green-600 mt-0.5 font-medium">Ready</p>
                )}
                {u.status === "error" && (
                  <p className="text-xs text-red-600 mt-0.5">{u.error ?? "Upload failed"}</p>
                )}
              </div>
              {(u.status === "uploading" || u.status === "processing") && (
                <Loader2 className="w-4 h-4 text-purple-500 animate-spin shrink-0" />
              )}
              {u.status === "ready" && (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              )}
              {u.status === "error" && (
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
