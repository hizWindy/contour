"""The Lead Finder's own tables, in the lead_finder schema."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Integer, Numeric, String, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base

SCHEMA = "lead_finder"


class Lead(Base):
    """One researched company: its result, score and full lead card."""

    __tablename__ = "leads"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    company: Mapped[str] = mapped_column(String(300), index=True)
    city: Mapped[str | None] = mapped_column(String(120))
    result: Mapped[str] = mapped_column(String(32), index=True)  # pass, director_review, ...
    score: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), server_default="new")  # new, sent, ...
    hubspot_status: Mapped[str] = mapped_column(String(32))
    hubspot_id: Mapped[str | None] = mapped_column(String(32))
    card: Mapped[dict[str, Any]] = mapped_column(JSONB)  # facts, sources, rule checks
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    web_searches: Mapped[int] = mapped_column(Integer)
    rules_version: Mapped[str] = mapped_column(String(32))
    prompt_version: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
