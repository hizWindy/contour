"""The one settings object. It reads engine/.env. Nothing else reads environment variables."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENGINE_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENGINE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database (Docker, see engine/docker-compose.yml)
    postgres_user: str = "leadfinder"
    postgres_password: SecretStr = SecretStr("")
    postgres_db: str = "leadfinder"
    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5433

    # Projects to load, by folder name in apps/
    apps: list[str] = ["lead_finder"]

    # API
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173"]
    auto_migrate: bool = True

    # Memory (FastEmbed runs on this computer)
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_cache_dir: Path = BACKEND_DIR / ".cache" / "fastembed"

    # Claude, used from Phase 1
    anthropic_api_key: SecretStr | None = None

    def database_url(self, database: str | None = None) -> str:
        """The SQLAlchemy address for psycopg 3. Works for both sync and async engines."""
        password = quote(self.postgres_password.get_secret_value(), safe="")
        name = database or self.postgres_db
        return (
            f"postgresql+psycopg://{self.postgres_user}:{password}"
            f"@{self.postgres_host}:{self.postgres_port}/{name}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
