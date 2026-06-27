# CLAUDE.md

Guidance for working in this repository.

## Project

**Second Brain (ask-my-notes)** — an AI-powered knowledge assistant. Users upload documents/notes and chat with them in natural language. Every answer is grounded in the user's own files via RAG (retrieval-augmented generation), not general internet knowledge.

Full product spec and design docs live in `spec/`:
- `spec/SPEC.md` — product specification (features, API, data model)
- `spec/ARCHITECTURE.md` — system design, sequence diagrams, ADRs
- `spec/IMPLEMENTATION.md` — build order + reference code
- `spec/TESTING.md` — test strategy
- `spec/DEPLOYMENT.md` — Azure provisioning + CI/CD
- `spec/QUALITY.md` — code standards, observability, security

Read `spec/SPEC.md` and `spec/ARCHITECTURE.md` before making non-trivial changes — they are the source of truth for intended behavior.

## Architecture

Three tiers, all retrieval/AI delegated to Azure:

```
Next.js frontend ──REST/SSE──> FastAPI backend ──> Azure Blob Storage   (files + JSON metadata)
                                              ├──> Azure AI Search       (hybrid vector + BM25 index)
                                              └──> Azure OpenAI          (ada-002 embeddings, gpt-4o chat)
```

**RAG query flow:** embed query → hybrid search top-5 chunks → build grounded prompt → stream gpt-4o response over SSE with source citations.

**Ingestion flow:** upload → save blob → background task: extract text → chunk (1000 chars / 200 overlap) → embed → upsert to AI Search → mark `ready`.

Key architectural decisions (see ARCHITECTURE.md §6 for rationale):
- Document metadata stored as JSON sidecars in Blob Storage, **not** a database (MVP)
- Hybrid search (vector + BM25 + RRF), not pure vector
- Streaming via SSE, not WebSockets
- Background processing via FastAPI `BackgroundTasks`, not an external queue

## Layout

```
backend/          FastAPI app
  app/
    main.py             entrypoint, CORS, router registration, startup index creation
    config.py           pydantic-settings, reads .env
    models/schemas.py   pydantic request/response models
    api/routes/         documents.py, chat.py, health.py  (HTTP boundary only)
    services/           storage.py, document_processor.py, search.py, chat.py  (business logic)
frontend/         Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
spec/             design docs (above)
```

Backend layering: **routers** validate input and call services; **services** wrap one Azure integration each; **models** are pydantic schemas. Keep business logic out of routers.

## Commands

Backend:
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in Azure credentials
uvicorn app.main:app --reload --port 8001   # Swagger at /docs
```

Frontend:
```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Both via Docker (when docker-compose.yml exists): `docker compose up --build`

## Conventions

- **Python:** async throughout (Azure async SDKs). Type-hint everything. One service class per Azure integration, constructed via FastAPI `Depends`.
- **Config:** never hardcode endpoints/keys — add to `config.py` Settings and `.env.example`. `.env` is gitignored.
- **Errors:** routers raise `HTTPException`; background tasks catch all exceptions and write `status: error` to metadata; SSE streams emit an `{"type":"error"}` event before closing.
- **SSE event shape:** `{"type":"chunk"|"sources"|"done"|"error", ...}` — keep frontend `SSEEvent` union (`frontend/src/lib/types.ts`) in sync with backend `chat.py`.
- **Document status lifecycle:** `uploading → processing → ready | error`.

## Constraints

- Supported uploads: PDF, DOCX, TXT, MD. Max 50 MB/file.
- RAG must refuse when no relevant context is found ("I couldn't find relevant information…") — never hallucinate. The grounding system prompt lives in `backend/app/services/chat.py`.
- Out of scope for MVP: auth, multi-tenancy, document versioning, folders/tags. See SPEC.md §15.
