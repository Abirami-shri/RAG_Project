"""API tests for /api/documents — all Azure services are mocked."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import DocumentListResponse, DocumentMetadata

# ── shared fixture helpers ─────────────────────────────────────────────────────

def _make_meta(**kwargs) -> DocumentMetadata:
    defaults = dict(
        id="doc-abc",
        name="sample.txt",
        original_name="sample.txt",
        content_type="text/plain",
        size_bytes=100,
        status="ready",
        chunk_count=2,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        error_message=None,
    )
    return DocumentMetadata(**{**defaults, **kwargs})


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def mock_azure_services():
    """Patch all three Azure service constructors for every test in this module."""
    meta = _make_meta()

    mock_storage = AsyncMock()
    mock_storage.upload_file.return_value = _make_meta(status="uploading")
    mock_storage.list_documents.return_value = [meta]
    mock_storage.get_metadata.return_value = meta
    mock_storage.delete_document.return_value = None
    mock_storage.ensure_containers.return_value = None

    mock_search = AsyncMock()
    mock_search.ensure_index.return_value = None
    mock_search.upsert_chunks.return_value = None
    mock_search.delete_document_chunks.return_value = None

    mock_chat = AsyncMock()
    mock_chat.embed_batch.return_value = [[0.1] * 1536]

    with (
        patch("app.api.routes.documents.StorageService", return_value=mock_storage),
        patch("app.api.routes.documents.SearchService", return_value=mock_search),
        patch("app.services.storage.StorageService", return_value=mock_storage),
        patch("app.services.search.SearchService", return_value=mock_search),
        patch("app.main.StorageService", return_value=mock_storage),
        patch("app.main.SearchService", return_value=mock_search),
    ):
        yield {"storage": mock_storage, "search": mock_search, "chat": mock_chat}


# ── upload ─────────────────────────────────────────────────────────────────────

def test_upload_returns_202(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert response.status_code == 202


def test_upload_response_has_id_and_status(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    body = response.json()
    assert "id" in body
    assert body["status"] == "uploading"


def test_upload_rejects_unsupported_type(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("photo.png", b"\x89PNG", "image/png")},
    )
    assert response.status_code == 400


def test_upload_rejects_oversized_file(client):
    big = b"x" * (51 * 1024 * 1024)  # 51 MB
    response = client.post(
        "/api/documents/upload",
        files={"file": ("big.txt", big, "text/plain")},
    )
    assert response.status_code == 413


def test_upload_accepts_pdf(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("paper.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert response.status_code == 202


def test_upload_accepts_markdown(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("readme.md", b"# Title", "text/markdown")},
    )
    assert response.status_code == 202


# ── list ───────────────────────────────────────────────────────────────────────

def test_list_documents_returns_200(client):
    response = client.get("/api/documents")
    assert response.status_code == 200


def test_list_documents_response_shape(client):
    response = client.get("/api/documents")
    body = response.json()
    assert "documents" in body
    assert "total" in body
    assert isinstance(body["documents"], list)


def test_list_documents_total_matches_count(client):
    response = client.get("/api/documents")
    body = response.json()
    assert body["total"] == len(body["documents"])


# ── get single ────────────────────────────────────────────────────────────────

def test_get_document_returns_200(client):
    response = client.get("/api/documents/doc-abc")
    assert response.status_code == 200


def test_get_document_not_found_returns_404(client, mock_azure_services):
    mock_azure_services["storage"].get_metadata.return_value = None
    response = client.get("/api/documents/nonexistent")
    assert response.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────────

def test_delete_document_returns_204(client):
    response = client.delete("/api/documents/doc-abc")
    assert response.status_code == 204


def test_delete_nonexistent_returns_404(client, mock_azure_services):
    mock_azure_services["storage"].get_metadata.return_value = None
    response = client.delete("/api/documents/nonexistent")
    assert response.status_code == 404


def test_delete_calls_search_cleanup(client, mock_azure_services):
    client.delete("/api/documents/doc-abc")
    mock_azure_services["search"].delete_document_chunks.assert_called_once_with("doc-abc")
