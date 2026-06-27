from __future__ import annotations

import io

from app.config import settings

SUPPORTED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
}


def extract_text(file_bytes: bytes, content_type: str) -> str:
    if content_type == "application/pdf":
        return _extract_pdf(file_bytes)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(file_bytes)
    if content_type in ("text/plain", "text/markdown"):
        return file_bytes.decode("utf-8", errors="replace")
    raise ValueError(f"Unsupported content type: {content_type}")


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []
    if len(stripped) <= size:
        return [stripped]
    return _recursive_split(stripped, size, overlap, ["\n\n", "\n", ". ", " ", ""])


def _extract_pdf(file_bytes: bytes) -> str:
    if settings.azure_document_intelligence_endpoint:
        try:
            return _extract_pdf_document_intelligence(file_bytes)
        except Exception:
            pass  # fall through to PyPDF2
    return _extract_pdf_pypdf2(file_bytes)


def _extract_pdf_pypdf2(file_bytes: bytes) -> str:
    import PyPDF2

    reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n\n".join(p for p in pages if p.strip())


def _extract_pdf_document_intelligence(file_bytes: bytes) -> str:
    from azure.ai.formrecognizer import DocumentAnalysisClient
    from azure.core.credentials import AzureKeyCredential

    client = DocumentAnalysisClient(
        endpoint=settings.azure_document_intelligence_endpoint,
        credential=AzureKeyCredential(settings.azure_document_intelligence_key),
    )
    poller = client.begin_analyze_document("prebuilt-read", file_bytes)
    result = poller.result()
    return "\n\n".join(page.content for page in result.pages if page.content)


def _extract_docx(file_bytes: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _recursive_split(text: str, size: int, overlap: int, seps: list[str]) -> list[str]:
    if len(text) <= size:
        return [text]

    sep = next((s for s in seps if s in text), "")

    if not sep:
        # Hard character split as last resort
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = min(start + size, len(text))
            chunks.append(text[start:end])
            start += size - overlap
        return chunks

    parts = text.split(sep)
    chunks = []
    current = ""

    for part in parts:
        candidate = (current + sep + part).strip() if current else part.strip()
        if len(candidate) <= size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            # Part itself may be too large — recurse with next separator
            remaining_seps = seps[seps.index(sep) + 1 :] if sep in seps else []
            if len(part) > size and remaining_seps:
                chunks.extend(_recursive_split(part.strip(), size, overlap, remaining_seps))
                current = ""
            else:
                current = part.strip()

    if current:
        chunks.append(current)

    # Apply overlap by carrying tail of previous chunk into next
    if overlap > 0 and len(chunks) > 1:
        overlapped: list[str] = [chunks[0]]
        for i in range(1, len(chunks)):
            tail = overlapped[-1][-overlap:]
            overlapped.append((tail + sep + chunks[i]).strip())
        return overlapped

    return chunks
