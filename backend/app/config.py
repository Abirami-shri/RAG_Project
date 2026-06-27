from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    # Azure Blob Storage
    azure_storage_connection_string: str = ""
    azure_storage_documents_container: str = "documents"
    azure_storage_metadata_container: str = "metadata"

    # Azure AI Search
    azure_search_endpoint: str = ""
    azure_search_api_key: str = ""
    azure_search_index_name: str = "second-brain-chunks"

    # Azure OpenAI
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_api_version: str = "2024-02-15-preview"
    azure_openai_embedding_deployment: str = "text-embedding-ada-002"
    azure_openai_chat_deployment: str = "gpt-4o"

    # Azure Document Intelligence (optional)
    azure_document_intelligence_endpoint: str = ""
    azure_document_intelligence_key: str = ""

    # App
    cors_origins: list[str] = ["*"]
    max_file_size_mb: int = 50
    chunk_size: int = 1000
    chunk_overlap: int = 200
    top_k_results: int = 5
    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, v: object) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v  # type: ignore[return-value]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
