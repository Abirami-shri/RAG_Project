import { Brain, Settings } from "lucide-react"
import Link from "next/link"

export default function Navbar() {
  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center px-4 shrink-0 z-10">
      <Link
        href="/"
        className="flex items-center gap-2 font-semibold text-gray-900 hover:text-blue-600 transition-colors"
      >
        <Brain className="w-5 h-5 text-blue-600" />
        <span>Second Brain</span>
      </Link>
      <div className="ml-auto">
        <button className="p-2 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  )
}
