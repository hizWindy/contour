"""The local copy of HubSpot data, and the logs of what we read from and wrote to HubSpot.

Contacts are never stored here, and neither is an owner's email.

- `hubspot_companies`, `hubspot_offices`, `hubspot_deals`: our copy. An export upload fills
  them with `source` "export"; the sync (sync.py) with "api". A company from either is replaced
  by the next one with the same `hubspot_id`. Offices are company fields in HubSpot, one group
  per city, so an office has no id of its own and is replaced with its company.
- `hubspot_owners`: who owns records, so a company shows a name instead of an owner id.
- `hubspot_syncs`: one row per sync, with its counts and any error (PLAN-V5 B4).
- `hubspot_writes`: one row per write a person asked for, from preview to result (B5).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
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

SOURCES = ("export", "api")
SYNC_MODES = ("full", "changes")
SYNC_TRIGGERS = ("command", "website", "startup")
# running: reading or saving now. interrupted: the backend stopped while it ran.
SYNC_STATUSES = ("running", "done", "failed", "interrupted")
# previewed: shown to a person, nothing written. writing: being written now. done: every step
# landed. partial: some steps landed and some failed. failed: nothing landed. uncertain: a step
# may or may not have landed (HubSpot didn't answer), so nothing more is sent until it is checked.
WRITE_STATUSES = ("previewed", "writing", "done", "partial", "failed", "uncertain")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _zero() -> Any:
    return mapped_column(Integer, default=0, server_default=text("0"))


class HubSpotCompany(Base):
    __tablename__ = "hubspot_companies"
    __table_args__ = (
        CheckConstraint(_in_list("source", SOURCES), name="source"),
        {"schema": CORE_SCHEMA},
    )

    hubspot_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    website: Mapped[str | None] = mapped_column(String(300))
    domain: Mapped[str | None] = mapped_column(String(255), index=True)
    phone: Mapped[str | None] = mapped_column(String(64))
    street: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(3))  # VIC, SA, WA, ...
    state_raw: Mapped[str | None] = mapped_column(String(64))  # as typed in HubSpot
    postal_code: Mapped[str | None] = mapped_column(String(16))
    country: Mapped[str | None] = mapped_column(String(80))
    industry: Mapped[str | None] = mapped_column(String(120))  # the label, like "Computer Software"
    employees: Mapped[int | None] = mapped_column(Integer)
    linkedin_staff_au: Mapped[int | None] = mapped_column(Integer)
    offices_on_record: Mapped[str | None] = mapped_column(Text)
    lifecycle_stage: Mapped[str | None] = mapped_column(String(64))  # the label, like "Lead"
    owner: Mapped[str | None] = mapped_column(String(120))  # the owner's name
    owner_id: Mapped[str | None] = mapped_column(String(32))  # api rows: core.hubspot_owners
    created_in_hubspot: Mapped[date | None] = mapped_column(Date)
    last_contacted: Mapped[date | None] = mapped_column(Date)
    contacts_count: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    hubspot_url: Mapped[str | None] = mapped_column(Text)
    hubspot_updated_at: Mapped[datetime | None] = mapped_column(  # last changed in HubSpot
        DateTime(timezone=True)
    )
    source: Mapped[str] = mapped_column(String(16))  # "export" or "api"
    imported_at: Mapped[datetime] = mapped_column(  # when our copy of it was saved
        DateTime(timezone=True), server_default=text("now()")
    )


class HubSpotOffice(Base):
    __tablename__ = "hubspot_offices"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    hubspot_company_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey(f"{CORE_SCHEMA}.hubspot_companies.hubspot_id", ondelete="CASCADE"),
        index=True,
    )
    label: Mapped[str] = mapped_column(String(64))  # the office's name in HubSpot, like "Perth"
    level: Mapped[str | None] = mapped_column(String(64))
    street: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(120))
    postal_code: Mapped[str | None] = mapped_column(String(16))
    phone: Mapped[str | None] = mapped_column(String(64))
    last_moved: Mapped[date | None] = mapped_column(Date)
    lease_expiry: Mapped[date | None] = mapped_column(Date)
    linkedin_staff: Mapped[int | None] = mapped_column(Integer)
    # From the API only (the export has none of these). Not used by any rule yet.
    office_m2: Mapped[Decimal | None] = mapped_column(Numeric(10, 1))  # "Office Space Size"
    size_bracket: Mapped[str | None] = mapped_column(String(32))  # like "500-750 sqm"
    quality: Mapped[str | None] = mapped_column(String(32))  # like "Needs an Upgrade"
    staff_count_text: Mapped[str | None] = mapped_column(String(64))  # "Number of Staff", as typed


class HubSpotDeal(Base):
    __tablename__ = "hubspot_deals"
    __table_args__ = (
        CheckConstraint(_in_list("source", SOURCES), name="source"),
        {"schema": CORE_SCHEMA},
    )

    hubspot_deal_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hubspot_company_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey(f"{CORE_SCHEMA}.hubspot_companies.hubspot_id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(300))
    # The stage's label, like "Dissolved". It always comes from the pipeline's own list, never
    # from the id: some ids reuse HubSpot's built-in names for other stages (contractsent is
    # Contour's "Dissolved").
    stage: Mapped[str | None] = mapped_column(String(64))
    stage_id: Mapped[str | None] = mapped_column(String(64))  # api rows only
    pipeline: Mapped[str | None] = mapped_column(String(120))  # its label, like "Sales Pipeline"
    amount_aud: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    close_date: Mapped[date | None] = mapped_column(Date)
    owner: Mapped[str | None] = mapped_column(String(120))
    owner_id: Mapped[str | None] = mapped_column(String(32))
    created_in_hubspot: Mapped[date | None] = mapped_column(Date)
    last_contacted: Mapped[date | None] = mapped_column(Date)
    next_step: Mapped[str | None] = mapped_column(Text)
    hubspot_url: Mapped[str | None] = mapped_column(Text)
    hubspot_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(16), server_default="export")
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class HubSpotOwner(Base):
    """A HubSpot user who can own records. The name only: never an email."""

    __tablename__ = "hubspot_owners"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    owner_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(200))
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class HubSpotSync(Base):
    """One sync: what it read, what it saved, and how it ended."""

    __tablename__ = "hubspot_syncs"
    __table_args__ = (
        CheckConstraint(_in_list("mode", SYNC_MODES), name="mode"),
        CheckConstraint(_in_list("trigger", SYNC_TRIGGERS), name="trigger"),
        CheckConstraint(_in_list("status", SYNC_STATUSES), name="status"),
        CheckConstraint("(status = 'running') = (finished_at IS NULL)", name="finished"),
        Index("ix_hubspot_syncs_started_at", text("started_at DESC")),
        # Only one sync runs at a time, whoever starts it (the website, the command, start-up).
        Index(
            "uq_hubspot_syncs_running",
            "status",
            unique=True,
            postgresql_where=text("status = 'running'"),
        ),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    mode: Mapped[str] = mapped_column(String(16))  # full or changes
    trigger: Mapped[str] = mapped_column(String(16))  # command, website or startup
    status: Mapped[str] = mapped_column(String(16), server_default="running")
    # For a changes sync: records changed in HubSpot at or after this time were read.
    changed_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    companies_read: Mapped[int] = _zero()
    deals_read: Mapped[int] = _zero()
    owners_read: Mapped[int] = _zero()
    companies_saved: Mapped[int] = _zero()
    offices_saved: Mapped[int] = _zero()
    deals_saved: Mapped[int] = _zero()
    deals_skipped: Mapped[int] = _zero()  # no company, or a company not in our copy
    companies_removed: Mapped[int] = _zero()  # gone from HubSpot (a full sync finds these)
    deals_removed: Mapped[int] = _zero()
    profiles_rebuilt: Mapped[int] = _zero()
    error: Mapped[str | None] = mapped_column(Text)  # plain words only, never a raw exception
    warnings: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class HubSpotWrite(Base):
    """One write to HubSpot that a project asked for: the plan a person saw, and what happened.

    The row's id is the write's key: applying the same id again returns the first result and
    never writes twice (PLAN-V5 rule 4).
    """

    __tablename__ = "hubspot_writes"
    __table_args__ = (
        CheckConstraint(_in_list("status", WRITE_STATUSES), name="status"),
        Index("ix_hubspot_writes_app_subject", "app", "subject"),
        Index("ix_hubspot_writes_created_at", text("created_at DESC")),
        # One write at a time for the same thing (like one lead), so two clicks can't both write.
        Index(
            "uq_hubspot_writes_writing",
            "app",
            "subject",
            unique=True,
            postgresql_where=text("status = 'writing'"),
        ),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    app: Mapped[str] = mapped_column(String(64))  # the project, like "lead_finder"
    subject: Mapped[str] = mapped_column(String(120))  # what it is about, like "lead:<id>"
    status: Mapped[str] = mapped_column(String(16), server_default="previewed")
    plan: Mapped[dict[str, Any]] = mapped_column(JSONB)  # the steps, as the preview showed them
    result: Mapped[dict[str, Any]] = mapped_column(  # each step's outcome
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    hubspot_company_id: Mapped[str | None] = mapped_column(String(32))
    hubspot_url: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)  # plain words only
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
