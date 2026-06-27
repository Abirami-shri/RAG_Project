import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import ChatInterface from "@/app/components/ChatInterface"
import * as api from "@/app/lib/api"

vi.mock("@/app/lib/api")

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

async function* mockStream() {
  yield { type: "chunk" as const, content: "Transformers" }
  yield { type: "chunk" as const, content: " use attention." }
  yield {
    type: "sources" as const,
    sources: [
      { document_id: "d1", document_name: "paper.pdf", page_number: 3, excerpt: "..." },
    ],
  }
  yield { type: "done" as const }
}

describe("ChatInterface", () => {
  beforeEach(() => {
    vi.mocked(api.documentsApi.list).mockResolvedValue({
      data: { documents: [], total: 0 },
    } as any)
    vi.mocked(api.streamChat).mockReturnValue(mockStream())
  })

  it("renders the message input", () => {
    render(<ChatInterface />, { wrapper })
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("renders the send button", () => {
    render(<ChatInterface />, { wrapper })
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
  })

  it("send button is disabled when input is empty", () => {
    render(<ChatInterface />, { wrapper })
    const btn = screen.getByRole("button", { name: /send/i })
    expect(btn).toBeDisabled()
  })

  it("send button is enabled when input has text", async () => {
    render(<ChatInterface />, { wrapper })
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "What is attention?" } })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled()
    })
  })

  it("shows the user message in the thread after sending", async () => {
    render(<ChatInterface />, { wrapper })
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "What is attention?" } })
    fireEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => {
      expect(screen.getByText("What is attention?")).toBeInTheDocument()
    })
  })

  it("streams the assistant response into the thread", async () => {
    render(<ChatInterface />, { wrapper })
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "What is attention?" } })
    fireEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => {
      expect(screen.getByText(/Transformers use attention\./)).toBeInTheDocument()
    })
  })

  it("clears input after sending", async () => {
    render(<ChatInterface />, { wrapper })
    const input = screen.getByRole("textbox") as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "Hello" } })
    fireEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => {
      expect(input.value).toBe("")
    })
  })

  it("disables input while streaming", async () => {
    // Stream that never completes
    vi.mocked(api.streamChat).mockReturnValue(
      (async function* () {
        yield { type: "chunk" as const, content: "..." }
        await new Promise(() => {}) // hang
      })()
    )

    render(<ChatInterface />, { wrapper })
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "Hello" } })
    fireEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeDisabled()
    })
  })
})
