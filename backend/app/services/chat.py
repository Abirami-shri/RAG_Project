from __future__ import annotations

import json
from typing import AsyncGenerator

from openai import AsyncAzureOpenAI

from app.config import settings
from app.services.search import SearchService

_SYSTEM_PROMPT = """\
You are Second Brain, a knowledge assistant that answers questions \
strictly based on the user's uploaded documents.

Rules:
- Only use information from the CONTEXT sections provided below.
- If the context does not contain enough information to answer, respond with:
  "I couldn't find relevant information in your documents for this question."
- Always cite your sources using the format: [Source: <document_name>, p.<page>]
  If the page number is unknown, omit the page part.
- Be concise and accurate. Do not speculate beyond the provided context.
- If multiple documents are relevant, synthesise the information and cite each.

CONTEXT:
{context}"""


class ChatService:
    def __init__(self, search_service: SearchService) -> None:
        self._search = search_service
        self._openai = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version=settings.azure_openai_api_version,
        )

    async def embed(self, text: str) -> list[float]:
        response = await self._openai.embeddings.create(
            model=settings.azure_openai_embedding_deployment,
            input=text,
        )
        return response.data[0].embedding

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = await self._openai.embeddings.create(
            model=settings.azure_openai_embedding_deployment,
            input=texts,
        )
        ordered = sorted(response.data, key=lambda x: x.index)
        return [item.embedding for item in ordered]

    async def stream_response(
        self,
        message: str,
        history: list[dict],
        document_ids: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        # 1. Embed the user query
        query_vector = await self.embed(message)

        # 2. Hybrid search
        chunks = await self._search.search(
            query=message,
            query_vector=query_vector,
            document_ids=document_ids,
            top=settings.top_k_results,
        )

        # 3. Build prompt
        context = _format_context(chunks)
        system_content = _SYSTEM_PROMPT.format(context=context)

        messages: list[dict] = [{"role": "system", "content": system_content}]
        for turn in history[-10:]:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": message})

        # 4. Stream completion
        stream = await self._openai.chat.completions.create(
            model=settings.azure_openai_chat_deployment,
            messages=messages,  # type: ignore[arg-type]
            stream=True,
            temperature=0.1,
            max_tokens=1500,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                delta = chunk.choices[0].delta.content
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"

        # 5. Emit sources then done
        sources = _extract_sources(chunks)
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    async def ping(self) -> bool:
        try:
            await self._openai.embeddings.create(
                model=settings.azure_openai_embedding_deployment,
                input="ping",
            )
            return True
        except Exception:
            return False


def _format_context(chunks: list[dict]) -> str:
    if not chunks:
        return "No relevant context found."
    parts: list[str] = []
    for i, chunk in enumerate(chunks, 1):
        page = f", p.{chunk['page_number']}" if chunk.get("page_number") else ""
        parts.append(f"[{i}] {chunk['document_name']}{page}:\n{chunk['content']}")
    return "\n\n---\n\n".join(parts)


def _extract_sources(chunks: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    sources: list[dict] = []
    for chunk in chunks:
        key = (chunk["document_id"], chunk.get("page_number"))
        if key not in seen:
            seen.add(key)
            sources.append(
                {
                    "document_id": chunk["document_id"],
                    "document_name": chunk["document_name"],
                    "page_number": chunk.get("page_number"),
                    "excerpt": chunk["content"][:150] + "...",
                }
            )
    return sources
