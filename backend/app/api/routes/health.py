from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import AzureHealthResponse, HealthResponse
from app.services.chat import ChatService
from app.services.search import SearchService
from app.services.storage import StorageService

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/azure", response_model=AzureHealthResponse)
async def azure_health() -> AzureHealthResponse:
    storage = StorageService()
    search = SearchService()
    chat = ChatService(search)

    storage_ok = await storage.ping()
    search_ok = await search.ping()
    openai_ok = await chat.ping()

    return AzureHealthResponse(
        storage="ok" if storage_ok else "error",
        search="ok" if search_ok else "error",
        openai="ok" if openai_ok else "error",
    )
