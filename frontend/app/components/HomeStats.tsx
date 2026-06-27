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
      <div className="relative overflow-hidden bg-gradient-to-br from-rose-400 to-pink-500 rounded-2xl p-5 text-white shadow-lg shadow-rose-200">
        <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/15 rounded-full" />
        <div className="absolute -bottom-6 -left-2 w-16 h-16 bg-white/15 rounded-full" />
        <div className="flex items-center gap-2 mb-3 relative">
          <div className="w-8 h-8 rounded-lg bg-white/25 flex items-center justify-center">
            <FileText className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold">Documents</span>
        </div>
        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-white/70" />
        ) : (
          <p className="text-3xl font-bold relative">{total}</p>
        )}
      </div>

      <div className="relative overflow-hidden bg-gradient-to-br from-indigo-400 to-blue-500 rounded-2xl p-5 text-white shadow-lg shadow-indigo-200">
        <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/15 rounded-full" />
        <div className="absolute -bottom-6 -left-2 w-16 h-16 bg-white/15 rounded-full" />
        <div className="flex items-center gap-2 mb-3 relative">
          <div className="w-8 h-8 rounded-lg bg-white/25 flex items-center justify-center">
            <Hash className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold">Chunks Indexed</span>
        </div>
        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-white/70" />
        ) : (
          <p className="text-3xl font-bold relative">{chunks.toLocaleString()}</p>
        )}
      </div>
    </div>
  )
}
