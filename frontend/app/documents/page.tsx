"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { documentsApi } from "@/app/lib/api"
import DocumentCard from "@/app/components/DocumentCard"
import DocumentUpload from "@/app/components/DocumentUpload"
import { Upload, Loader2, Search, FileX, BookOpen } from "lucide-react"

export default function DocumentsPage() {
  const [showUpload, setShowUpload] = useState(false)
  const [search, setSearch] = useState("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["documents"],
    queryFn: () => documentsApi.list().then((r) => r.data),
    refetchInterval: (query) => {
      const docs = query.state.data?.documents ?? []
      const hasProcessing = docs.some(
        (d) => d.status === "processing" || d.status === "uploading"
      )
      return hasProcessing ? 5000 : false
    },
  })

  const docs = data?.documents ?? []
  const filtered = docs.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-br from-rose-100 via-purple-100 to-indigo-200">
      <div className="bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 px-6 py-8 text-white">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/25 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Library</h1>
              <p className="text-purple-100 text-sm">
                {docs.length} document{docs.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-2 text-sm font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors px-4 py-2.5 rounded-xl shadow-md"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {showUpload && (
          <div className="bg-rose-50 rounded-2xl p-5 shadow-sm border border-purple-200">
            <DocumentUpload onSuccess={() => setShowUpload(false)} />
          </div>
        )}

        {docs.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-500" />
            <input
              type="text"
              placeholder="Search documents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-purple-50 border border-purple-300 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent shadow-sm placeholder:text-purple-400"
            />
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2 text-purple-500" />
            <span className="text-sm">Loading documents…</span>
          </div>
        )}

        {error && (
          <div className="text-center py-16 bg-red-50 rounded-2xl border border-red-200">
            <p className="text-sm text-red-600 font-medium">
              Failed to load documents. Is the backend running?
            </p>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-purple-50 rounded-2xl border border-purple-200 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-200 to-indigo-200 flex items-center justify-center mb-4">
              <FileX className="w-8 h-8 text-purple-500" />
            </div>
            <p className="text-slate-700 font-semibold mb-1">
              {search ? "No documents match your search" : "No documents yet"}
            </p>
            <p className="text-sm text-slate-500">
              {search ? "Try a different search term" : "Upload some documents to get started"}
            </p>
            {!search && (
              <button
                onClick={() => setShowUpload(true)}
                className="mt-4 text-sm font-semibold text-white bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 hover:opacity-90 px-5 py-2 rounded-xl shadow-md transition-opacity"
              >
                Upload your first document
              </button>
            )}
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
