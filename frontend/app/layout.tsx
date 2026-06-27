import type { Metadata } from "next"
import { Geist } from "next/font/google"
import "./globals.css"
import Providers from "./providers"
import Navbar from "@/app/components/Navbar"
import Sidebar from "@/app/components/Sidebar"

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Ask your notes anything",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="h-full flex flex-col antialiased bg-gray-50">
        <Providers>
          <Navbar />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
