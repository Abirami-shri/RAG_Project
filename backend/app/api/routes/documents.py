from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import Response

from app.config import settings
from app.models.schemas import DocumentListResponse, DocumentMetadata
from app.services.chat import ChatService
from app.services.document_processor import SUPPORTED_TYPES, chunk_text, extract_text
from app.services.search import SearchService
from app.services.storage import StorageService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])


def get_storage() -> StorageService:
    return StorageService()


def get_search() -> SearchService:
    return SearchService()


def get_chat(search: SearchService = Depends(get_search)) -> ChatService:
    return ChatService(search)


@router.post("/upload", status_code=202, response_model=DocumentMetadata)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    storage: StorageService = Depends(get_storage),
    search: SearchService = Depends(get_search),
    chat: ChatService = Depends(get_chat),
) -> DocumentMetadata:
    if file.content_type not in SUPPORTED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    file_bytes = await file.read()
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.max_file_size_mb} MB limit")

    meta = await storage.upload_file(file_bytes, file.filename or "upload", file.content_type or "")
    logger.info("upload.received doc_id=%s size=%d", meta.id, meta.size_bytes)

    background_tasks.add_task(
        _process_document,
        meta.id,
        meta.name,
        file_bytes,
        file.content_type or "",
        storage,
        search,
        chat,
    )
    return meta


async def _process_document(
    doc_id: str,
    filename: str,
    file_bytes: bytes,
    content_type: str,
    storage: StorageService,
    search: SearchService,
    chat: ChatService,
) -> None:
    try:
        await storage.update_status(doc_id, "processing")
        logger.info("processing.started doc_id=%s", doc_id)

        text = extract_text(file_bytes, content_type)
        chunks_text = chunk_text(text, settings.chunk_size, settings.chunk_overlap)

        if not chunks_text:
            await storage.update_status(doc_id, "error", error="No text could be extracted")
            return

        vectors = await chat.embed_batch(chunks_text)
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
        logger.info("processing.completed doc_id=%s chunks=%d", doc_id, len(docs))

    except Exception as exc:
        logger.error("processing.failed doc_id=%s error=%s", doc_id, exc)
        await storage.update_status(doc_id, "error", error=str(exc))


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    storage: StorageService = Depends(get_storage),
) -> DocumentListResponse:
    docs = await storage.list_documents()
    return DocumentListResponse(documents=docs, total=len(docs))


@router.get("/{document_id}", response_model=DocumentMetadata)
async def get_document(
    document_id: str,
    storage: StorageService = Depends(get_storage),
) -> DocumentMetadata:
    meta = await storage.get_metadata(document_id)
    if not meta:
        raise HTTPException(404, "Document not found")
    return meta


@router.delete("/{document_id}", status_code=204, response_class=Response)
async def delete_document(
    document_id: str,
    storage: StorageService = Depends(get_storage),
    search: SearchService = Depends(get_search),
) -> Response:
    meta = await storage.get_metadata(document_id)
    if not meta:
        raise HTTPException(404, "Document not found")
    await search.delete_document_chunks(document_id)
    await storage.delete_document(document_id, meta.name)
    logger.info("document.deleted doc_id=%s", document_id)
    return Response(status_code=204)
