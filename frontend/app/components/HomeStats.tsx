"use client"

import { useQuery } from "@tanstack/react-query"
import { documentsApi } from "@/app/lib/api"
import { FileText, Hash, Loader2 } from "lucide-react"

export default function HomeStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => documentsApi.list().then((r) => r.data),
  })

  const total = data?.total ?? 0
  const chunks =
    data?.documents.reduce((sum, d) => sum + (d.chunk_count ?? 0), 0) ?? 0

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 text-gray-500 mb-2">
          <FileText className="w-4 h-4" />
          <span className="text-sm">Documents</span>
        </div>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
        ) : (
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 text-gray-500 mb-2">
          <Hash className="w-4 h-4" />
          <span className="text-sm">Chunks Indexed</span>
        </div>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
        ) : (
          <p className="text-2xl font-bold text-gray-900">
            {chunks.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}
