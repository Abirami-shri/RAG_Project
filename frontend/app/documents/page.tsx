"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { documentsApi } from "@/app/lib/api"
import DocumentCard from "@/app/components/DocumentCard"
import DocumentUpload from "@/app/components/DocumentUpload"
import { Upload, Loader2, Search, FileX } from "lucide-react"

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
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Library</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {docs.length} document{docs.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 rounded-lg"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        </div>

        {showUpload && (
          <div className="mb-6">
            <DocumentUpload onSuccess={() => setShowUpload(false)} />
          </div>
        )}

        {docs.length > 0 && (
          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search documents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">Loading documents…</span>
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-sm text-red-500">
              Failed to load documents. Is the backend running?
            </p>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileX className="w-12 h-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium mb-1">
              {search ? "No documents match your search" : "No documents yet"}
            </p>
            <p className="text-sm text-gray-400">
              {search
                ? "Try a different search term"
                : "Upload some documents to get started"}
            </p>
            {!search && (
              <button
                onClick={() => setShowUpload(true)}
                className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
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
