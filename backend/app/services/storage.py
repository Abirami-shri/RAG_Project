from __future__ import annotations

import uuid
from datetime import datetime, timezone

from azure.storage.blob.aio import BlobServiceClient

from app.config import settings
from app.models.schemas import DocumentMetadata


class StorageService:
    def __init__(self) -> None:
        self._client = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )

    async def upload_file(
        self, file_bytes: bytes, filename: str, content_type: str
    ) -> DocumentMetadata:
        doc_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        blob_name = f"{doc_id}/{filename}"
        async with self._client.get_blob_client(
            settings.azure_storage_documents_container, blob_name
        ) as blob:
            await blob.upload_blob(file_bytes, content_type=content_type, overwrite=True)

        meta = DocumentMetadata(
            id=doc_id,
            name=filename,
            original_name=filename,
            content_type=content_type,
            size_bytes=len(file_bytes),
            status="uploading",
            chunk_count=0,
            created_at=now,
            updated_at=now,
        )
        await self._write_metadata(meta)
        return meta

    async def get_file_bytes(self, document_id: str, filename: str) -> bytes:
        blob_name = f"{document_id}/{filename}"
        async with self._client.get_blob_client(
            settings.azure_storage_documents_container, blob_name
        ) as blob:
            stream = await blob.download_blob()
            return await stream.readall()

    async def list_documents(self) -> list[DocumentMetadata]:
        container = self._client.get_container_client(
            settings.azure_storage_metadata_container
        )
        docs: list[DocumentMetadata] = []
        async for blob in container.list_blobs():
            doc_id = blob.name.removesuffix(".json")
            meta = await self._read_metadata(doc_id)
            if meta:
                docs.append(meta)
        return sorted(docs, key=lambda d: d.created_at, reverse=True)

    async def get_metadata(self, document_id: str) -> DocumentMetadata | None:
        return await self._read_metadata(document_id)

    async def update_status(
        self,
        document_id: str,
        status: str,
        chunk_count: int = 0,
        error: str | None = None,
    ) -> None:
        meta = await self._read_metadata(document_id)
        if not meta:
            return
        meta.status = status  # type: ignore[assignment]
        meta.chunk_count = chunk_count
        meta.error_message = error
        meta.updated_at = datetime.now(timezone.utc)
        await self._write_metadata(meta)

    async def delete_document(self, document_id: str, filename: str) -> None:
        blob_name = f"{document_id}/{filename}"
        async with self._client.get_blob_client(
            settings.azure_storage_documents_container, blob_name
        ) as blob:
            await blob.delete_blob(delete_snapshots="include")

        async with self._client.get_blob_client(
            settings.azure_storage_metadata_container, f"{document_id}.json"
        ) as blob:
            await blob.delete_blob()

    async def ensure_containers(self) -> None:
        for name in (
            settings.azure_storage_documents_container,
            settings.azure_storage_metadata_container,
        ):
            container = self._client.get_container_client(name)
            try:
                await container.create_container()
            except Exception:
                pass  # already exists

    async def ping(self) -> bool:
        try:
            container = self._client.get_container_client(
                settings.azure_storage_documents_container
            )
            await container.get_container_properties()
            return True
        except Exception:
            return False

    async def _write_metadata(self, meta: DocumentMetadata) -> None:
        data = meta.model_dump_json().encode()
        async with self._client.get_blob_client(
            settings.azure_storage_metadata_container, f"{meta.id}.json"
        ) as blob:
            await blob.upload_blob(data, overwrite=True)

    async def _read_metadata(self, document_id: str) -> DocumentMetadata | None:
        try:
            async with self._client.get_blob_client(
                settings.azure_storage_metadata_container, f"{document_id}.json"
            ) as blob:
                stream = await blob.download_blob()
                data = await stream.readall()
                return DocumentMetadata.model_validate_json(data)
        except Exception:
            return None
