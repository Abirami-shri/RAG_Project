# Second Brain — Ask My Notes

An AI-powered knowledge assistant. Upload your documents and chat with them in natural language. Every answer is grounded in your own files via RAG — not general internet knowledge.

## Architecture

```
Next.js frontend ──REST/SSE──> FastAPI backend ──> Azure Blob Storage   (files + metadata)
                                              ├──> Azure AI Search       (hybrid vector + BM25)
                                              └──> Azure OpenAI          (ada-002 embeddings, gpt-4o)
```

**Upload flow:** file → blob storage → text extraction → chunking → embedding → AI Search index → `ready`

**Query flow:** embed question → hybrid search top-5 chunks → grounded prompt → stream gpt-4o → source citations

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- An Azure subscription with:
  - **Azure Blob Storage** account
  - **Azure AI Search** service (Free tier works for dev)
  - **Azure OpenAI** resource with `text-embedding-ada-002` and `gpt-4o` deployments

---

## Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Copy the example env file and fill in your Azure credentials:

```bash
cp .env.example .env
```

```env
# .env

# Azure Blob Storage — get from portal → Storage account → Access keys
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
AZURE_STORAGE_DOCUMENTS_CONTAINER=documents
AZURE_STORAGE_METADATA_CONTAINER=metadata

# Azure AI Search — endpoint must be https://<name>.search.windows.net
AZURE_SEARCH_ENDPOINT=https://<name>.search.windows.net
AZURE_SEARCH_API_KEY=<admin-key>
AZURE_SEARCH_INDEX_NAME=second-brain-chunks

# Azure OpenAI — use cognitiveservices.azure.com for multi-service resources (no trailing slash)
AZURE_OPENAI_ENDPOINT=https://<name>.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-ada-002
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o

# App
CORS_ORIGINS=["http://localhost:3000"]
MAX_FILE_SIZE_MB=50
```

Start the backend:

```bash
uvicorn app.main:app --reload --port 8001
```

On first startup the backend automatically:
- Creates the `documents` and `metadata` blob containers if they don't exist
- Creates the `second-brain-chunks` AI Search index if it doesn't exist

Verify Azure connectivity:

```bash
curl http://localhost:8001/api/health/azure
# → {"storage":"ok","search":"ok","openai":"ok"}
```

Swagger UI: http://localhost:8001/docs

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

The frontend expects the backend at `http://localhost:8001` by default. Override with:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8001 npm run dev
```

---

## Running Tests

**Backend** (unit + API, no Azure required — all mocked):

```bash
cd backend
source .venv/bin/activate
pytest tests/unit tests/api -v
```

**Frontend** (component tests with Vitest):

```bash
cd frontend
npm run test        # add "test": "vitest run tests/" to package.json scripts
```

Or run directly:

```bash
cd frontend
npx vitest run tests/
```

---

## Project Structure

```
RAG_Project/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, CORS, startup hooks
│   │   ├── config.py                # pydantic-settings, reads .env
│   │   ├── models/schemas.py        # Pydantic request/response models
│   │   ├── api/routes/
│   │   │   ├── documents.py         # Upload, list, get, delete endpoints
│   │   │   ├── chat.py              # SSE streaming chat endpoint
│   │   │   └── health.py            # /api/health and /api/health/azure
│   │   └── services/
│   │       ├── storage.py           # Azure Blob Storage client
│   │       ├── document_processor.py# Text extraction + chunking
│   │       ├── search.py            # Azure AI Search client
│   │       └── chat.py              # RAG pipeline (embed → search → stream)
│   ├── tests/
│   │   ├── unit/                    # chunker, processor, prompt builder
│   │   └── api/                     # documents API, chat API
│   ├── requirements.txt
│   ├── pytest.ini
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx                 # Home (stats + upload)
│   │   ├── documents/page.tsx       # Document library
│   │   ├── chat/page.tsx            # Chat interface
│   │   ├── components/              # Navbar, Sidebar, DocumentUpload, ChatInterface, ...
│   │   ├── hooks/useChat.ts         # Streaming chat hook
│   │   └── lib/                     # api.ts, types.ts
│   ├── tests/
│   │   └── components/              # DocumentUpload.test.tsx, ChatInterface.test.tsx
│   └── vitest.config.ts
│
└── spec/                            # Product spec, architecture, deployment guide
```

---

## Supported File Types

| Format | MIME type |
|---|---|
| PDF | `application/pdf` |
| Word | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Plain text | `text/plain` |
| Markdown | `text/markdown` |

Max file size: **50 MB**

---

## Key Notes

- **`CORS_ORIGINS`** must be a JSON array in `.env`: `["http://localhost:3000"]`
- **Azure AI Search endpoint** must use `.search.windows.net` — not `cognitiveservices.azure.com`
- **Azure OpenAI endpoint** for multi-service resources uses `cognitiveservices.azure.com` (no trailing slash)
- Blob containers and the AI Search index are created automatically on first backend startup
- `.env` is gitignored — never commit credentials
