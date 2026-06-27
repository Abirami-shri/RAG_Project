from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.models.schemas import ChatRequest
from app.services.chat import ChatService
from app.services.search import SearchService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


def get_search() -> SearchService:
    return SearchService()


def get_chat(search: SearchService = Depends(get_search)) -> ChatService:
    return ChatService(search)


@router.post("")
async def chat(
    request: ChatRequest,
    chat_service: ChatService = Depends(get_chat),
) -> StreamingResponse:
    logger.info("chat.query conv_id=%s doc_scope=%s", request.conversation_id, request.document_ids)

    async def event_stream():
        try:
            async for event in chat_service.stream_response(
                message=request.message,
                history=[m.model_dump() for m in request.history],
                document_ids=request.document_ids,
            ):
                yield event
        except Exception as exc:
            logger.error("chat.stream_error %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
