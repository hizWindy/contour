"""The tools' tables (PLAN-V16 T2-4), in the `core` schema, so call prep can read them later.

- `core.property_records`: our copy of what the tools told us. One row is one `PropertyRecord`
  (`types.py`), saved once: `record_key` is a hash of the fields that say which fact it is, so
  reading the same item again changes nothing. `company_key` is the company's name cleaned the way
  HubSpot matching cleans it (`clean_name`). `via` says how it came: the daily feed, the lease
  endings view, or a lookup of one company. `ref` is the tool's own id for the item, like
  `report:1965`.
- `core.property_lookups`: the 30-day memory. One row for each tool and company: when we last
  asked the tool live, what it said, and how many records it gave.
- `core.source_reads`: one row for every page a tool served us: the kind of page, when, how it
  went and how long it took. Never the page's content. It counts the pages of a day and of a run.
- `core.source_state`: one row for each tool: a 24-hour pause after a block (`paused_until`, and
  why), the last problem, and the last good sign-in.

No row holds an email address, a phone number or a person's name.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import Uuid as SaUuid
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base

SOURCES = ("property_daily", "arealytics")
KINDS = ("lease", "move", "requirement", "fitout", "building", "occupier", "news")
VIAS = ("feed", "lease_endings", "lookup")
LOOKUP_STATUSES = ("found", "not_found", "error")
# How a page went. `ok` and `not_found` are good reads; the rest are problems. The stop rules
# (core.browser.stops) pause the tool for `captcha`, `lockout`, `forbidden`, `rate_limited` and
# `signin_twice`.
OUTCOMES = (
    "ok",
    "not_found",
    "signin_page",
    "signin_failed",
    "signin_twice",
    "captcha",
    "lockout",
    "forbidden",
    "rate_limited",
    "timeout",
    "error",
)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class PropertyRecordRow(Base):
    __tablename__ = "property_records"
    __table_args__ = (
        CheckConstraint(_in_list("source", SOURCES), name="source"),
        CheckConstraint(_in_list("kind", KINDS), name="kind"),
        CheckConstraint(_in_list("via", VIAS), name="via"),
        CheckConstraint("area_m2 IS NULL OR area_m2 >= 0", name="area_m2"),
        UniqueConstraint("source", "record_key", name="uq_property_records_record"),
        Index("ix_property_records_company_key", "company_key"),
        # recent_items: the newest feed items, for some cities.
        Index("ix_property_records_via_read_at", "via", "read_at"),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(SaUuid, primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(16))
    via: Mapped[str] = mapped_column(String(16))
    company: Mapped[str] = mapped_column(Text)  # as the tool wrote it
    company_key: Mapped[str] = mapped_column(Text)  # clean_name(company)
    city: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    building: Mapped[str | None] = mapped_column(Text)
    floor: Mapped[str | None] = mapped_column(Text)
    area_m2: Mapped[int | None] = mapped_column(Integer)
    lease_start: Mapped[date | None] = mapped_column(Date)
    lease_end: Mapped[date | None] = mapped_column(Date)
    happened_on: Mapped[date | None] = mapped_column(Date)
    published_on: Mapped[date | None] = mapped_column(Date)
    summary: Mapped[str] = mapped_column(Text)  # one plain sentence, written by our code
    url: Mapped[str] = mapped_column(Text)
    ref: Mapped[str | None] = mapped_column(String(64))  # the tool's id, like "report:1965"
    record_key: Mapped[str] = mapped_column(String(64))  # a hash: the same fact is saved once
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class PropertyLookup(Base):
    __tablename__ = "property_lookups"
    __table_args__ = (
        CheckConstraint(_in_list("source", SOURCES), name="source"),
        CheckConstraint(_in_list("status", LOOKUP_STATUSES), name="status"),
        CheckConstraint("records >= 0", name="records"),
        {"schema": CORE_SCHEMA},
    )

    source: Mapped[str] = mapped_column(String(20), primary_key=True)
    company_key: Mapped[str] = mapped_column(Text, primary_key=True)
    company: Mapped[str] = mapped_column(Text)  # the name that was asked for
    city: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    records: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    looked_up_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    run_id: Mapped[uuid.UUID | None] = mapped_column(SaUuid)


class SourceRead(Base):
    __tablename__ = "source_reads"
    __table_args__ = (
        CheckConstraint(_in_list("source", SOURCES), name="source"),
        CheckConstraint(_in_list("outcome", OUTCOMES), name="outcome"),
        CheckConstraint("ms >= 0", name="ms"),
        # The pages of a day, for one tool.
        Index("ix_source_reads_source_at", "source", "at"),
        # The pages of a run.
        Index("ix_source_reads_run_id", "run_id", postgresql_where=text("run_id IS NOT NULL")),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    source: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(24))  # like "signin", "search" or "report"
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    ok: Mapped[bool] = mapped_column(Boolean)
    outcome: Mapped[str] = mapped_column(String(16))
    ms: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[uuid.UUID | None] = mapped_column(SaUuid)


class SourceState(Base):
    __tablename__ = "source_state"
    __table_args__ = (
        CheckConstraint(_in_list("source", SOURCES), name="source"),
        CheckConstraint(
            f"pause_reason IS NULL OR {_in_list('pause_reason', OUTCOMES)}", name="pause_reason"
        ),
        CheckConstraint(
            f"last_problem IS NULL OR {_in_list('last_problem', OUTCOMES)}", name="last_problem"
        ),
        {"schema": CORE_SCHEMA},
    )
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    source: Mapped[str] = mapped_column(String(20), primary_key=True)
    paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pause_reason: Mapped[str | None] = mapped_column(String(16))
    last_problem: Mapped[str | None] = mapped_column(String(16))
    last_problem_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signed_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=func.now()
    )
