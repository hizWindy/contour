"""The Lead Finder's own tables, in the lead_finder schema."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, overload

from sqlalchemy import (
    BigInteger,
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


# --- Column length limits: one place for every writer -----------------------------------------

# The most characters each text column holds, keyed "table.column". Postgres refuses a longer
# value, so a writer cuts it first with `clip`. The Lead columns below take their length from
# here. The Run columns live in core/runs/models.py, which the core owns and apps can't import
# from, so their numbers are repeated there and a test (tests/core/test_tables.py) keeps the
# two in step.
LIMITS: Final[dict[str, int]] = {
    "lead.origin": 16,
    "lead.company": 300,
    "lead.company_key": 300,
    "lead.domain": 255,
    "lead.city": 120,
    "lead.suburb": 120,
    "lead.industry": 120,
    "lead.industry_group": 120,
    "lead.result": 32,
    "lead.trigger_id": 64,
    "lead.contact_role": 200,
    "lead.status": 16,
    "lead.hubspot_status": 32,
    "lead.hubspot_id": 32,
    "lead.rules_version": 32,
    "lead.prompt_version": 64,
    "run.app": 64,
    "run.mode": 32,
    "run.status": 16,
    "run.rules_version": 32,
    "run.prompt_versions": 128,
    "run.stop_reason": 120,
    "run.error_id": 16,
    "run.idempotency_key": 64,
}


def _string(key: str) -> String:
    """A text column type, as long as LIMITS says."""
    return String(LIMITS[key])


@overload
def clip(value: str, maximum: int) -> str: ...
@overload
def clip(value: None, maximum: int) -> None: ...
def clip(value: str | None, maximum: int) -> str | None:
    """`value` cut to at most `maximum` characters. None stays None.

    For text a writer is about to store in a limited column: `clip(name, LIMITS["lead.city"])`.
    It cuts without an ellipsis, because these columns hold names and codes, not sentences.
    """
    if maximum < 0:
        raise ValueError("maximum can't be negative")
    return None if value is None else value[:maximum]


# --- The company key ----------------------------------------------------------------------------


UNNAMED_KEY: Final = "unnamed"  # the key of a name with no text at all


def company_key(name: str) -> str:
    """The key that says two names are the same company: 'Acme Pty Ltd' gives 'acme'.

    It is the cleaned name (`core.hubspot.matching.clean_name`), cut to the column length. A
    name that cleans to nothing (like 'Pty Ltd') falls back to its lowercase text. A name with
    no text at all (empty, or only spaces) gets the fixed key 'unnamed'. So the key is never
    empty, and a blank name can't slip past the one-lead-per-company-in-a-run rule as ''.

    Stored keys are copies of this rule. If the meaning of `clean_name` changes, the keys in
    `lead_finder.leads` go stale and the one-lead-per-company-in-a-run rule stops holding for
    old rows. That change needs a NEW migration that recomputes `company_key` (migration
    0004 keeps its own frozen copy of the old rule on purpose: it gave '' for a blank name,
    the one difference). tests/core/test_tables.py pins today's output, so such a change
    fails a test first.
    """
    limit = LIMITS["lead.company_key"]
    return clip(clean_name(name), limit) or clip(name.strip().lower(), limit) or UNNAMED_KEY


def _company_key_from_company(context: DefaultExecutionContext) -> str:
    """A safety net for code that doesn't set `company_key`: the key of `company`.

    Code that researches a company should set it from the name it was ASKED to research,
    because the name Claude finds on a page can differ.
    """
    return company_key(str(context.get_current_parameters()["company"]))  # type: ignore[no-untyped-call]


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
    # typed, web or hubspot
    origin: Mapped[str] = mapped_column(_string("lead.origin"), server_default="typed")
    is_test: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))  # the test set
    company: Mapped[str] = mapped_column(_string("lead.company"), index=True)  # as Claude wrote it
    company_key: Mapped[str] = mapped_column(  # the cleaned name that was asked for
        _string("lead.company_key"), default=_company_key_from_company
    )
    domain: Mapped[str | None] = mapped_column(_string("lead.domain"))  # like "acme.com.au"
    city: Mapped[str | None] = mapped_column(_string("lead.city"))  # metro city, None if unknown
    suburb: Mapped[str | None] = mapped_column(_string("lead.suburb"))  # the place text as found
    industry: Mapped[str | None] = mapped_column(_string("lead.industry"))
    industry_group: Mapped[str | None] = mapped_column(_string("lead.industry_group"))
    staff_in_city: Mapped[int | None] = mapped_column(Integer)
    office_m2: Mapped[int | None] = mapped_column(Integer)
    office_m2_estimated: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    result: Mapped[str] = mapped_column(_string("lead.result"), index=True)  # pass, watch, ...
    score: Mapped[int] = mapped_column(Integer)
    # The most points the tool could judge for this lead ("48 of 60 checked"). Empty for a lead
    # scored under version 1, and for a Drop.
    score_checked: Mapped[int | None] = mapped_column(Integer)
    trigger_id: Mapped[str | None] = mapped_column(_string("lead.trigger_id"))  # the best one
    trigger_ids: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )  # every trigger that counts
    trigger_date: Mapped[date | None] = mapped_column(Date)
    contact_role: Mapped[str | None] = mapped_column(_string("lead.contact_role"))
    status: Mapped[str] = mapped_column(_string("lead.status"), server_default="new")  # new, ...
    reject_reason: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    useful: Mapped[bool | None] = mapped_column(Boolean)  # a person's thumbs up or down
    hubspot_status: Mapped[str] = mapped_column(_string("lead.hubspot_status"))
    hubspot_id: Mapped[str | None] = mapped_column(_string("lead.hubspot_id"))
    card: Mapped[dict[str, Any]] = mapped_column(JSONB)  # facts, sources, rule checks
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6))
    web_searches: Mapped[int] = mapped_column(Integer)
    rules_version: Mapped[str] = mapped_column(_string("lead.rules_version"))
    prompt_version: Mapped[str] = mapped_column(_string("lead.prompt_version"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=func.now()
    )


# Newest first: the results page and the "latest" view read leads in this order.
Index("ix_leads_created_at", Lead.created_at.desc())


class SignalHireDetails(Base):
    """Signal Hire's details for one company, kept for a while (PLAN-V4 C1).

    Reading them costs 1 company credit, so a saved copy is used until it is older than
    `signalhire_details_fresh_days`, and the same company is paid for once a month, not once for
    each run. `details` is the `SignalHireCompany` of apps/lead_finder/signalhire_company.py.
    """

    __tablename__ = "signalhire_details"
    __table_args__ = (Index("ix_signalhire_details_slug", "slug"), {"schema": SCHEMA})

    signalhire_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    slug: Mapped[str] = mapped_column(String(100))  # Signal Hire's address for it, to find it again
    details: Mapped[dict[str, Any]] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
