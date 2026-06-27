"""Unit tests for chunk_text() in document_processor.py"""
import pytest
from app.services.document_processor import chunk_text


def test_empty_text_returns_empty_list():
    assert chunk_text("", size=1000, overlap=200) == []


def test_whitespace_only_returns_empty_list():
    assert chunk_text("   \n\n  ", size=1000, overlap=200) == []


def test_short_text_returns_single_chunk():
    text = "Hello world"
    result = chunk_text(text, size=1000, overlap=200)
    assert result == ["Hello world"]


def test_text_exactly_at_size_returns_single_chunk():
    text = "a" * 1000
    result = chunk_text(text, size=1000, overlap=200)
    assert len(result) == 1


def test_chunks_respect_size_limit():
    text = "word " * 500  # 2500 chars
    result = chunk_text(text, size=500, overlap=50)
    assert all(len(c) <= 500 + 50 for c in result)  # slight slack for overlap


def test_long_text_produces_multiple_chunks():
    text = "word " * 500
    result = chunk_text(text, size=300, overlap=50)
    assert len(result) > 1


def test_prefers_paragraph_splits():
    text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
    result = chunk_text(text, size=30, overlap=0)
    assert any("First paragraph" in c for c in result)
    assert any("Second paragraph" in c for c in result)
    assert any("Third paragraph" in c for c in result)


def test_overlap_carries_content_across_chunks():
    text = "A " * 300 + "B " * 300
    result = chunk_text(text, size=300, overlap=100)
    # At least one chunk should contain both A and B due to overlap
    assert any("A" in c and "B" in c for c in result)


def test_no_overlap_produces_clean_splits():
    text = "Para one.\n\nPara two.\n\nPara three.\n\nPara four."
    result = chunk_text(text, size=20, overlap=0)
    assert len(result) >= 2


def test_single_word_longer_than_size_is_handled():
    text = "a" * 2000
    result = chunk_text(text, size=500, overlap=0)
    assert len(result) > 1
    assert all(len(c) <= 500 for c in result)
