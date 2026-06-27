"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, BookOpen, MessageSquare } from "lucide-react"

const nav = [
  { href: "/", label: "Home", icon: Home, color: "from-rose-400 to-pink-500" },
  { href: "/documents", label: "Library", icon: BookOpen, color: "from-purple-400 to-indigo-500" },
  { href: "/chat", label: "Chat", icon: MessageSquare, color: "from-indigo-400 to-blue-500" },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-52 bg-gradient-to-b from-rose-200 via-purple-200 to-indigo-300 border-r border-purple-300 flex flex-col shrink-0 shadow-sm">
      <nav className="p-3 space-y-1 mt-2">
        {nav.map(({ href, label, icon: Icon, color }) => {
          const active =
            pathname === href ||
            (href !== "/" && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? `bg-gradient-to-r ${color} text-white shadow-md`
                  : "text-purple-800 hover:bg-purple-300/50 hover:text-purple-900"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
