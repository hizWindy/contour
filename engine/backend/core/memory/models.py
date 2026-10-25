"""The memory table: each row is a piece of text plus its 384 numbers from FastEmbed."""

import uuid
from datetime import date, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import CheckConstraint, Date, DateTime, Index, String, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base

# Set by the model (BAAI/bge-small-en-v1.5). A different model needs a migration.
EMBEDDING_DIM = 384

MEMORY_KINDS = ("source_note", "company_profile", "lead_outcome", "note")


class MemoryItem(Base):
    __tablename__ = "memory"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('source_note', 'company_profile', 'lead_outcome', 'note')", name="kind"
        ),
        Index("ix_memory_app_kind", "app", "kind"),
        Index(
            "ix_memory_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    app: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str | None] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    source_date: Mapped[date | None] = mapped_column(Date)
    meta: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    embedding: Mapped[Any] = mapped_column(Vector(EMBEDDING_DIM))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
