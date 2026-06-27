# Testing — Second Brain

---

## 1. Testing Philosophy

Tests exist to catch regressions and document intent — not to reach an arbitrary number. Every test should be able to fail for a reason that matters. The RAG pipeline has distinct, testable stages; each stage is tested independently before integration tests confirm they compose correctly.

**Priorities (highest to lowest):**
1. RAG pipeline correctness — wrong answers are the worst failure mode
2. Upload ingestion reliability — silent data loss is invisible to users
3. API contract stability — frontend must not break on backend changes
4. UI critical paths — upload and chat flows must always work

---

## 2. Test Pyramid

```
        ┌─────────────┐
        │   E2E (10%) │   Playwright — full browser flows
        ├─────────────┤
        │  Integ (30%)│   pytest — real Azure services (dev index)
        ├─────────────┤
        │  Unit  (60%)│   pytest / Vitest — mocked dependencies
        └─────────────┘
```

---

## 3. Backend Tests (Python / pytest)

### 3.1 Setup

```
backend/
└── tests/
    ├── conftest.py           # shared fixtures
    ├── unit/
    │   ├── test_chunker.py
    │   ├── test_processor.py
    │   └── test_chat_prompt.py
    ├── integration/
    │   ├── test_storage.py
    │   ├── test_search.py
    │   └── test_rag_pipeline.py
    └── api/
        ├── test_documents_api.py
        └── test_chat_api.py
```

**Install:**
```bash
pip install pytest pytest-asyncio pytest-cov httpx
```

**Run:**
```bash
pytest tests/unit -v                    # unit only
pytest tests/ -v --cov=app --cov-report=term-missing
```

---

### 3.2 Unit Tests

#### `test_chunker.py` — `ProcessorService.chunk_text()`

```python
def test_chunks_respect_size_limit():
    text = "word " * 500            # 2500 chars
    chunks = chunk_text(text, size=1000, overlap=200)
    assert all(len(c) <= 1000 for c in chunks)

def test_overlap_carries_content():
    text = "A " * 300 + "B " * 300
    chunks = chunk_text(text, size=300, overlap=100)
    assert any("A" in c and "B" in c for c in chunks)

def test_empty_text_returns_empty_list():
    assert chunk_text("", size=1000, overlap=200) == []

def test_short_text_returns_single_chunk():
    text = "hello world"
    chunks = chunk_text(text, size=1000, overlap=200)
    assert chunks == ["hello world"]

def test_splits_prefer_paragraph_breaks():
    text = "Para one.\n\nPara two.\n\nPara three."
    chunks = chunk_text(text, size=20, overlap=0)
    assert "Para one." in chunks[0]
```

#### `test_processor.py` — text extraction

```python
def test_extract_pdf_returns_text(sample_pdf_bytes):
    text = extract_text(sample_pdf_bytes, content_type="application/pdf")
    assert len(text) > 0
    assert isinstance(text, str)

def test_extract_txt_returns_content():
    content = b"Hello, world."
    text = extract_text(content, content_type="text/plain")
    assert text == "Hello, world."

def test_unsupported_type_raises():
    with pytest.raises(ValueError, match="Unsupported"):
        extract_text(b"...", content_type="image/gif")
```

#### `test_chat_prompt.py` — prompt builder

```python
def test_prompt_includes_all_chunks(sample_chunks):
    prompt = build_system_prompt(sample_chunks)
    for chunk in sample_chunks:
        assert chunk["content"] in prompt

def test_prompt_includes_source_labels(sample_chunks):
    prompt = build_system_prompt(sample_chunks)
    assert sample_chunks[0]["document_name"] in prompt

def test_empty_chunks_triggers_no_context_message():
    prompt = build_system_prompt([])
    assert "no relevant" in prompt.lower()
```

---

### 3.3 API Tests (FastAPI TestClient)

```python
# test_documents_api.py
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

def test_upload_returns_202(client, mock_storage, mock_processor, mock_search):
    with open("tests/fixtures/sample.pdf", "rb") as f:
        response = client.post("/api/documents/upload", files={"file": f})
    assert response.status_code == 202
    assert response.json()["status"] == "processing"

def test_upload_rejects_oversized_file(client):
    big_file = b"x" * (51 * 1024 * 1024)   # 51 MB
    response = client.post("/api/documents/upload",
                           files={"file": ("big.txt", big_file, "text/plain")})
    assert response.status_code == 413

def test_list_documents_empty(client, mock_storage_empty):
    response = client.get("/api/documents")
    assert response.status_code == 200
    assert response.json()["documents"] == []

def test_delete_nonexistent_returns_404(client, mock_storage_not_found):
    response = client.delete("/api/documents/nonexistent-id")
    assert response.status_code == 404
```

```python
# test_chat_api.py
def test_chat_streams_sse(client, mock_rag_pipeline):
    response = client.post("/api/chat",
                           json={"message": "What is X?", "conversation_id": "abc"},
                           headers={"Accept": "text/event-stream"})
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

def test_chat_empty_message_rejected(client):
    response = client.post("/api/chat", json={"message": "", "conversation_id": "abc"})
    assert response.status_code == 422
```

---

### 3.4 Integration Tests

These hit **real Azure services** in a dedicated `test` environment (separate index, separate blob container).

```python
# conftest.py — integration marker
@pytest.fixture(scope="session")
def azure_search_client():
    # Reads AZURE_SEARCH_ENDPOINT_TEST etc from env
    return SearchService(index_name="second-brain-test")

# test_search.py
@pytest.mark.integration
async def test_upsert_and_query(azure_search_client, sample_chunks):
    await azure_search_client.upsert_chunks(sample_chunks)
    await asyncio.sleep(2)  # index propagation
    results = await azure_search_client.search("transformer attention")
    assert len(results) > 0
    assert any("transformer" in r["content"].lower() for r in results)

@pytest.mark.integration
async def test_delete_removes_chunks(azure_search_client, indexed_document):
    await azure_search_client.delete_document_chunks(indexed_document["id"])
    await asyncio.sleep(2)
    results = await azure_search_client.search(indexed_document["sample_query"])
    assert len(results) == 0
```

**Run integration tests:**
```bash
pytest tests/integration -v -m integration --azure-live
```

Guard with a pytest marker so CI can skip them unless explicitly opted in.

---

### 3.5 RAG Pipeline Integration Test

```python
@pytest.mark.integration
async def test_rag_returns_grounded_answer(chat_service, indexed_research_doc):
    """
    Confirms the full pipeline: query → embed → search → prompt → LLM → answer
    contains content from the indexed document, not hallucinated content.
    """
    response_chunks = []
    async for event in chat_service.stream_response(
        message="What does the document say about transformers?",
        document_ids=[indexed_research_doc["id"]]
    ):
        response_chunks.append(event)

    full_text = " ".join(e["content"] for e in response_chunks if e["type"] == "chunk")
    sources = next(e for e in response_chunks if e["type"] == "sources")

    assert len(full_text) > 50
    assert len(sources["sources"]) > 0
    assert sources["sources"][0]["document_name"] == indexed_research_doc["name"]
```

---

## 4. Frontend Tests (Vitest + Testing Library)

### 4.1 Setup

```
frontend/
└── src/
    └── __tests__/
        ├── components/
        │   ├── DocumentUpload.test.tsx
        │   ├── DocumentCard.test.tsx
        │   └── ChatInterface.test.tsx
        └── lib/
            └── api.test.ts
```

```bash
npm install -D vitest @vitest/ui @testing-library/react @testing-library/user-event jsdom
```

### 4.2 Component Tests

```tsx
// DocumentUpload.test.tsx
describe("DocumentUpload", () => {
  it("renders drop zone", () => {
    render(<DocumentUpload onUpload={vi.fn()} />)
    expect(screen.getByText(/drag.*drop/i)).toBeInTheDocument()
  })

  it("calls onUpload with selected file", async () => {
    const onUpload = vi.fn()
    render(<DocumentUpload onUpload={onUpload} />)
    const file = new File(["content"], "notes.pdf", { type: "application/pdf" })
    const input = screen.getByTestId("file-input")
    await userEvent.upload(input, file)
    expect(onUpload).toHaveBeenCalledWith(file)
  })

  it("rejects files over 50 MB", async () => {
    render(<DocumentUpload onUpload={vi.fn()} />)
    const bigFile = new File([new ArrayBuffer(51 * 1024 * 1024)], "big.pdf")
    await userEvent.upload(screen.getByTestId("file-input"), bigFile)
    expect(screen.getByText(/too large/i)).toBeInTheDocument()
  })
})
```

```tsx
// ChatInterface.test.tsx
describe("ChatInterface", () => {
  it("renders empty state with prompt", () => {
    render(<ChatInterface documents={[]} />)
    expect(screen.getByPlaceholderText(/ask.*notes/i)).toBeInTheDocument()
  })

  it("disables input while streaming", async () => {
    // Mock fetch to return an SSE stream
    global.fetch = vi.fn().mockResolvedValue(mockSSEResponse())
    render(<ChatInterface documents={[mockDoc]} />)
    await userEvent.type(screen.getByRole("textbox"), "What is X?")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(screen.getByRole("textbox")).toBeDisabled()
  })
})
```

---

## 5. End-to-End Tests (Playwright)

### 5.1 Setup

```bash
npm install -D @playwright/test
npx playwright install
```

```
e2e/
├── upload.spec.ts
├── chat.spec.ts
└── library.spec.ts
```

### 5.2 Key Scenarios

```ts
// upload.spec.ts
test("user can upload a PDF and see it appear in library", async ({ page }) => {
  await page.goto("/documents")
  await page.setInputFiles("[data-testid=file-input]", "e2e/fixtures/sample.pdf")
  await expect(page.getByText("sample.pdf")).toBeVisible()
  await expect(page.getByText("processing")).toBeVisible()
  // Wait for processing to complete (real backend or mock)
  await expect(page.getByText("ready")).toBeVisible({ timeout: 30_000 })
})

// chat.spec.ts
test("user can ask a question and receive a streamed answer", async ({ page }) => {
  await page.goto("/chat")
  await page.fill("[data-testid=chat-input]", "What is the main topic?")
  await page.click("[data-testid=send-button]")
  // Streaming answer appears progressively
  await expect(page.locator(".message-bubble.assistant")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".source-citation")).toBeVisible()
})

// library.spec.ts
test("user can delete a document", async ({ page }) => {
  await page.goto("/documents")
  await page.click("[data-testid=doc-menu-button]")
  await page.click("[data-testid=delete-button]")
  await page.click("[data-testid=confirm-delete]")
  await expect(page.getByText("sample.pdf")).not.toBeVisible()
})
```

**Run:**
```bash
npx playwright test             # headless
npx playwright test --ui        # visual mode
```

---

## 6. Coverage Targets

| Area | Target |
|---|---|
| Backend unit tests | 80% line coverage |
| Backend API tests | All happy-path + top 3 error cases per endpoint |
| Frontend components | All interactive states (empty, loading, error, success) |
| E2E | Upload → chat golden path always green in CI |

---

## 7. Test Data & Fixtures

```
tests/
└── fixtures/
    ├── sample.pdf          # 5-page research paper (public domain)
    ├── sample.docx         # short Word doc
    ├── sample.txt          # plain text notes
    └── chunks.json         # pre-computed chunk fixtures for unit tests
```

Generate chunks fixture:
```bash
python tests/generate_fixtures.py
```

---

## 8. CI Integration

```yaml
# .github/workflows/test.yml (excerpt)
jobs:
  backend-tests:
    steps:
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: pytest tests/unit tests/api -v --cov=app
        env:
          # No real Azure credentials — all mocked in unit/api tests

  frontend-tests:
    steps:
      - run: npm ci
      - run: npm run test
      - run: npm run test:e2e
        env:
          NEXT_PUBLIC_API_URL: http://localhost:8001

  integration-tests:
    if: github.ref == 'refs/heads/main'     # only on merge to main
    steps:
      - run: pytest tests/integration -m integration --azure-live
        env:
          AZURE_SEARCH_ENDPOINT: ${{ secrets.AZURE_SEARCH_ENDPOINT_TEST }}
          AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT_TEST }}
```
