import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import DocumentUpload from "@/app/components/DocumentUpload"
import * as api from "@/app/lib/api"

vi.mock("@/app/lib/api")

const mockDocumentMeta = (overrides = {}) => ({
  id: "doc-1",
  name: "notes.txt",
  content_type: "text/plain",
  size_bytes: 100,
  status: "ready" as const,
  chunk_count: 2,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("DocumentUpload", () => {
  beforeEach(() => {
    vi.mocked(api.documentsApi.list).mockResolvedValue({
      data: { documents: [], total: 0 },
    } as any)
    vi.mocked(api.documentsApi.upload).mockResolvedValue({
      data: mockDocumentMeta({ status: "uploading" }),
    } as any)
    vi.mocked(api.documentsApi.get).mockResolvedValue({
      data: mockDocumentMeta({ status: "ready" }),
    } as any)
  })

  it("renders the drop zone", () => {
    render(<DocumentUpload />, { wrapper })
    expect(screen.getByText(/drop files here/i)).toBeInTheDocument()
  })

  it("shows accepted file types hint", () => {
    render(<DocumentUpload />, { wrapper })
    expect(screen.getByText(/PDF, DOCX, TXT, MD/i)).toBeInTheDocument()
  })

  it("shows duplicate warning when file already exists in library", async () => {
    vi.mocked(api.documentsApi.list).mockResolvedValue({
      data: { documents: [mockDocumentMeta({ name: "notes.txt" })], total: 1 },
    } as any)

    render(<DocumentUpload />, { wrapper })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["content"], "notes.txt", { type: "text/plain" })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/already in storage/i)).toBeInTheDocument()
    })
  })

  it("shows the duplicate filename in the warning panel", async () => {
    vi.mocked(api.documentsApi.list).mockResolvedValue({
      data: { documents: [mockDocumentMeta({ name: "notes.txt" })], total: 1 },
    } as any)

    render(<DocumentUpload />, { wrapper })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } })

    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeInTheDocument()
    })
  })

  it("does not upload a duplicate file", async () => {
    vi.mocked(api.documentsApi.list).mockResolvedValue({
      data: { documents: [mockDocumentMeta({ name: "notes.txt" })], total: 1 },
    } as any)

    render(<DocumentUpload />, { wrapper })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } })

    await waitFor(() => screen.getByText(/already in storage/i))
    expect(api.documentsApi.upload).not.toHaveBeenCalled()
  })

  it("shows a Delete button for each duplicate", async () => {
    vi.mocked(api.documentsApi.list).mockResolvedValue({
      data: { documents: [mockDocumentMeta({ name: "notes.txt" })], total: 1 },
    } as any)

    render(<DocumentUpload />, { wrapper })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument()
    })
  })

  it("uploads a new (non-duplicate) file", async () => {
    render(<DocumentUpload />, { wrapper })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["hello"], "new.txt", { type: "text/plain" })] } })

    await waitFor(() => {
      expect(api.documentsApi.upload).toHaveBeenCalledOnce()
    })
  })

  it("shows upload progress bar while uploading", async () => {
    vi.mocked(api.documentsApi.upload).mockImplementation((_file, onProgress) => {
      onProgress?.(50)
      return new Promise(() => {}) as any // never resolves — stays in uploading state
    })

    render(<DocumentUpload />, { wrapper })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["x"], "new.txt", { type: "text/plain" })] } })

    await waitFor(() => {
      const bar = document.querySelector('[style*="width: 50%"]')
      expect(bar).toBeTruthy()
    })
  })
})
