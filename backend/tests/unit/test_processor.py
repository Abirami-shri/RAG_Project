"""Unit tests for extract_text() in document_processor.py"""
import io
import pytest
from app.services.document_processor import extract_text


def test_extract_plain_text():
    content = b"Hello, world."
    result = extract_text(content, "text/plain")
    assert result == "Hello, world."


def test_extract_markdown():
    content = b"# Title\n\nSome **bold** text."
    result = extract_text(content, "text/markdown")
    assert "Title" in result
    assert "bold" in result


def test_extract_plain_text_with_unicode():
    content = "Héllo wörld — 日本語".encode("utf-8")
    result = extract_text(content, "text/plain")
    assert "Héllo" in result
    assert "日本語" in result


def test_extract_plain_text_replaces_bad_bytes():
    content = b"Good text \xff bad byte"
    result = extract_text(content, "text/plain")
    assert "Good text" in result  # should not raise


def test_unsupported_type_raises_value_error():
    with pytest.raises(ValueError, match="Unsupported content type"):
        extract_text(b"data", "image/gif")


def test_unsupported_type_raises_for_csv():
    with pytest.raises(ValueError, match="Unsupported content type"):
        extract_text(b"a,b,c", "text/csv")


def test_extract_pdf_returns_string(tmp_path):
    """Smoke test: a valid minimal PDF extracts without error."""
    pytest.importorskip("fpdf", reason="fpdf2 not installed — skipping PDF extraction smoke test")
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.cell(200, 10, "RAG pipeline test document")
    pdf_bytes = pdf.output()

    result = extract_text(bytes(pdf_bytes), "application/pdf")
    assert isinstance(result, str)
