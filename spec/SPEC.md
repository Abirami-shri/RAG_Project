# Second Brain — Ask My Notes
### Product Specification

---

## 1. Overview

**Second Brain** is an AI-powered knowledge assistant that lets users upload their own documents, notes, and files and have natural language conversations with that content. Users get accurate, context-aware answers grounded in their own knowledge base — not general internet knowledge.

**Core value proposition:** Upload once, ask anything. Your notes answer back.

---

## 2. Problem Statement

Knowledge workers, researchers, and students accumulate large volumes of notes, PDFs, and documents that become hard to search and reason across over time. Existing search tools are keyword-based and require the user to already know what they're looking for. LLMs hallucinate when asked about private content they have no access to.

Second Brain solves this by combining **personal document storage** with **retrieval-augmented generation (RAG)** so that every AI response is grounded in the user's actual files.

---

## 3. Target Users

| Persona | Use Case |
|---|---|
| Researcher | Query across dozens of papers and PDFs |
| Student | Ask questions against lecture notes and textbooks |
| Knowledge worker | Surface insights from internal docs and reports |
| Personal user | Search journals, highlights, and saved articles |

---

## 4. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js)                       │
│   Upload UI │ Document Library │ Chat Interface               │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST / SSE
┌──────────────────────▼───────────────────────────────────────┐
│                     BACKEND (FastAPI)                         │
│                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  /documents  │   │    /chat     │   │   /health        │  │
│  └──────┬──────┘   └──────┬───────┘   └──────────────────┘  │
│         │                 │                                   │
│  ┌──────▼──────────────────▼──────────────────────────────┐  │
│  │                   Service Layer                         │  │
│  │  StorageService │ ProcessorService │ SearchService      │  │
│  │  ChatService (RAG pipeline)                            │  │
│  └──────┬──────────────┬──────────────────────────────────┘  │
└─────────┼──────────────┼─────────────────────────────────────┘
          │              │
┌─────────▼──────┐  ┌────▼────────────────────────────────────┐
│  Azure Blob    │  │  Azure AI Search                        │
│  Storage       │  │  (vector + keyword index)               │
│  (raw files +  │  └────┬────────────────────────────────────┘
│   metadata)    │       │ embeddings via
└────────────────┘  ┌────▼────────────────────────────────────┐
                    │  Azure OpenAI                           │
                    │  text-embedding-ada-002 (embed)         │
                    │  gpt-4o (chat completions)              │
                    └─────────────────────────────────────────┘
```

---

## 5. Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Framework | Python 3.14+ + FastAPI |
| Document processing | Azure Document Intelligence (PDF/DOCX/images), PyPDF2 + python-docx (fallback) |
| Chunking | Custom recursive splitter (1000 chars, 200 overlap) |
| Embeddings | Azure OpenAI `text-embedding-ada-002` (1536 dims) |
| Vector store | Azure AI Search (vector + full-text hybrid index) |
| LLM | Azure OpenAI `gpt-4o` (streaming via SSE) |
| File storage | Azure Blob Storage |
| Metadata store | Azure Blob Storage (JSON sidecar files) |
| Server | Uvicorn |

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS |
| UI components | shadcn/ui |
| Data fetching | React Query (TanStack Query) |
| Streaming | `fetch` + `ReadableStream` (SSE) |

### Infrastructure
| Concern | Solution |
|---|---|
| Containerization | Docker + Docker Compose (local dev) |
| Secrets | `.env` files (local), Azure Key Vault (prod) |
| CORS | FastAPI CORS middleware |

---

## 6. Azure Services

### 6.1 Azure Blob Storage
- **Container: `documents`** — raw uploaded files
- **Container: `metadata`** — per-document JSON metadata files
- Files keyed by `{document_id}/{original_filename}`
- Signed URLs for direct download

### 6.2 Azure AI Search
- **Index: `second-brain-chunks`**
- Fields:

| Field | Type | Notes |
|---|---|---|
| `id` | String (key) | `{doc_id}-{chunk_index}` |
| `document_id` | String (filterable) | Parent document |
| `document_name` | String (retrievable) | For citations |
| `content` | String (searchable) | Chunk text |
| `content_vector` | Collection(Single) | 1536-dim embedding |
| `page_number` | Int32 | Nullable |
| `chunk_index` | Int32 | Order within doc |
| `created_at` | DateTimeOffset | |

- Search type: **hybrid** (vector similarity + BM25 keyword), RRF reranking

### 6.3 Azure OpenAI
- **Embedding deployment:** `text-embedding-ada-002`
- **Chat deployment:** `gpt-4o`
- Streaming completions via SSE
- System prompt enforces grounding: answers only from retrieved context

### 6.4 Azure Document Intelligence
- Used for PDF, DOCX, PPTX, images
- Extracts text with layout awareness, preserves page numbers
- Falls back to PyPDF2 / python-docx if not configured

---

## 7. Feature Specifications

### 7.1 Document Upload

**Supported formats:** PDF, DOCX, TXT, MD, PPTX, images (PNG, JPG)  
**Max file size:** 50 MB per file  
**Max documents:** 500 per user (MVP)

**Duplicate detection:** Before uploading, the frontend checks the existing library. If a file with the same name already exists, the upload is blocked and an inline warning is shown with the duplicate listed and a delete button. The user must delete the old version before re-uploading.

**Upload flow:**
1. User drops or selects file(s) in the Upload UI
2. Frontend checks existing library for filename collisions — duplicates are surfaced with delete option, not uploaded
3. Frontend `POST /api/documents/upload` (multipart form) for new files only
4. Backend saves raw file to Azure Blob Storage
5. Returns `document_id` + `status: processing`
6. Background task starts async processing pipeline:
   a. Text extraction (Document Intelligence / fallback)
   b. Recursive chunking
   c. Embedding generation (batched)
   d. Index upsert to Azure AI Search
   e. Update metadata status → `ready`
6. Frontend polls `GET /api/documents/{id}` until `status: ready`

**Document statuses:** `uploading` → `processing` → `ready` | `error`

### 7.2 Document Library

- Grid of document cards showing: name, type icon, upload date, status badge, chunk count
- Delete document (removes blob + all index entries)
- Filter by type, sort by date/name
- Search documents by name

### 7.3 Chat Interface

**Query flow (RAG pipeline):**
1. User sends message in chat UI
2. Frontend `POST /api/chat` with `{ message, conversation_id, document_ids? }`
3. Backend:
   a. Embed user query with `text-embedding-ada-002`
   b. Hybrid search Azure AI Search: top-k=5 chunks (filterable by `document_id`)
   c. Build prompt with retrieved chunks as context
   d. Stream `gpt-4o` response via SSE back to frontend
4. Response includes inline source citations `[Source: filename.pdf, p.3]`
5. Conversation history maintained client-side (last 10 turns sent as context)

**Scoping:** User can optionally pin specific documents to limit retrieval scope

**When no relevant context found:** LLM responds with "I couldn't find relevant information in your uploaded documents for this question."

### 7.4 Conversation History

- Conversations stored client-side (localStorage) — MVP
- Each conversation linked to a set of documents
- Sidebar lists recent conversations
- Clear/delete conversation

---

## 8. API Design

### Documents

```
POST   /api/documents/upload          Upload file(s)
GET    /api/documents                 List all documents
GET    /api/documents/{id}            Get document metadata + status
DELETE /api/documents/{id}            Delete document + index entries
GET    /api/documents/{id}/download   Get signed blob URL
```

### Chat

```
POST   /api/chat                      Send message, stream response (SSE)
```

### System

```
GET    /api/health                    Health check
GET    /api/health/azure              Azure connectivity check
```

### Request / Response Schemas

**POST /api/documents/upload**
```json
// Response
{
  "document_id": "uuid",
  "name": "research-paper.pdf",
  "status": "processing",
  "created_at": "2026-06-20T10:00:00Z"
}
```

**GET /api/documents**
```json
{
  "documents": [
    {
      "id": "uuid",
      "name": "research-paper.pdf",
      "type": "application/pdf",
      "size_bytes": 204800,
      "status": "ready",
      "chunk_count": 42,
      "created_at": "2026-06-20T10:00:00Z"
    }
  ],
  "total": 1
}
```

**POST /api/chat**
```json
// Request
{
  "message": "What did the paper say about transformer architecture?",
  "conversation_id": "uuid",
  "document_ids": ["uuid1", "uuid2"],   // optional scope filter
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

// Response (SSE stream)
data: {"type": "chunk", "content": "The paper describes..."}
data: {"type": "chunk", "content": " a multi-head attention..."}
data: {"type": "sources", "sources": [{"document_name": "paper.pdf", "page": 3, "excerpt": "..."}]}
data: {"type": "done"}
```

---

## 9. UI / UX Flows

### 9.1 Layout
```
┌─────────────────────────────────────────────────────┐
│  ◈ Second Brain                          [Settings] │  ← Top navbar
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│  NAV     │        MAIN CONTENT AREA                │
│          │                                          │
│  Home    │                                          │
│  Library │                                          │
│  Chat    │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### 9.2 Home Page
- Hero with upload area (drag & drop)
- Stats: total documents, total chunks indexed
- Recent documents (last 5)
- Quick-start chat prompt

### 9.3 Library Page
- Document card grid with status badges
- Upload button (top right)
- Filter/sort controls
- Empty state with upload CTA

### 9.4 Chat Page
- Left sidebar: conversation list + "New Chat" button
- Main area: message thread
- Bottom: input bar with document scope selector
- Message bubbles: user (right), assistant (left)
- Sources accordion below each AI response
- Streaming cursor animation during response

---

## 10. Data Flow Diagram

```
UPLOAD PIPELINE
───────────────
File → [Blob Storage] → [Text Extraction] → [Chunking]
     → [Embedding]   → [AI Search Index] → status: ready

QUERY PIPELINE
──────────────
User Query → [Embed Query] → [Hybrid Search] → top-5 chunks
           → [Build Prompt + History + Chunks] → [GPT-4o]
           → [Stream Response + Citations] → UI
```

---

## 11. System Prompt (RAG)

```
You are Second Brain, a knowledge assistant that answers questions 
strictly based on the user's uploaded documents.

Rules:
- Only use information from the CONTEXT sections provided below.
- If the context does not contain enough information to answer, say:
  "I couldn't find relevant information in your documents for this question."
- Always cite your sources using the format: [Source: <document_name>, p.<page>]
- Be concise and accurate. Do not speculate beyond the provided context.
- If multiple documents are relevant, synthesize the information and cite each.

CONTEXT:
{retrieved_chunks}
```

---

## 12. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Upload response time | < 2s to return `processing` status |
| Processing time (10-page PDF) | < 30s to reach `ready` |
| Query latency (first token) | < 3s |
| Concurrent users (MVP) | 10 |
| File storage | Azure Blob (geo-redundant in prod) |
| Uptime | 99.5% (dev/staging target) |

---

## 13. Environment Variables

```env
# Azure Storage — use connection string from portal → Storage account → Access keys
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_DOCUMENTS_CONTAINER=documents
AZURE_STORAGE_METADATA_CONTAINER=metadata

# Azure AI Search — endpoint must be https://<name>.search.windows.net (NOT cognitiveservices.azure.com)
AZURE_SEARCH_ENDPOINT=https://<name>.search.windows.net
AZURE_SEARCH_API_KEY=
AZURE_SEARCH_INDEX_NAME=second-brain-chunks

# Azure OpenAI — use cognitiveservices.azure.com endpoint for multi-service resources (no trailing slash)
AZURE_OPENAI_ENDPOINT=https://<name>.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-ada-002
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o

# Azure Document Intelligence (optional)
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=

# App — CORS_ORIGINS must be a JSON array (pydantic-settings v2 requirement)
CORS_ORIGINS=["http://localhost:3000"]
MAX_FILE_SIZE_MB=50
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
TOP_K_RESULTS=5
LOG_LEVEL=INFO
```

---

## 14. Project Structure

```
terra-nova/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app entrypoint
│   │   ├── config.py                # Settings from env vars
│   │   ├── api/
│   │   │   └── routes/
│   │   │       ├── documents.py     # Upload, list, delete endpoints
│   │   │       └── chat.py          # SSE chat endpoint
│   │   ├── services/
│   │   │   ├── storage.py           # Azure Blob Storage client
│   │   │   ├── document_processor.py # Text extraction + chunking
│   │   │   ├── search.py            # Azure AI Search client
│   │   │   └── chat.py              # RAG pipeline
│   │   └── models/
│   │       └── schemas.py           # Pydantic request/response models
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Home
│   │   ├── globals.css              # Tailwind v4 import + color-scheme: light
│   │   ├── providers.tsx            # TanStack Query provider
│   │   ├── documents/page.tsx       # Library
│   │   ├── chat/page.tsx            # Chat
│   │   ├── components/
│   │   │   ├── Navbar.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── DocumentUpload.tsx   # Drag & drop + duplicate detection
│   │   │   ├── DocumentCard.tsx     # Library card
│   │   │   ├── HomeStats.tsx        # Live doc/chunk counts
│   │   │   ├── ChatInterface.tsx    # Main chat UI
│   │   │   ├── MessageBubble.tsx    # Individual message
│   │   │   └── SourceCitation.tsx   # Source accordion
│   │   ├── hooks/
│   │   │   └── useChat.ts           # Streaming chat hook
│   │   └── lib/
│   │       ├── api.ts               # Typed API client (axios + SSE)
│   │       └── types.ts             # Shared TypeScript types
│   ├── package.json
│   └── next.config.ts
│
├── docker-compose.yml
├── .env.example
└── SPECS.md
```

---

## 15. Out of Scope (MVP)

- User authentication / multi-tenancy
- Document versioning
- Real-time collaboration
- Mobile app
- Folder / tag organization
- Document preview (PDF viewer)
- Export chat history
- Webhooks / integrations

---

## 16. Future Roadmap

| Phase | Features |
|---|---|
| v1.1 | Auth (Azure AD B2C), per-user namespacing in search index |
| v1.2 | Document folders + tags, bulk upload |
| v1.3 | PDF viewer with highlighted source passages |
| v1.4 | Slack / Notion / Drive connectors |
| v2.0 | Multi-user workspaces, shared knowledge bases |
