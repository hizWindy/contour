"""The search log: every Claude request, what it searched, what it found, and its cost."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base


class SearchLog(Base):
    __tablename__ = "searches"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    app: Mapped[str] = mapped_column(String(64))
    job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)  # a run, or one research
    subject: Mapped[str | None] = mapped_column(String(300), index=True)  # like a company name
    step: Mapped[str] = mapped_column(String(64))  # like "search:property" or "extract"
    model: Mapped[str] = mapped_column(String(64))
    prompt_version: Mapped[str | None] = mapped_column(String(32))
    queries: Mapped[list[str]] = mapped_column(JSONB, default=list)
    sources: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    web_searches: Mapped[int] = mapped_column(Integer, default=0)
    web_fetches: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    stop_reason: Mapped[str | None] = mapped_column(String(32))
    answer_ok: Mapped[bool] = mapped_column(Boolean)  # the answer fitted the form
    request_id: Mapped[str | None] = mapped_column(String(128))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
