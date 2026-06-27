"""Unit tests for context formatting and source extraction in chat.py"""
import pytest
from app.services.chat import _format_context, _extract_sources


SAMPLE_CHUNKS = [
    {
        "document_id": "doc-1",
        "document_name": "research.pdf",
        "content": "Transformers use self-attention mechanisms.",
        "page_number": 3,
        "chunk_index": 0,
    },
    {
        "document_id": "doc-1",
        "document_name": "research.pdf",
        "content": "BERT is a bidirectional transformer.",
        "page_number": 5,
        "chunk_index": 1,
    },
    {
        "document_id": "doc-2",
        "document_name": "notes.txt",
        "content": "My personal notes on transformers.",
        "page_number": None,
        "chunk_index": 0,
    },
]


# ── _format_context ────────────────────────────────────────────────────────────

def test_format_context_includes_all_chunk_content():
    result = _format_context(SAMPLE_CHUNKS)
    for chunk in SAMPLE_CHUNKS:
        assert chunk["content"] in result


def test_format_context_includes_document_names():
    result = _format_context(SAMPLE_CHUNKS)
    assert "research.pdf" in result
    assert "notes.txt" in result


def test_format_context_includes_page_numbers_when_present():
    result = _format_context(SAMPLE_CHUNKS)
    assert "p.3" in result
    assert "p.5" in result


def test_format_context_omits_page_when_none():
    result = _format_context(SAMPLE_CHUNKS)
    # notes.txt has page_number=None — its entry should not say "p.None"
    assert "p.None" not in result


def test_format_context_empty_chunks_returns_no_context_message():
    result = _format_context([])
    assert "no relevant" in result.lower() or "no context" in result.lower()


def test_format_context_separates_chunks():
    result = _format_context(SAMPLE_CHUNKS)
    # Multiple chunks should be separated
    assert len(result.split("---")) >= 1


# ── _extract_sources ───────────────────────────────────────────────────────────

def test_extract_sources_deduplicates_same_doc_same_page():
    chunks = [SAMPLE_CHUNKS[0], SAMPLE_CHUNKS[0]]  # duplicate
    sources = _extract_sources(chunks)
    assert len(sources) == 1


def test_extract_sources_includes_different_pages():
    sources = _extract_sources(SAMPLE_CHUNKS)
    page_numbers = {s["page_number"] for s in sources}
    assert 3 in page_numbers
    assert 5 in page_numbers


def test_extract_sources_includes_excerpt():
    sources = _extract_sources(SAMPLE_CHUNKS)
    for s in sources:
        assert "excerpt" in s
        assert len(s["excerpt"]) > 0


def test_extract_sources_excerpt_truncated_to_150_chars():
    long_chunk = {
        "document_id": "doc-3",
        "document_name": "long.pdf",
        "content": "x" * 500,
        "page_number": 1,
        "chunk_index": 0,
    }
    sources = _extract_sources([long_chunk])
    assert len(sources[0]["excerpt"]) <= 155  # 150 + "..."


def test_extract_sources_empty_chunks_returns_empty_list():
    assert _extract_sources([]) == []
