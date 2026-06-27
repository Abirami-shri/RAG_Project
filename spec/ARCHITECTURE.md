# Architecture — Second Brain

---

## 1. System Overview

Second Brain is a RAG (Retrieval-Augmented Generation) application composed of three tiers: a Next.js client, a FastAPI backend, and a set of Azure managed services. No custom infrastructure is operated — all storage, search, and AI inference is delegated to Azure.

```
┌──────────────────────────────────────────────────────────────────┐
│                         BROWSER (Next.js)                        │
│                                                                  │
│   /            /documents        /chat                           │
│   Home         Library           Chat Interface                  │
│   Upload CTA   Document Cards    Message Thread + SSE Stream     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS  (REST + SSE)
┌──────────────────────────▼───────────────────────────────────────┐
│                        BACKEND (FastAPI)                         │
│                                                                  │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │   documents router  │  │         chat router              │  │
│  │  POST /upload       │  │  POST /chat  → StreamingResponse │  │
│  │  GET  /             │  └─────────────┬────────────────────┘  │
│  │  GET  /{id}         │                │                        │
│  │  DELETE /{id}       │                │                        │
│  └──────────┬──────────┘                │                        │
│             │                           │                        │
│  ┌──────────▼───────────────────────────▼────────────────────┐  │
│  │                      Service Layer                         │  │
│  │                                                            │  │
│  │  StorageService   ProcessorService   SearchService         │  │
│  │  (Blob CRUD)      (extract+chunk)    (index + query)       │  │
│  │                                                            │  │
│  │  ChatService  ←─────────────────────────────────────────  │  │
│  │  (RAG pipeline: embed → retrieve → prompt → stream)        │  │
│  └───┬──────────────────┬───────────────────────┬────────────┘  │
└──────┼──────────────────┼───────────────────────┼───────────────┘
       │                  │                        │
┌──────▼──────┐  ┌────────▼────────┐  ┌──────────▼──────────────┐
│  Azure Blob │  │  Azure AI Search│  │    Azure OpenAI          │
│  Storage    │  │  Hybrid Index   │  │    - ada-002 (embed)     │
│  documents/ │  │  vector + BM25  │  │    - gpt-4o  (chat)      │
│  metadata/  │  │  RRF reranking  │  └──────────────────────────┘
└─────────────┘  └─────────────────┘
                          ▲
              ┌───────────┘
              │  (optional)
┌─────────────┴───────────────────┐
│  Azure Document Intelligence    │
│  PDF / DOCX / image extraction  │
└─────────────────────────────────┘
```

---

## 2. Component Responsibilities

### 2.1 Frontend (Next.js 14, App Router)

| Concern | Approach |
|---|---|
| Routing | File-system routes: `/`, `/documents`, `/chat` |
| State | React Query for server state; `useState` / `useReducer` for local UI state |
| Streaming | `fetch` + `ReadableStream` reader over SSE response |
| Type safety | Shared TypeScript types mirrored from backend schemas |
| Styling | Tailwind CSS utility classes; shadcn/ui for headless components |

The frontend is a **thin client** — it holds no business logic beyond UI composition and API calls. All retrieval, embedding, and generation happen in the backend.

### 2.2 Backend (FastAPI)

Split into three layers:

**Routers** — HTTP boundary. Validate input, call services, return responses. No business logic.

**Services** — One class per Azure integration. Constructed once at startup and shared via FastAPI dependency injection.

| Service | Responsibility |
|---|---|
| `StorageService` | Upload/download/delete blobs; read/write metadata JSON |
| `ProcessorService` | Extract text from file bytes; split into chunks |
| `SearchService` | Create/upsert/delete index entries; run hybrid queries |
| `ChatService` | Orchestrate RAG: embed query → search → build prompt → stream GPT-4o |

**Models** — Pydantic schemas for request/response validation and serialization.

### 2.3 Azure Blob Storage

Two logical containers:

```
documents/
  {document_id}/
    original.pdf          ← raw uploaded file

metadata/
  {document_id}.json      ← DocumentMetadata record
```

`DocumentMetadata` schema:
```json
{
  "id": "string",
  "name": "string",
  "original_name": "string",
  "content_type": "string",
  "size_bytes": 0,
  "status": "uploading | processing | ready | error",
  "error_message": null,
  "chunk_count": 0,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

### 2.4 Azure AI Search — Index Schema

Index name: `second-brain-chunks`

```
id               String    key        "{doc_id}-{chunk_idx}"
document_id      String    filterable  parent document
document_name    String    retrievable for citations
content          String    searchable  chunk text (BM25)
content_vector   Vector    1536 dims   cosine similarity
page_number      Int32     retrievable nullable
chunk_index      Int32     retrievable order within doc
created_at       DateTimeOffset        ISO-8601
```

Query profile: **hybrid search** — run vector query (cosine) and keyword query (BM25) in parallel, merge with Reciprocal Rank Fusion (RRF), return top-k=5.

### 2.5 Azure OpenAI

| Purpose | Model | Usage |
|---|---|---|
| Embeddings | `text-embedding-ada-002` | Called during ingestion (per chunk) and at query time |
| Chat completions | `gpt-4o` | Called once per user message; response streamed via SSE |

---

## 3. RAG Pipeline (detailed)

```
User message
     │
     ▼
[1] Embed query
     text-embedding-ada-002 → float[1536]
     │
     ▼
[2] Hybrid search  (Azure AI Search)
     vector: cosine similarity on content_vector
     keyword: BM25 on content field
     filter: document_id in [scoped_ids]  (if user pinned docs)
     rerank: RRF  →  top-5 chunks
     │
     ▼
[3] Build prompt
     system: grounding instructions + "only answer from context"
     context: chunk[0..4] formatted with doc name + page
     history: last N conversation turns
     user: current message
     │
     ▼
[4] Stream gpt-4o
     StreamingResponse → SSE events
     chunk events  →  UI renders tokens live
     sources event →  UI renders citation accordion
     done event    →  UI closes stream
```

---

## 4. Upload / Ingestion Pipeline

```
HTTP POST /api/documents/upload
     │
     ├─[sync]──► save raw bytes → Azure Blob Storage
     │             return { document_id, status: "processing" }
     │
     └─[async BackgroundTask]──►
           [1] Read blob bytes
           [2] Extract text
                  ├── Azure Document Intelligence (if configured)
                  └── fallback: PyPDF2 / python-docx / plain read
           [3] Chunk text
                  recursive splitter: chunk_size=1000, overlap=200
                  splits on: "\n\n" → "\n" → ". " → " "
           [4] Embed chunks (batched, max 16 per API call)
                  text-embedding-ada-002 → float[1536] per chunk
           [5] Upsert to Azure AI Search
                  batch size: 100 documents per IndexDocuments call
           [6] Update metadata status → "ready"
                  or "error" with message on any exception
```

---

## 5. Data Flow — Sequence Diagrams

### Upload
```
Client          Backend         Blob Storage        AI Search
  │                │                  │                  │
  │─POST /upload──►│                  │                  │
  │                │─save raw blob───►│                  │
  │                │─save metadata───►│                  │
  │◄─202 accepted──│                  │                  │
  │                │                  │                  │
  │                │  [background]    │                  │
  │                │─read bytes──────►│                  │
  │                │◄─bytes───────────│                  │
  │                │─extract text     │                  │
  │                │─chunk            │                  │
  │                │─embed (OpenAI)   │                  │
  │                │─upsert chunks────────────────────►  │
  │                │─update metadata─►│                  │
  │                │  status: ready   │                  │
```

### Chat
```
Client          Backend         AI Search        Azure OpenAI
  │                │                │                  │
  │─POST /chat────►│                │                  │
  │                │─embed query────────────────────►  │
  │                │◄─float[1536]───────────────────── │
  │                │─hybrid search─►│                  │
  │                │◄─top-5 chunks──│                  │
  │                │─build prompt   │                  │
  │                │─stream chat────────────────────►  │
  │◄─SSE chunk─────│◄─token─────────────────────────── │
  │◄─SSE chunk─────│◄─token─────────────────────────── │
  │◄─SSE sources───│                │                  │
  │◄─SSE done──────│                │                  │
```

---

## 6. Key Architectural Decisions

### ADR-001: Metadata in Blob Storage, not a database
**Decision:** Store document metadata as JSON files in a `metadata/` blob container.  
**Rationale:** Avoids provisioning Azure Cosmos DB or Azure SQL for MVP. Blob Storage is already required; adding a JSON read/write is trivial. At ~1 KB per document, 500 documents = 500 KB — well within free tier.  
**Trade-off:** No ad-hoc querying (no `WHERE status = 'ready'`). Listing all documents requires reading every metadata file. Acceptable for MVP (<500 docs); replace with Cosmos DB in v1.1.

### ADR-002: Hybrid search over pure vector search
**Decision:** Use Azure AI Search's hybrid query (vector + BM25 + RRF) instead of pure vector similarity.  
**Rationale:** Keyword search outperforms vector search for exact terms, proper nouns, and identifiers. Hybrid consistently beats either alone on recall. RRF merges the two rank lists without requiring a tuned weight.  
**Trade-off:** Slightly higher search latency (~50ms vs ~20ms). Acceptable.

### ADR-003: Streaming via SSE, not WebSockets
**Decision:** Use Server-Sent Events for streaming chat responses.  
**Rationale:** SSE is unidirectional (server → client), stateless, works over standard HTTP/2, no upgrade handshake. Chat is inherently one-shot request → streaming response — WebSockets add complexity with no benefit here.  
**Trade-off:** SSE cannot be used for bidirectional real-time features (e.g., collaborative chat). Not a requirement for MVP.

### ADR-004: Background tasks via FastAPI BackgroundTasks
**Decision:** Document processing runs in FastAPI `BackgroundTasks` (same process, different thread).  
**Rationale:** No external queue (Azure Service Bus / Celery) needed for MVP. Simple, zero-infrastructure.  
**Trade-off:** If the server restarts mid-processing, the task is lost. Document status stays `processing` forever. Mitigation: a startup job that resets stuck documents. Replace with durable queue in v1.1.

---

## 7. Error Handling Strategy

| Layer | Approach |
|---|---|
| Router | `HTTPException` with appropriate 4xx/5xx codes |
| Services | Raise domain-specific exceptions; routers catch and translate |
| Background tasks | Catch all exceptions; write `status: error` + message to metadata |
| SSE stream | Emit `{"type": "error", "message": "..."}` event before closing |
| Frontend | React Query error states; toast notifications; retry on transient errors |

---

## 8. Security Considerations

- **No user auth (MVP):** Single-tenant, local use only. Azure credentials in `.env` — never committed.
- **File validation:** MIME type checked server-side (not trusted from client); max size enforced.
- **Blob access:** Blobs are private; download links are signed URLs with 1-hour expiry.
- **CORS:** Restricted to `CORS_ORIGINS` env var; not `*` even in development.
- **Input sanitization:** Pydantic validates all request bodies; filenames sanitized before blob key construction.
- **Secret management:** `.env.example` committed; `.env` git-ignored. Production uses Azure Key Vault references.

---

## 9. Scalability Path

| Bottleneck | MVP approach | Scale-out approach |
|---|---|---|
| Ingestion concurrency | BackgroundTasks (single process) | Azure Service Bus + worker pods |
| Metadata queries | Read all blobs | Azure Cosmos DB with partition key = user_id |
| Search throughput | Shared AI Search tier | Scale up to Standard S2/S3 |
| LLM throughput | Single Azure OpenAI deployment | PTU (provisioned throughput units) |
| Multi-tenancy | Single namespace | Per-user index prefix or separate indexes |
