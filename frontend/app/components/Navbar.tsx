import { Brain, Settings } from "lucide-react"
import Link from "next/link"

export default function Navbar() {
  return (
    <header className="h-14 bg-gradient-to-r from-rose-400 via-purple-500 to-indigo-500 flex items-center px-4 shrink-0 z-10 shadow-md">
      <Link
        href="/"
        className="flex items-center gap-2 font-bold text-white hover:opacity-80 transition-opacity"
      >
        <div className="w-8 h-8 rounded-lg bg-white/25 flex items-center justify-center">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <span className="text-lg tracking-tight">Second Brain</span>
      </Link>
      <div className="ml-auto">
        <button className="p-2 rounded-md text-white/80 hover:text-white hover:bg-white/20 transition-colors">
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  )
}
