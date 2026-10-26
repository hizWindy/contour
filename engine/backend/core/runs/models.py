"""The run log: one row per run (core.runs) and its append-only event stream (core.run_events).

A run is one job a project asks the engine to do, like "find leads in Melbourne". The row holds
the caps it started with, what it has cost so far and how it ended. The events are what the
website shows live, and what it replays after a reconnect.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base

# queued: saved, not started. interrupted: the backend stopped while it was going.
RUN_STATUSES = ("queued", "running", "done", "failed", "cancelled", "interrupted")
TERMINAL_RUN_STATUSES = ("done", "failed", "cancelled", "interrupted")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(_in_list("status", RUN_STATUSES), name="status"),
        Index("ix_runs_app_created_at", "app", text("created_at DESC")),
        Index("ix_runs_status", "status"),
        # A repeated Idempotency-Key finds the same run. Runs without a key don't compete.
        Index(
            "uq_runs_idempotency_key",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    app: Mapped[str] = mapped_column(String(64))
    mode: Mapped[str] = mapped_column(String(32))  # like "discovery" or "watchlist"
    status: Mapped[str] = mapped_column(String(16), server_default="queued")
    params: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    caps: Mapped[dict[str, Any]] = mapped_column(  # a RunCaps: the limits this run started with
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    rules_version: Mapped[str] = mapped_column(String(32), server_default="")
    prompt_versions: Mapped[str] = mapped_column(String(128), server_default="")
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), default=Decimal(0), server_default=text("0")
    )
    web_searches: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    claude_requests: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    counts: Mapped[dict[str, Any]] = mapped_column(  # a RunCounts: companies found, researched, ...
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    stop_reason: Mapped[str | None] = mapped_column(String(120))  # plain words, shown to people
    error: Mapped[str | None] = mapped_column(Text)  # plain words only, never a raw exception
    error_id: Mapped[str | None] = mapped_column(String(16))  # finds the traceback in the log
    idempotency_key: Mapped[str | None] = mapped_column(String(64))
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RunEvent(Base):
    """One thing that happened in a run. Append only: rows are never changed."""

    __tablename__ = "run_events"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.runs.id", ondelete="CASCADE"), primary_key=True
    )
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)  # 1, 2, 3...
    type: Mapped[str] = mapped_column(String(32))  # like "company_done"
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
