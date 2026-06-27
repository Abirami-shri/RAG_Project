from __future__ import annotations

from azure.core.credentials import AzureKeyCredential
from azure.search.documents.aio import SearchClient
from azure.search.documents.indexes.aio import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
    SearchField,
    SearchFieldDataType,
    SearchIndex,
    SearchableField,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)
from azure.search.documents.models import VectorizedQuery

from app.config import settings


class SearchService:
    def __init__(self) -> None:
        cred = AzureKeyCredential(settings.azure_search_api_key)
        self._index_client = SearchIndexClient(settings.azure_search_endpoint, cred)
        self._search_client = SearchClient(
            settings.azure_search_endpoint,
            settings.azure_search_index_name,
            cred,
        )

    async def ensure_index(self) -> None:
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SimpleField(
                name="document_id",
                type=SearchFieldDataType.String,
                filterable=True,
                retrievable=True,
            ),
            SimpleField(name="document_name", type=SearchFieldDataType.String, retrievable=True),
            SearchableField(name="content", type=SearchFieldDataType.String, retrievable=True),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=1536,
                vector_search_profile_name="hnsw-profile",
            ),
            SimpleField(name="page_number", type=SearchFieldDataType.Int32, retrievable=True),
            SimpleField(name="chunk_index", type=SearchFieldDataType.Int32, retrievable=True),
            SimpleField(
                name="created_at", type=SearchFieldDataType.DateTimeOffset, retrievable=True
            ),
        ]
        vector_search = VectorSearch(
            algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
            profiles=[
                VectorSearchProfile(
                    name="hnsw-profile", algorithm_configuration_name="hnsw"
                )
            ],
        )
        index = SearchIndex(
            name=settings.azure_search_index_name,
            fields=fields,
            vector_search=vector_search,
        )
        await self._index_client.create_or_update_index(index)

    async def upsert_chunks(self, chunks: list[dict]) -> None:
        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            await self._search_client.upload_documents(documents=chunks[i : i + batch_size])

    async def search(
        self,
        query: str,
        query_vector: list[float],
        document_ids: list[str] | None = None,
        top: int = 5,
    ) -> list[dict]:
        filter_expr: str | None = None
        if document_ids:
            escaped = [d.replace("'", "''") for d in document_ids]
            clauses = " or ".join(f"document_id eq '{d}'" for d in escaped)
            filter_expr = f"({clauses})"

        vector_query = VectorizedQuery(
            vector=query_vector,
            k_nearest_neighbors=top,
            fields="content_vector",
        )

        results = await self._search_client.search(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expr,
            top=top,
            select=[
                "id",
                "document_id",
                "document_name",
                "content",
                "page_number",
                "chunk_index",
            ],
        )
        return [dict(r) async for r in results]

    async def delete_document_chunks(self, document_id: str) -> None:
        results = await self._search_client.search(
            search_text="*",
            filter=f"document_id eq '{document_id}'",
            select=["id"],
            top=1000,
        )
        ids = [{"id": r["id"]} async for r in results]
        if ids:
            await self._search_client.delete_documents(documents=ids)

    async def ping(self) -> bool:
        try:
            await self._search_client.get_document_count()
            return True
        except Exception:
            return False
