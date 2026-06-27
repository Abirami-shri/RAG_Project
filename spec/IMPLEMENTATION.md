# Implementation Guide — Second Brain

---

## 1. Build Order

Follow this sequence. Each step is self-contained and testable before moving on.

```
Phase 1 — Backend Foundation
  1.1  Project scaffold + config
  1.2  Azure service clients (storage, search, openai)
  1.3  Document processor (extract + chunk)
  1.4  Documents API (upload, list, delete)

Phase 2 — RAG Pipeline
  2.1  Embedding service
  2.2  Search indexing + querying
  2.3  Chat service (RAG orchestration)
  2.4  Chat API (SSE streaming)

Phase 3 — Frontend
  3.1  Next.js scaffold + layout
  3.2  API client (typed)
  3.3  Document upload component
  3.4  Document library page
  3.5  Chat interface + streaming
  3.6  Source citations

Phase 4 — Integration & Polish
  4.1  Wire frontend to real backend
  4.2  Error states + loading states
  4.3  Docker Compose
  4.4  Health check endpoints
```

---

## 2. Backend

### 2.1 Scaffold

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── documents.py
│   │       └── chat.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── storage.py
│   │   ├── document_processor.py
│   │   ├── search.py
│   │   └── chat.py
│   └── models/
│       ├── __init__.py
│       └── schemas.py
├── requirements.txt
└── .env.example
```

**`requirements.txt`**
```
fastapi==0.111.0
uvicorn[standard]==0.30.1
python-multipart==0.0.9
pydantic-settings==2.3.0
azure-storage-blob==12.20.0
azure-search-documents==11.6.0b4
azure-ai-formrecognizer==3.3.3
openai==1.35.0
PyPDF2==3.0.1
python-docx==1.1.2
httpx==0.27.0
aiohttp>=3.9.0
```

> **Note:** `aiohttp` is required by the async Azure AI Search SDK (`azure-search-documents` async client uses `aiohttp` as its HTTP transport). It is not pulled in automatically.

---

### 2.2 Config (`app/config.py`)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Azure Storage
    azure_storage_connection_string: str
    azure_storage_documents_container: str = "documents"
    azure_storage_metadata_container: str = "metadata"

    # Azure AI Search
    azure_search_endpoint: str
    azure_search_api_key: str
    azure_search_index_name: str = "second-brain-chunks"

    # Azure OpenAI
    azure_openai_endpoint: str
    azure_openai_api_key: str
    azure_openai_api_version: str = "2024-02-01"
    azure_openai_embedding_deployment: str = "text-embedding-ada-002"
    azure_openai_chat_deployment: str = "gpt-4o"

    # Azure Document Intelligence (optional)
    azure_document_intelligence_endpoint: str = ""
    azure_document_intelligence_key: str = ""

    # App — in .env, this must be a JSON array: CORS_ORIGINS=["http://localhost:3000"]
    # pydantic-settings v2 JSON-decodes list fields from env vars before validators run.
    cors_origins: list[str] = ["http://localhost:3000"]
    max_file_size_mb: int = 50
    chunk_size: int = 1000
    chunk_overlap: int = 200
    top_k_results: int = 5
    log_level: str = "INFO"

    class Config:
        env_file = ".env"

settings = Settings()
```

---

### 2.3 Pydantic Schemas (`app/models/schemas.py`)

```python
from pydantic import BaseModel
from datetime import datetime
from typing import Literal, Optional

class DocumentMetadata(BaseModel):
    id: str
    name: str
    original_name: str
    content_type: str
    size_bytes: int
    status: Literal["uploading", "processing", "ready", "error"]
    error_message: Optional[str] = None
    chunk_count: int = 0
    created_at: datetime
    updated_at: datetime

class DocumentListResponse(BaseModel):
    documents: list[DocumentMetadata]
    total: int

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    message: str
    conversation_id: str
    document_ids: Optional[list[str]] = None
    history: list[ChatMessage] = []

class ChatSource(BaseModel):
    document_name: str
    document_id: str
    page_number: Optional[int]
    excerpt: str

# SSE event shapes (for documentation — not Pydantic models)
# {"type": "chunk",   "content": "..."}
# {"type": "sources", "sources": [...]}
# {"type": "done"}
# {"type": "error",   "message": "..."}
```

---

### 2.4 Storage Service (`app/services/storage.py`)

```python
import uuid, json
from datetime import datetime, timezone
from azure.storage.blob.aio import BlobServiceClient
from app.config import settings
from app.models.schemas import DocumentMetadata

class StorageService:
    def __init__(self):
        self._client = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )

    async def upload_file(self, file_bytes: bytes, filename: str, content_type: str) -> DocumentMetadata:
        doc_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        # Upload raw file
        blob_name = f"{doc_id}/{filename}"
        async with self._client.get_blob_client(
            settings.azure_storage_documents_container, blob_name
        ) as blob:
            await blob.upload_blob(file_bytes, content_type=content_type)

        # Write metadata
        meta = DocumentMetadata(
            id=doc_id, name=filename, original_name=filename,
            content_type=content_type, size_bytes=len(file_bytes),
            status="uploading", chunk_count=0, created_at=now, updated_at=now
        )
        await self._write_metadata(meta)
        return meta

    async def get_file_bytes(self, document_id: str, filename: str) -> bytes:
        blob_name = f"{document_id}/{filename}"
        async with self._client.get_blob_client(
            settings.azure_storage_documents_container, blob_name
        ) as blob:
            stream = await blob.download_blob()
            return await stream.readall()

    async def list_documents(self) -> list[DocumentMetadata]:
        container = self._client.get_container_client(
            settings.azure_storage_metadata_container
        )
        docs = []
        async for blob in container.list_blobs():
            meta = await self._read_metadata(blob.name.replace(".json", ""))
            if meta:
                docs.append(meta)
        return sorted(docs, key=lambda d: d.created_at, reverse=True)

    async def get_metadata(self, document_id: str) -> DocumentMetadata | None:
        return await self._read_metadata(document_id)

    async def update_status(self, document_id: str, status: str,
                            chunk_count: int = 0, error: str | None = None):
        meta = await self._read_metadata(document_id)
        if not meta:
            return
        meta.status = status
        meta.chunk_count = chunk_count
        meta.error_message = error
        meta.updated_at = datetime.now(timezone.utc)
        await self._write_metadata(meta)

    async def delete_document(self, document_id: str, filename: str):
        # Delete raw file
        blob_name = f"{document_id}/{filename}"
        async with self._client.get_blob_client(
            settings.azure_storage_documents_container, blob_name
        ) as blob:
            await blob.delete_blob(delete_snapshots="include")

        # Delete metadata
        async with self._client.get_blob_client(
            settings.azure_storage_metadata_container, f"{document_id}.json"
        ) as blob:
            await blob.delete_blob()

    async def _write_metadata(self, meta: DocumentMetadata):
        data = meta.model_dump_json().encode()
        async with self._client.get_blob_client(
            settings.azure_storage_metadata_container, f"{meta.id}.json"
        ) as blob:
            await blob.upload_blob(data, overwrite=True)

    async def _read_metadata(self, document_id: str) -> DocumentMetadata | None:
        try:
            async with self._client.get_blob_client(
                settings.azure_storage_metadata_container, f"{document_id}.json"
            ) as blob:
                stream = await blob.download_blob()
                data = await stream.readall()
                return DocumentMetadata.model_validate_json(data)
        except Exception:
            return None
```

---

### 2.5 Document Processor (`app/services/document_processor.py`)

```python
import io
from app.config import settings

def extract_text(file_bytes: bytes, content_type: str) -> str:
    if content_type == "application/pdf":
        return _extract_pdf(file_bytes)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(file_bytes)
    if content_type in ("text/plain", "text/markdown"):
        return file_bytes.decode("utf-8", errors="replace")
    raise ValueError(f"Unsupported content type: {content_type}")

def _extract_pdf(file_bytes: bytes) -> str:
    # Try Azure Document Intelligence first
    if settings.azure_document_intelligence_endpoint:
        return _extract_pdf_document_intelligence(file_bytes)
    # Fallback: PyPDF2
    import PyPDF2
    reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)

def _extract_docx(file_bytes: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())

def _extract_pdf_document_intelligence(file_bytes: bytes) -> str:
    from azure.ai.formrecognizer import DocumentAnalysisClient
    from azure.core.credentials import AzureKeyCredential
    client = DocumentAnalysisClient(
        endpoint=settings.azure_document_intelligence_endpoint,
        credential=AzureKeyCredential(settings.azure_document_intelligence_key)
    )
    poller = client.begin_analyze_document("prebuilt-read", file_bytes)
    result = poller.result()
    return "\n\n".join(page.content for page in result.pages)

def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    if not text.strip():
        return []
    separators = ["\n\n", "\n", ". ", " ", ""]
    return _recursive_split(text.strip(), size, overlap, separators)

def _recursive_split(text: str, size: int, overlap: int, seps: list[str]) -> list[str]:
    if len(text) <= size:
        return [text]
    sep = next((s for s in seps if s in text), "")
    parts = text.split(sep) if sep else [text[i:i+size] for i in range(0, len(text), size-overlap)]
    chunks, current = [], ""
    for part in parts:
        candidate = (current + sep + part).strip() if current else part
        if len(candidate) <= size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = part[-overlap:] + sep + part if overlap and len(part) > size else part
    if current:
        chunks.append(current)
    return chunks
```

---

### 2.6 Search Service (`app/services/search.py`)

```python
from azure.search.documents.aio import SearchClient
from azure.search.documents.indexes.aio import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SimpleField, SearchableField, SearchField,
    SearchFieldDataType, VectorSearch, HnswAlgorithmConfiguration,
    VectorSearchProfile
)
from azure.core.credentials import AzureKeyCredential
from app.config import settings

class SearchService:
    def __init__(self):
        cred = AzureKeyCredential(settings.azure_search_api_key)
        self._index_client = SearchIndexClient(settings.azure_search_endpoint, cred)
        self._search_client = SearchClient(
            settings.azure_search_endpoint,
            settings.azure_search_index_name, cred
        )

    async def ensure_index(self):
        # azure-search-documents 11.6.0b4 requires keyword-only args (name=, type=)
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SimpleField(name="document_id", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="document_name", type=SearchFieldDataType.String, retrievable=True),
            SearchableField(name="content", type=SearchFieldDataType.String),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True, vector_search_dimensions=1536,
                vector_search_profile_name="hnsw-profile"
            ),
            SimpleField(name="page_number", type=SearchFieldDataType.Int32, retrievable=True),
            SimpleField(name="chunk_index", type=SearchFieldDataType.Int32, retrievable=True),
            SimpleField(name="created_at", type=SearchFieldDataType.DateTimeOffset, retrievable=True),
        ]
        vector_search = VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
            profiles=[VectorSearchProfile(name="hnsw-profile", algorithm_configuration_name="hnsw")]
        )
        index = SearchIndex(
            name=settings.azure_search_index_name,
            fields=fields, vector_search=vector_search
        )
        await self._index_client.create_or_update_index(index)

    async def upsert_chunks(self, chunks: list[dict]):
        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            await self._search_client.upload_documents(documents=chunks[i:i+batch_size])

    async def search(self, query: str, query_vector: list[float],
                     document_ids: list[str] | None = None, top: int = 5) -> list[dict]:
        from azure.search.documents.models import VectorizedQuery
        filter_expr = None
        if document_ids:
            ids_filter = " or ".join(f"document_id eq '{d}'" for d in document_ids)
            filter_expr = f"({ids_filter})"

        vector_query = VectorizedQuery(
            vector=query_vector, k_nearest_neighbors=top, fields="content_vector"
        )
        results = await self._search_client.search(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expr,
            top=top,
            select=["id", "document_id", "document_name", "content", "page_number", "chunk_index"]
        )
        return [dict(r) async for r in results]

    async def delete_document_chunks(self, document_id: str):
        results = await self._search_client.search(
            search_text="*", filter=f"document_id eq '{document_id}'",
            select=["id"], top=1000
        )
        ids = [{"id": r["id"]} async for r in results]
        if ids:
            await self._search_client.delete_documents(documents=ids)
```

---

### 2.7 Chat Service — RAG (`app/services/chat.py`)

```python
import json
from typing import AsyncGenerator
from openai import AsyncAzureOpenAI
from app.config import settings
from app.services.search import SearchService

SYSTEM_PROMPT = """You are Second Brain, a knowledge assistant that answers questions
strictly based on the user's uploaded documents.

Rules:
- Only use information from the CONTEXT sections provided.
- If the context does not contain enough information, respond:
  "I couldn't find relevant information in your documents for this question."
- Always cite sources using: [Source: <document_name>, p.<page>]
- Be concise and accurate. Do not speculate beyond the provided context.

CONTEXT:
{context}"""

class ChatService:
    def __init__(self, search_service: SearchService):
        self._search = search_service
        self._openai = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
        )

    async def embed(self, text: str) -> list[float]:
        response = await self._openai.embeddings.create(
            model=settings.azure_openai_embedding_deployment,
            input=text
        )
        return response.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        response = await self._openai.embeddings.create(
            model=settings.azure_openai_embedding_deployment,
            input=texts
        )
        return [item.embedding for item in sorted(response.data, key=lambda x: x.index)]

    async def stream_response(
        self, message: str, history: list[dict],
        document_ids: list[str] | None = None
    ) -> AsyncGenerator[str, None]:
        # 1. Embed query
        query_vector = await self.embed(message)

        # 2. Hybrid search
        chunks = await self._search.search(
            query=message, query_vector=query_vector,
            document_ids=document_ids, top=settings.top_k_results
        )

        # 3. Build context string
        context = _format_context(chunks)

        # 4. Build messages
        messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context)}]
        for turn in history[-10:]:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        # 5. Stream response
        stream = await self._openai.chat.completions.create(
            model=settings.azure_openai_chat_deployment,
            messages=messages,
            stream=True,
            temperature=0.1,
            max_tokens=1500,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"

        # 6. Emit sources
        sources = _extract_sources(chunks)
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

def _format_context(chunks: list[dict]) -> str:
    parts = []
    for i, chunk in enumerate(chunks, 1):
        page = f", p.{chunk['page_number']}" if chunk.get("page_number") else ""
        parts.append(f"[{i}] {chunk['document_name']}{page}:\n{chunk['content']}")
    return "\n\n---\n\n".join(parts) if parts else "No relevant context found."

def _extract_sources(chunks: list[dict]) -> list[dict]:
    seen = set()
    sources = []
    for chunk in chunks:
        key = (chunk["document_id"], chunk.get("page_number"))
        if key not in seen:
            seen.add(key)
            sources.append({
                "document_id": chunk["document_id"],
                "document_name": chunk["document_name"],
                "page_number": chunk.get("page_number"),
                "excerpt": chunk["content"][:150] + "...",
            })
    return sources
```

---

### 2.8 Documents Router (`app/api/routes/documents.py`)

```python
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from app.services.storage import StorageService
from app.services.document_processor import extract_text, chunk_text
from app.services.search import SearchService
from app.services.chat import ChatService
from app.models.schemas import DocumentListResponse
from app.config import settings

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_TYPES = {
    "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "text/markdown",
}

@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    storage: StorageService = Depends(),
    search: SearchService = Depends(),
    chat: ChatService = Depends(),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")
    file_bytes = await file.read()
    if len(file_bytes) > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(413, "File exceeds maximum allowed size")

    meta = await storage.upload_file(file_bytes, file.filename, file.content_type)
    background_tasks.add_task(
        _process_document, meta.id, meta.name, file_bytes,
        file.content_type, storage, search, chat
    )
    return meta

async def _process_document(doc_id, filename, file_bytes, content_type,
                             storage, search, chat):
    try:
        await storage.update_status(doc_id, "processing")
        text = extract_text(file_bytes, content_type)
        chunks_text = chunk_text(text, settings.chunk_size, settings.chunk_overlap)
        vectors = await chat.embed_batch(chunks_text)
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        docs = [
            {
                "id": f"{doc_id}-{i}",
                "document_id": doc_id,
                "document_name": filename,
                "content": text_chunk,
                "content_vector": vec,
                "page_number": None,
                "chunk_index": i,
                "created_at": now,
            }
            for i, (text_chunk, vec) in enumerate(zip(chunks_text, vectors))
        ]
        await search.upsert_chunks(docs)
        await storage.update_status(doc_id, "ready", chunk_count=len(docs))
    except Exception as e:
        await storage.update_status(doc_id, "error", error=str(e))

@router.get("", response_model=DocumentListResponse)
async def list_documents(storage: StorageService = Depends()):
    docs = await storage.list_documents()
    return {"documents": docs, "total": len(docs)}

@router.get("/{document_id}")
async def get_document(document_id: str, storage: StorageService = Depends()):
    meta = await storage.get_metadata(document_id)
    if not meta:
        raise HTTPException(404, "Document not found")
    return meta

@router.delete("/{document_id}", status_code=204, response_class=Response)
async def delete_document(
    document_id: str,
    storage: StorageService = Depends(),
    search: SearchService = Depends(),
) -> Response:
    # FastAPI 0.111.0 requires explicit response_class=Response for 204 routes
    meta = await storage.get_metadata(document_id)
    if not meta:
        raise HTTPException(404, "Document not found")
    await search.delete_document_chunks(document_id)
    await storage.delete_document(document_id, meta.name)
    return Response(status_code=204)
```

---

### 2.9 Chat Router (`app/api/routes/chat.py`)

```python
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.services.chat import ChatService
from app.models.schemas import ChatRequest
import json

router = APIRouter(prefix="/api/chat", tags=["chat"])

@router.post("")
async def chat(request: ChatRequest, chat_service: ChatService = Depends()):
    if not request.message.strip():
        raise HTTPException(422, "Message cannot be empty")

    async def event_stream():
        try:
            async for event in chat_service.stream_response(
                message=request.message,
                history=[m.model_dump() for m in request.history],
                document_ids=request.document_ids,
            ):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

---

### 2.10 App Entry Point (`app/main.py`)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import documents, chat, health
from app.services.search import SearchService
from app.services.storage import StorageService
import logging

app = FastAPI(title="Second Brain API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(health.router)

@app.on_event("startup")
async def startup():
    log = logging.getLogger(__name__)
    # Auto-create blob containers — non-fatal, 409 ContainerAlreadyExists is silently ignored
    try:
        await StorageService().ensure_containers()
        log.info("startup: storage containers ready")
    except Exception as exc:
        log.error("startup: storage container creation failed — %s", exc)

    # Auto-create AI Search index — non-fatal so server starts even if search is misconfigured
    try:
        await SearchService().ensure_index()
        log.info("startup: search index ready")
    except Exception as exc:
        log.error("startup: search index creation failed — %s", exc)
        log.error("startup: AZURE_SEARCH_ENDPOINT must be https://<name>.search.windows.net")
```

> **Key behaviour:** Startup errors are logged but do not crash the server. This lets the app start with partial connectivity (e.g. while search is being provisioned) and `/api/health/azure` can be used to diagnose which services are not yet reachable.

---

## 3. Frontend

### 3.1 Scaffold

```bash
npx create-next-app@latest frontend \
  --typescript --tailwind --app --no-src-dir --import-alias "@/*"
cd frontend
npm install @tanstack/react-query axios lucide-react
npx shadcn@latest init
npx shadcn@latest add button card badge progress toast
```

Rename `src/` approach: files live in `frontend/src/`.

---

### 3.2 API Client (`src/lib/api.ts`)

```typescript
import axios from "axios"

const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001" })

export const documentsApi = {
  upload: (file: File, onProgress?: (pct: number) => void) => {
    const form = new FormData()
    form.append("file", file)
    return api.post<DocumentMeta>("/api/documents/upload", form, {
      onUploadProgress: e => onProgress?.(Math.round((e.loaded / (e.total ?? 1)) * 100)),
    })
  },
  list: () => api.get<{ documents: DocumentMeta[]; total: number }>("/api/documents"),
  get: (id: string) => api.get<DocumentMeta>(`/api/documents/${id}`),
  delete: (id: string) => api.delete(`/api/documents/${id}`),
}

export async function* streamChat(request: ChatRequest): AsyncGenerator<SSEEvent> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
  if (!res.ok) throw new Error(`Chat error: ${res.status}`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        yield JSON.parse(line.slice(6)) as SSEEvent
      }
    }
  }
}
```

---

### 3.3 Types (`src/lib/types.ts`)

```typescript
export type DocumentStatus = "uploading" | "processing" | "ready" | "error"

export interface DocumentMeta {
  id: string
  name: string
  content_type: string
  size_bytes: number
  status: DocumentStatus
  chunk_count: number
  created_at: string
  updated_at: string
  error_message?: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  sources?: ChatSource[]
}

export interface ChatSource {
  document_id: string
  document_name: string
  page_number?: number
  excerpt: string
}

export interface ChatRequest {
  message: string
  conversation_id: string
  document_ids?: string[]
  history: { role: "user" | "assistant"; content: string }[]
}

export type SSEEvent =
  | { type: "chunk"; content: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "done" }
  | { type: "error"; message: string }
```

---

### 3.4 Key Components to Build

**`DocumentUpload`** — drag-and-drop zone. On file selection: (1) fetches existing library and checks for filename collisions; duplicates are shown in an amber warning panel with per-file delete buttons; (2) non-duplicate files are uploaded via `documentsApi.upload()` with a progress bar; (3) after upload (202), polls `documentsApi.get(id)` every 3s until `status === "ready"` or `"error"`.

**`DocumentCard`** — shows name, type icon (PDF/DOC/TXT), size, date, status badge (`processing` = spinner, `ready` = green, `error` = red). Delete button with confirmation dialog.

**`ChatInterface`** — text input at bottom. On submit, calls `streamChat()`, appends tokens to the current assistant message as they arrive. Disables input during streaming. Renders sources accordion once `sources` SSE event arrives.

**`Sidebar`** — nav links (Home, Library, Chat). Conversation list. "New Chat" button.

---

### 3.5 Chat Streaming Hook

```typescript
// src/hooks/useChat.ts
export function useChat(documentIds?: string[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const convId = useRef(crypto.randomUUID())

  const send = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: "user", content: text }
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)

    const assistantMsg: ChatMessage = { role: "assistant", content: "", sources: [] }
    setMessages(prev => [...prev, assistantMsg])

    try {
      for await (const event of streamChat({
        message: text,
        conversation_id: convId.current,
        document_ids: documentIds,
        history: messages.map(m => ({ role: m.role, content: m.content })),
      })) {
        if (event.type === "chunk") {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1].content += event.content
            return updated
          })
        } else if (event.type === "sources") {
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1].sources = event.sources
            return updated
          })
        }
      }
    } finally {
      setStreaming(false)
    }
  }, [messages, documentIds])

  return { messages, streaming, send }
}
```

---

## 4. Integration Checklist

Before calling the implementation done, verify:

- [ ] Upload a PDF → status moves to `ready`
- [ ] Ask a question about the PDF content → response references actual content
- [ ] Source citation appears in chat with correct document name
- [ ] Delete a document → removed from library and no longer appears in search results
- [ ] Chat with no documents uploaded → "no relevant information" response (not a hallucination)
- [ ] Upload unsupported file type → 400 error shown to user
- [ ] Upload file over 50 MB → 413 error shown to user
- [ ] Backend restart → `GET /api/documents` still shows documents (metadata persisted in Blob)
