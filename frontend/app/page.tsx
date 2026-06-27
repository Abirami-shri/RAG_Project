import Link from "next/link"
import { MessageSquare, Zap } from "lucide-react"
import DocumentUpload from "@/app/components/DocumentUpload"
import HomeStats from "@/app/components/HomeStats"

export default function HomePage() {
  return (
    <div className="flex-1 overflow-auto bg-gradient-to-br from-rose-100 via-purple-100 to-indigo-200">
      <div className="relative overflow-hidden bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 px-6 py-12 text-white">
        <div className="relative max-w-2xl mx-auto">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">Welcome to Second Brain</h1>
          <p className="text-white/90 text-base">
            Upload your documents and ask them anything — powered by Azure AI.
          </p>
        </div>
        <div className="absolute -top-8 -right-8 w-48 h-48 bg-white/10 rounded-full" />
        <div className="absolute -bottom-12 left-1/3 w-32 h-32 bg-white/10 rounded-full" />
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <HomeStats />

        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-rose-400 to-purple-500 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <h2 className="text-xs font-bold text-purple-700 uppercase tracking-wider">
              Upload Documents
            </h2>
          </div>
          <DocumentUpload />
        </div>

        <div className="relative overflow-hidden bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 rounded-2xl p-6 text-white shadow-lg shadow-purple-200">
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full" />
          <div className="absolute -bottom-8 left-12 w-24 h-24 bg-white/10 rounded-full" />
          <p className="text-base font-semibold mb-1 relative">Ready to explore your knowledge base?</p>
          <p className="text-white/90 text-sm mb-4 relative">
            Ask questions, get instant grounded answers with citations.
          </p>
          <Link
            href="/chat"
            className="relative inline-flex items-center gap-2 text-sm font-semibold text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors px-5 py-2.5 rounded-xl shadow-md"
          >
            <MessageSquare className="w-4 h-4" />
            Start chatting
          </Link>
        </div>
      </div>
    </div>
  )
}
