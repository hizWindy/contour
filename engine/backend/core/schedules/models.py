"""The schedules table (core.schedules): jobs that start on their own. PLAN-V6 D1.

One row for each job (the key is the job's name, like `lead_finder.discovery`). A row says how
often and when (`every`, `unit`, `weekday`, `at_time`, `timezone`: see `core.schedules.calc`),
whether it is switched on, when it runs next, and how the last start went.

Two rules the table itself keeps:
- **On means it has a next time, and off means it has none** (`enabled` and `next_run_at` go
  together), so a schedule that is off can never be picked up as due.
- **A schedule in weeks has a weekday, and one in days has none.**

`last_status` is `starting` while the job is being started (a backend that stopped there marks it
failed at its next start), then `started` (a run or sync was made: `last_ref` is its id), `skipped`
(it didn't start, for a reason in plain words in `last_error`, like "It is still running") or
`failed` (it couldn't start; the details are in the backend log).
"""

import uuid
from datetime import datetime, time
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    func,
    text,
)
from sqlalchemy import Uuid as SaUuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base

UNITS = ("days", "weeks")
LAST_STATUSES = ("starting", "started", "skipped", "failed")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class Schedule(Base):
    __tablename__ = "schedules"
    __table_args__ = (
        CheckConstraint("every >= 1", name="every"),
        CheckConstraint(_in_list("unit", UNITS), name="unit"),
        CheckConstraint("weekday IS NULL OR weekday BETWEEN 0 AND 6", name="weekday_range"),
        CheckConstraint("(unit = 'weeks') = (weekday IS NOT NULL)", name="weekday"),
        CheckConstraint("enabled = (next_run_at IS NOT NULL)", name="next_run"),
        CheckConstraint(
            f"last_status IS NULL OR {_in_list('last_status', LAST_STATUSES)}", name="last_status"
        ),
        # What the loop looks up every minute: what is on and due.
        Index("ix_schedules_due", "next_run_at", postgresql_where=text("enabled")),
        {"schema": CORE_SCHEMA},
    )
    # After an UPDATE, fetch `updated_at` in the same statement (see core.prefs.models.Setting).
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(SaUuid, primary_key=True, default=uuid.uuid4)
    project: Mapped[str] = mapped_column(String(64))  # "lead_finder", or "core"
    job: Mapped[str] = mapped_column(String(64), unique=True)  # like "lead_finder.discovery"
    name: Mapped[str] = mapped_column(String(120))  # what the Schedules page shows
    settings: Mapped[dict[str, Any]] = mapped_column(  # the job's own choices
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    every: Mapped[int] = mapped_column(Integer)
    unit: Mapped[str] = mapped_column(String(8))
    weekday: Mapped[int | None] = mapped_column(SmallInteger)  # 0 Monday to 6 Sunday
    at_time: Mapped[time] = mapped_column(Time)  # the wall clock in `timezone`
    timezone: Mapped[str] = mapped_column(String(64), server_default="Australia/Melbourne")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(16))
    last_ref: Mapped[str | None] = mapped_column(String(64))  # the run id or sync id, as text
    last_error: Mapped[str | None] = mapped_column(Text)  # why it didn't start, in plain words
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=func.now()
    )
