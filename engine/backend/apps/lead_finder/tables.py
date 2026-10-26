"""The Lead Finder's own tables, in the lead_finder schema."""

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
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.engine.default import DefaultExecutionContext
from sqlalchemy.orm import Mapped, mapped_column

import core.runs.models  # noqa: F401  (the leads table points at core.runs)
from core.db.base import CORE_SCHEMA, Base
from core.hubspot.matching import clean_name

SCHEMA = "lead_finder"
LEAD_STATUSES = ("new", "watching", "rejected", "sent")
LEAD_ORIGINS = ("typed", "web", "hubspot")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _company_key_from_company(context: DefaultExecutionContext) -> str:
    """A safety net for code that doesn't set `company_key`: the cleaned `company`.

    Code that researches a company should set it from the name it was ASKED to research,
    because the name Claude finds on a page can differ.
    """
    name = str(context.get_current_parameters()["company"])  # type: ignore[no-untyped-call]
    return clean_name(name)[:300] or name.strip().lower()[:300]


class Lead(Base):
    """One researched company: its result, score and full lead card.

    The card holds everything. The other columns are copies of what the website filters, sorts
    and groups by, so those queries don't have to open the card.
    """

    __tablename__ = "leads"
    __table_args__ = (
        CheckConstraint(_in_list("status", LEAD_STATUSES), name="status"),
        CheckConstraint(_in_list("origin", LEAD_ORIGINS), name="origin"),
        Index("ix_leads_run_id", "run_id"),
        Index("ix_leads_company_key", "company_key"),
        Index("ix_leads_domain", "domain"),
        Index("ix_leads_city", "city"),
        Index("ix_leads_hubspot_status", "hubspot_status"),
        Index("ix_leads_trigger_ids", "trigger_ids", postgresql_using="gin"),
        # One lead for each company in a run, so a repeated or resumed run never doubles up.
        Index(
            "uq_leads_run_id_company_key",
            "run_id",
            "company_key",
            unique=True,
            postgresql_where=text("run_id IS NOT NULL"),
        ),
        {"schema": SCHEMA},
    )
    # After an UPDATE, fetch `updated_at` in the same statement. Without this the value is
    # left unloaded, and reading it later in async code fails (MissingGreenlet).
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.runs.id", ondelete="SET NULL")
    )
    origin: Mapped[str] = mapped_column(String(16), server_default="typed")  # typed, web, hubspot
    is_test: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))  # the test set
    company: Mapped[str] = mapped_column(String(300), index=True)  # the name Claude wrote
    company_key: Mapped[str] = mapped_column(  # the cleaned name that was asked for
        String(300), default=_company_key_from_company
    )
    domain: Mapped[str | None] = mapped_column(String(255))  # like "acme.com.au"
    city: Mapped[str | None] = mapped_column(String(120))  # the metro city, None if unknown
    suburb: Mapped[str | None] = mapped_column(String(120))  # the place text as found
    industry: Mapped[str | None] = mapped_column(String(120))
    industry_group: Mapped[str | None] = mapped_column(String(120))
    staff_in_city: Mapped[int | None] = mapped_column(Integer)
    office_m2: Mapped[int | None] = mapped_column(Integer)
    office_m2_estimated: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    result: Mapped[str] = mapped_column(String(32), index=True)  # pass, director_review, ...
    score: Mapped[int] = mapped_column(Integer)
    trigger_id: Mapped[str | None] = mapped_column(String(64))  # the best trigger that counts
    trigger_ids: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )  # every trigger that counts
    trigger_date: Mapped[date | None] = mapped_column(Date)
    contact_role: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), server_default="new")  # new, watching, ...
    reject_reason: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    useful: Mapped[bool | None] = mapped_column(Boolean)  # a person's thumbs up or down
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=func.now()
    )


# Newest first: the results page and the "latest" view read leads in this order.
Index("ix_leads_created_at", Lead.created_at.desc())
