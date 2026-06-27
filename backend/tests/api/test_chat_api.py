"""API tests for POST /api/chat — RAG pipeline is mocked."""
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


async def _mock_stream(*args, **kwargs):
    yield 'data: {"type": "chunk", "content": "The answer"}\n\n'
    yield 'data: {"type": "chunk", "content": " is 42."}\n\n'
    yield 'data: {"type": "sources", "sources": [{"document_id": "d1", "document_name": "notes.txt", "page_number": null, "excerpt": "..."}]}\n\n'
    yield 'data: {"type": "done"}\n\n'


@pytest.fixture(autouse=True)
def mock_chat_service():
    mock = AsyncMock()
    mock.stream_response = _mock_stream
    mock.ensure_index = AsyncMock(return_value=None)

    mock_storage = AsyncMock()
    mock_storage.ensure_containers = AsyncMock(return_value=None)

    mock_search = AsyncMock()
    mock_search.ensure_index = AsyncMock(return_value=None)

    with (
        patch("app.api.routes.chat.ChatService", return_value=mock),
        patch("app.api.routes.chat.SearchService", return_value=mock_search),
        patch("app.main.StorageService", return_value=mock_storage),
        patch("app.main.SearchService", return_value=mock_search),
    ):
        yield mock


# ── happy path ────────────────────────────────────────────────────────────────

def test_chat_returns_200(client):
    response = client.post(
        "/api/chat",
        json={"message": "What is X?", "conversation_id": "conv-1", "history": []},
    )
    assert response.status_code == 200


def test_chat_content_type_is_event_stream(client):
    response = client.post(
        "/api/chat",
        json={"message": "What is X?", "conversation_id": "conv-1", "history": []},
    )
    assert "text/event-stream" in response.headers["content-type"]


def test_chat_streams_chunk_events(client):
    response = client.post(
        "/api/chat",
        json={"message": "What is X?", "conversation_id": "conv-1", "history": []},
    )
    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    chunk_events = [e for e in events if e["type"] == "chunk"]
    assert len(chunk_events) > 0


def test_chat_streams_sources_event(client):
    response = client.post(
        "/api/chat",
        json={"message": "What is X?", "conversation_id": "conv-1", "history": []},
    )
    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    sources_events = [e for e in events if e["type"] == "sources"]
    assert len(sources_events) == 1
    assert "sources" in sources_events[0]


def test_chat_streams_done_event(client):
    response = client.post(
        "/api/chat",
        json={"message": "What is X?", "conversation_id": "conv-1", "history": []},
    )
    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[-1]["type"] == "done"


def test_chat_assembled_answer(client):
    response = client.post(
        "/api/chat",
        json={"message": "What is X?", "conversation_id": "conv-1", "history": []},
    )
    events = [
        json.loads(line[6:])
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    answer = "".join(e["content"] for e in events if e["type"] == "chunk")
    assert answer == "The answer is 42."


def test_chat_with_document_scope(client):
    response = client.post(
        "/api/chat",
        json={
            "message": "Summarise this",
            "conversation_id": "conv-2",
            "document_ids": ["doc-1", "doc-2"],
            "history": [],
        },
    )
    assert response.status_code == 200


# ── validation ────────────────────────────────────────────────────────────────

def test_empty_message_returns_422(client):
    response = client.post(
        "/api/chat",
        json={"message": "", "conversation_id": "conv-1", "history": []},
    )
    assert response.status_code == 422


def test_missing_message_field_returns_422(client):
    response = client.post(
        "/api/chat",
        json={"conversation_id": "conv-1", "history": []},
    )
    assert response.status_code == 422
