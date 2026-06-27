"use client"

import { useState, useRef, useCallback } from "react"
import { Upload, File, CheckCircle, XCircle, Loader2, AlertCircle, Trash2 } from "lucide-react"
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

      // Check for duplicates against existing library
      const { data: existing } = await documentsApi.list()
      const existingByName = new Map(existing.documents.map((d) => [d.name, d]))

      const newFiles: File[] = []
      const dupes: DocumentMeta[] = []

      for (const file of fileArr) {
        const match = existingByName.get(file.name)
        if (match) {
          dupes.push(match)
        } else {
          newFiles.push(file)
        }
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
                    update(itemId, {
                      status: meta.status,
                      error: meta.error_message ?? undefined,
                    })
                    queryClient.invalidateQueries({ queryKey: ["documents"] })
                    if (meta.status === "ready") onSuccess?.()
                    resolve()
                  }
                } catch {
                  clearInterval(poll)
                  resolve()
                }
              }, 3000)
            })
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : "Upload failed"
            update(itemId, { status: "error", error: message })
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
      } catch {
        // leave it in the list if delete fails
      } finally {
        setDeleting((prev) => {
          const next = new Set(prev)
          next.delete(doc.id)
          return next
        })
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
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors select-none ${
          dragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
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
        <Upload className="w-10 h-10 mx-auto text-gray-400 mb-3" />
        <p className="text-sm font-medium text-gray-700">
          Drop files here or click to upload
        </p>
        <p className="text-xs text-gray-500 mt-1">
          PDF, DOCX, TXT, MD — up to 50 MB
        </p>
      </div>

      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm font-medium text-amber-800">
              Already in storage — delete to re-upload
            </p>
          </div>
          <ul className="divide-y divide-amber-100">
            {duplicates.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5">
                <File className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 text-sm text-gray-700 truncate">
                  {doc.name}
                </span>
                <button
                  onClick={() => handleDelete(doc)}
                  disabled={deleting.has(doc.id)}
                  className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50 shrink-0"
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
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <File className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {u.name}
                </p>
                {u.status === "uploading" && (
                  <div className="mt-1.5 h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                )}
                {u.status === "processing" && (
                  <p className="text-xs text-amber-600 mt-0.5">Processing...</p>
                )}
                {u.status === "ready" && (
                  <p className="text-xs text-green-600 mt-0.5">Ready</p>
                )}
                {u.status === "error" && (
                  <p className="text-xs text-red-600 mt-0.5">
                    {u.error ?? "Upload failed"}
                  </p>
                )}
              </div>
              {(u.status === "uploading" || u.status === "processing") && (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
              )}
              {u.status === "ready" && (
                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
              )}
              {u.status === "error" && (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
