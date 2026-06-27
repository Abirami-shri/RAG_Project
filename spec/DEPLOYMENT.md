# Deployment — Second Brain

---

## 1. Environments

| Environment | Purpose | Trigger |
|---|---|---|
| `local` | Development, feature work | Manual (`docker compose up`) |
| `dev` | Shared integration, QA | Push to `dev` branch |
| `staging` | Pre-release smoke test | Push to `main` branch |
| `prod` | Live system | Manual promotion from staging |

Each environment has its own Azure resource group, blob storage account, AI Search instance, and OpenAI deployment — no environment shares resources.

---

## 2. Prerequisites

### Local Development
- Docker Desktop ≥ 4.x
- Node.js ≥ 20.x
- Python ≥ 3.11
- Azure CLI (`az`) — for provisioning only
- An Azure subscription with the following resource providers registered:
  - `Microsoft.Storage`
  - `Microsoft.Search`
  - `Microsoft.CognitiveServices`
  - `Microsoft.DocumentIntelligence` (optional)

---

## 3. Azure Resource Provisioning

### 3.1 One-time setup per environment

```bash
# Set variables
RESOURCE_GROUP="second-brain-dev"
LOCATION="eastus"
STORAGE_ACCOUNT="secondbraindev$(openssl rand -hex 4)"
SEARCH_SERVICE="second-brain-search-dev"
OPENAI_SERVICE="second-brain-openai-dev"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Azure Blob Storage
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

# Note: blob containers (documents, metadata) are auto-created by StorageService.ensure_containers()
# on first backend startup — no manual creation needed.

# Azure AI Search
az search service create \
  --name $SEARCH_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku basic

# Azure OpenAI
az cognitiveservices account create \
  --name $OPENAI_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --kind OpenAI \
  --sku S0

# Deploy models
az cognitiveservices account deployment create \
  --name $OPENAI_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --deployment-name text-embedding-ada-002 \
  --model-name text-embedding-ada-002 \
  --model-version "2" \
  --model-format OpenAI \
  --sku-capacity 120

az cognitiveservices account deployment create \
  --name $OPENAI_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --deployment-name gpt-4o \
  --model-name gpt-4o \
  --model-version "2024-05-13" \
  --model-format OpenAI \
  --sku-capacity 10
```

### 3.2 Retrieve and set secrets

```bash
# Storage connection string
az storage account show-connection-string \
  --name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP \
  --query connectionString -o tsv

# AI Search admin key
az search admin-key show \
  --service-name $SEARCH_SERVICE --resource-group $RESOURCE_GROUP \
  --query primaryKey -o tsv

# OpenAI key
az cognitiveservices account keys list \
  --name $OPENAI_SERVICE --resource-group $RESOURCE_GROUP \
  --query key1 -o tsv

# OpenAI endpoint
az cognitiveservices account show \
  --name $OPENAI_SERVICE --resource-group $RESOURCE_GROUP \
  --query properties.endpoint -o tsv
```

Paste values into `.env` (local) or GitHub Secrets / Azure Key Vault (CI/prod).

### 3.3 Create AI Search Index

On first backend startup, the backend auto-creates the index if it does not exist (`SearchService.ensure_index()`). To create it manually:

```bash
# From project root
cd backend
python -c "from app.services.search import SearchService; import asyncio; asyncio.run(SearchService().ensure_index())"
```

---

## 4. Local Development

### 4.1 Clone and configure

```bash
git clone https://github.com/your-org/second-brain.git
cd second-brain

cp .env.example .env
# Edit .env with your Azure credentials
```

### 4.2 Run with Docker Compose

```bash
docker compose up --build
```

Services started:
| Service | Port | URL |
|---|---|---|
| Frontend (Next.js) | 3000 | http://localhost:3000 |
| Backend (FastAPI) | 8001 | http://localhost:8001 |
| API docs (Swagger) | 8001 | http://localhost:8001/docs |

### 4.3 Run without Docker (native)

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 5. Docker Compose Configuration

```yaml
# docker-compose.yml
version: "3.9"

services:
  backend:
    build: ./backend
    ports:
      - "8001:8001"
    env_file: .env
    volumes:
      - ./backend:/app
    command: uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8001
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
    command: npm run dev
```

**Dockerfiles:**

```dockerfile
# backend/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
CMD ["node", "server.js"]
```

---

## 6. CI/CD Pipeline (GitHub Actions)

```
Push to branch
     │
     ├─► [test.yml]    Run unit + API tests (no Azure)
     │
Push to dev
     ├─► [test.yml]    + integration tests (Azure test env)
     └─► [deploy.yml]  Build images → push to ACR → deploy to Azure Container Apps (dev)

Push to main
     ├─► [test.yml]    Full test suite
     └─► [deploy.yml]  Deploy to staging → smoke test → manual approval → prod
```

### 6.1 Workflow: `deploy.yml`

```yaml
name: Deploy

on:
  push:
    branches: [dev, main]

env:
  ACR_REGISTRY: secondbrain.azurecr.io
  RESOURCE_GROUP_DEV: second-brain-dev
  RESOURCE_GROUP_PROD: second-brain-prod

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Log in to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Log in to ACR
        run: az acr login --name secondbrain

      - name: Build and push backend
        run: |
          docker build -t $ACR_REGISTRY/backend:${{ github.sha }} ./backend
          docker push $ACR_REGISTRY/backend:${{ github.sha }}

      - name: Build and push frontend
        run: |
          docker build -t $ACR_REGISTRY/frontend:${{ github.sha }} ./frontend
          docker push $ACR_REGISTRY/frontend:${{ github.sha }}

  deploy-dev:
    needs: build-and-push
    if: github.ref == 'refs/heads/dev'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Container Apps (dev)
        run: |
          az containerapp update \
            --name second-brain-backend \
            --resource-group $RESOURCE_GROUP_DEV \
            --image $ACR_REGISTRY/backend:${{ github.sha }}
          az containerapp update \
            --name second-brain-frontend \
            --resource-group $RESOURCE_GROUP_DEV \
            --image $ACR_REGISTRY/frontend:${{ github.sha }}

  deploy-staging:
    needs: build-and-push
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy to staging
        run: |
          az containerapp update \
            --name second-brain-backend \
            --resource-group second-brain-staging \
            --image $ACR_REGISTRY/backend:${{ github.sha }}

  deploy-prod:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production        # requires manual approval in GitHub Environments
    steps:
      - name: Deploy to prod
        run: |
          az containerapp update \
            --name second-brain-backend \
            --resource-group $RESOURCE_GROUP_PROD \
            --image $ACR_REGISTRY/backend:${{ github.sha }}
```

---

## 7. Azure Container Apps (Production)

### 7.1 Provision Container Apps environment

```bash
az containerapp env create \
  --name second-brain-env \
  --resource-group second-brain-prod \
  --location eastus

# Backend
az containerapp create \
  --name second-brain-backend \
  --resource-group second-brain-prod \
  --environment second-brain-env \
  --image secondbrain.azurecr.io/backend:latest \
  --target-port 8001 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 5 \
  --cpu 1 --memory 2Gi \
  --secrets \
    azure-storage-conn="$AZURE_STORAGE_CONNECTION_STRING" \
    azure-search-key="$AZURE_SEARCH_API_KEY" \
    azure-openai-key="$AZURE_OPENAI_API_KEY" \
  --env-vars \
    AZURE_STORAGE_CONNECTION_STRING=secretref:azure-storage-conn \
    AZURE_SEARCH_API_KEY=secretref:azure-search-key \
    AZURE_OPENAI_API_KEY=secretref:azure-openai-key \
    AZURE_SEARCH_ENDPOINT="$AZURE_SEARCH_ENDPOINT" \
    AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT"

# Frontend
az containerapp create \
  --name second-brain-frontend \
  --resource-group second-brain-prod \
  --environment second-brain-env \
  --image secondbrain.azurecr.io/frontend:latest \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --env-vars \
    NEXT_PUBLIC_API_URL="https://second-brain-backend.<env>.eastus.azurecontainerapps.io"
```

### 7.2 Custom domain (optional)

```bash
az containerapp hostname add \
  --hostname app.yourdomain.com \
  --name second-brain-frontend \
  --resource-group second-brain-prod
```

---

## 8. Environment Variables Reference

```env
# .env.example

# ── Azure Blob Storage ─────────────────────────────────────
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...
AZURE_STORAGE_DOCUMENTS_CONTAINER=documents
AZURE_STORAGE_METADATA_CONTAINER=metadata

# ── Azure AI Search ────────────────────────────────────────
AZURE_SEARCH_ENDPOINT=https://<service>.search.windows.net
AZURE_SEARCH_API_KEY=<admin-key>
AZURE_SEARCH_INDEX_NAME=second-brain-chunks

# ── Azure OpenAI ───────────────────────────────────────────
# Use cognitiveservices.azure.com for multi-service (Azure AI Services) resources.
# Use openai.azure.com for dedicated Azure OpenAI resources. No trailing slash.
AZURE_OPENAI_ENDPOINT=https://<service>.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-ada-002
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o

# ── Azure Document Intelligence (optional) ────────────────
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<service>.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<key>

# ── App ───────────────────────────────────────────────────
# Must be a JSON array — pydantic-settings v2 JSON-decodes list fields from env vars
CORS_ORIGINS=["http://localhost:3000"]
MAX_FILE_SIZE_MB=50
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
TOP_K_RESULTS=5
LOG_LEVEL=INFO
```

---

## 9. Health Checks

```bash
# Backend liveness
curl http://localhost:8001/api/health
# → {"status": "ok", "version": "1.0.0"}

# Azure connectivity check
curl http://localhost:8001/api/health/azure
# → {"storage": "ok", "search": "ok", "openai": "ok"}
```

Container Apps health probe config:
```bash
az containerapp update \
  --name second-brain-backend \
  --resource-group second-brain-prod \
  --set-env-vars "" \
  --liveness-probe-path /api/health \
  --liveness-probe-initial-delay 10 \
  --liveness-probe-period 30
```

---

## 10. Rollback

```bash
# List recent revisions
az containerapp revision list \
  --name second-brain-backend \
  --resource-group second-brain-prod \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" \
  -o table

# Activate a previous revision
az containerapp revision activate \
  --revision second-brain-backend--<revision-name> \
  --name second-brain-backend \
  --resource-group second-brain-prod
```

---

## 11. Cost Estimate (dev environment)

| Service | Tier | Est. monthly cost |
|---|---|---|
| Azure Blob Storage | LRS, 10 GB | ~$0.20 |
| Azure AI Search | Basic (1 SU) | ~$75 |
| Azure OpenAI (embeddings) | ada-002, ~1M tokens | ~$0.10 |
| Azure OpenAI (chat) | gpt-4o, ~500K tokens | ~$5 |
| Azure Container Apps | 1 vCPU, 2 GB × 2 services | ~$30 |
| **Total** | | **~$110 / month** |

Production costs scale with AI Search tier (Standard = ~$250/mo) and OpenAI token volume.
