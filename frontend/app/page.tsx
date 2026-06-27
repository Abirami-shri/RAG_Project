import Link from "next/link"
import { MessageSquare } from "lucide-react"
import DocumentUpload from "@/app/components/DocumentUpload"
import HomeStats from "@/app/components/HomeStats"

export default function HomePage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Welcome to Second Brain</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload your documents and ask them anything.
          </p>
        </div>

        <div className="mb-8">
          <HomeStats />
        </div>

        <div className="mb-8">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Upload Documents
          </h2>
          <DocumentUpload />
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
          <p className="text-sm font-medium text-blue-900 mb-3">
            Ready to explore your knowledge base?
          </p>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 rounded-lg"
          >
            <MessageSquare className="w-4 h-4" />
            Start chatting
          </Link>
        </div>
      </div>
    </div>
  )
}
