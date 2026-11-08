"""What a project tells the Companies page about the companies it found (PLAN-V10 B2, B3).

The Companies page (`apps/companies`) lists the HubSpot copy for everyone with the Companies tick.
A project that finds companies of its own, like the Lead Finder, adds them through an `AppSpec`
hook, `company_leads`, so the Companies page never imports that project's code. The Companies page
asks for these only when the person also has that project's tick: the server leaves the rows and
fields out for anyone else.

A hook gives three things:

- `lead_only()`: a SELECT of the companies the project found that aren't in HubSpot yet, one row
  each, with exactly the columns in `LEAD_ONLY_COLUMNS`.
- `by_hubspot()`: a SELECT of the project's newest finding for each HubSpot company, with the
  columns in `BY_HUBSPOT_COLUMNS`. The Companies page joins it on `hubspot_id`.
- `detail(session, hubspot_id, lead_id)`: the project's section on one company's panel, or None.

The SELECTs are SQLAlchemy Core statements, so the Companies page can join, filter, sort and page
them in the database. Nothing is read twice.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

# A SELECT of any columns (SQLAlchemy 2.1 types a Select by its columns).
type AnySelect = Select[*tuple[Any, ...]]

# The columns `lead_only()` must give, in this order.
LEAD_ONLY_COLUMNS = (
    "key",  # text, like "lead:<uuid>": the company's key on the Companies page
    "name",
    "domain",
    "city",  # the metro city, like Melbourne
    "industry",
    "staff",  # staff in the city, or None
    "found_at",  # when the project found it
    "result",  # like pass or director_review
    "score",
    "lead_id",
)

# The columns `by_hubspot()` must give.
BY_HUBSPOT_COLUMNS = ("hubspot_id", "lead_id", "result", "score", "found_at")


@dataclass(frozen=True)
class CompanyLeadInfo:
    """A project's section on one company's panel: what it found and when."""

    lead_id: uuid.UUID
    result: str  # like pass, director_review, watch or drop
    result_label: str  # like "Director review"
    score: int
    score_checked: int | None
    summary: str
    best_sign: str | None  # the sign of an office change, in a sentence
    sign_date: date | None
    status: str  # new, watching, rejected or sent
    found_at: datetime
    link: str  # the page with the full card, like /leads/<id>
    name: str | None = None  # the company as the project found it (for a lead-only company)
    domain: str | None = None
    city: str | None = None
    industry: str | None = None
    staff: int | None = None


@dataclass(frozen=True)
class CompanyLeads:
    """The hook (see the module text). `app` is the project whose tick opens these rows."""

    app: str
    title: str  # like "Lead Finder", for the column and the panel's section
    lead_only: Callable[[], AnySelect]
    by_hubspot: Callable[[], AnySelect]
    detail: Callable[
        [AsyncSession, str | None, uuid.UUID | None], Awaitable[CompanyLeadInfo | None]
    ]
