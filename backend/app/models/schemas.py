from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


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
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: str
    document_ids: Optional[list[str]] = None
    history: list[ChatMessage] = []


class ChatSource(BaseModel):
    document_id: str
    document_name: str
    page_number: Optional[int] = None
    excerpt: str


class HealthResponse(BaseModel):
    status: str
    version: str = "1.0.0"


class AzureHealthResponse(BaseModel):
    storage: str
    search: str
    openai: str
