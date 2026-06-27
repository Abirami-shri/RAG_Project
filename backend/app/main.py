from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import chat, documents, health
from app.config import settings
from app.services.search import SearchService
from app.services.storage import StorageService

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = FastAPI(
    title="Second Brain API",
    description="RAG-powered knowledge assistant API",
    version="1.0.0",
)

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
async def startup() -> None:
    log = logging.getLogger(__name__)
    log.info("startup: ensuring Azure AI Search index exists")
    try:
        await StorageService().ensure_containers()
        log.info("startup: storage containers ready")
    except Exception as exc:
        log.error("startup: storage container creation failed — %s", exc)

    try:
        await SearchService().ensure_index()
        log.info("startup: search index ready")
    except Exception as exc:
        log.error("startup: search index creation failed — %s", exc)
        log.error("startup: check AZURE_SEARCH_ENDPOINT in .env (must be https://<name>.search.windows.net)")
