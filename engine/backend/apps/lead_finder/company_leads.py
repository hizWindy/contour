"""The Lead Finder's companies on the Companies page (PLAN-V10 B2, B3): `core/company_leads.py`.

- **Not in HubSpot yet:** good leads (a Pass or a Director review) that aren't rejected, and that
  HubSpot doesn't have. The newest research of each company. These rows are marked "Not in HubSpot
  yet". Once a lead is approved and sent to HubSpot it is a HubSpot company, and everyone sees it
  (PLAN-V9 C3; writing waits on PLAN-V5 F1 to F3). Which leads show is **TBC** with Levi.
- **The Lead Finder column:** the newest research of each HubSpot company, whatever its result.
- **The panel's section:** the lead's result, score, summary and best sign, with a link to its card.

The Companies page asks for these only for people with the Lead Finder tick. Test-set leads never
show.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.tables import Lead
from core.company_leads import AnySelect, CompanyLeadInfo, CompanyLeads

GOOD = ("pass", "director_review")
RESULT_WORDS = {
    "pass": "Pass",
    "director_review": "Director review",
    "watch": "Watch",
    "drop": "Drop",
}


def lead_only() -> AnySelect:
    # Each company's newest research decides: a newer Drop hides an older Pass.
    newest = (
        select(
            Lead.id,
            Lead.company,
            Lead.domain,
            Lead.city,
            Lead.industry,
            Lead.staff_in_city,
            Lead.created_at,
            Lead.result,
            Lead.score,
            Lead.status,
            Lead.hubspot_id,
        )
        .where(Lead.is_test.is_(False))
        .ext(distinct_on(Lead.company_key))
        .order_by(Lead.company_key, Lead.created_at.desc(), Lead.id)
        .subquery("newest")
    )
    return select(
        func.concat("lead:", cast(newest.c.id, Text)).label("key"),
        newest.c.company.label("name"),
        newest.c.domain.label("domain"),
        newest.c.city.label("city"),
        newest.c.industry.label("industry"),
        newest.c.staff_in_city.label("staff"),
        newest.c.created_at.label("found_at"),
        newest.c.result.label("result"),
        newest.c.score.label("score"),
        newest.c.id.label("lead_id"),
    ).where(
        newest.c.result.in_(GOOD),
        newest.c.status != "rejected",
        newest.c.hubspot_id.is_(None),
    )


def by_hubspot() -> AnySelect:
    return (
        select(
            Lead.hubspot_id.label("hubspot_id"),
            Lead.id.label("lead_id"),
            Lead.result.label("result"),
            Lead.score.label("score"),
            Lead.created_at.label("found_at"),
        )
        .where(Lead.hubspot_id.is_not(None), Lead.is_test.is_(False))
        .ext(distinct_on(Lead.hubspot_id))
        .order_by(Lead.hubspot_id, Lead.created_at.desc(), Lead.id)
    )


def _sign(card: dict[str, Any]) -> tuple[str | None, date | None]:
    triggers = card.get("triggers") or []
    if not triggers or not isinstance(triggers[0], dict):
        return None, None
    trigger = triggers[0].get("trigger") or {}
    text = trigger.get("what_happened")
    when = trigger.get("date")
    parsed: date | None = None
    if isinstance(when, str) and len(when) >= 7:
        try:
            parsed = date.fromisoformat(when if len(when) == 10 else f"{when[:7]}-01")
        except ValueError:
            parsed = None
    return (str(text) if text else None), parsed


async def detail(
    session: AsyncSession, hubspot_id: str | None, lead_id: uuid.UUID | None
) -> CompanyLeadInfo | None:
    """The newest research of the company (or the lead asked for), or None."""
    statement = select(Lead).where(Lead.is_test.is_(False))
    if lead_id is not None:
        statement = statement.where(Lead.id == lead_id)
    elif hubspot_id is not None:
        statement = statement.where(Lead.hubspot_id == hubspot_id)
    else:
        return None
    lead = await session.scalar(statement.order_by(Lead.created_at.desc(), Lead.id).limit(1))
    if lead is None:
        return None
    card = lead.card or {}
    sign, sign_date = _sign(card)
    return CompanyLeadInfo(
        lead_id=lead.id,
        result=lead.result,
        result_label=RESULT_WORDS.get(lead.result, lead.result),
        score=lead.score,
        score_checked=lead.score_checked,
        summary=str(card.get("summary") or ""),
        best_sign=sign,
        sign_date=sign_date,
        status=lead.status,
        found_at=lead.created_at,
        link=f"/leads/{lead.id}",
        name=lead.company,
        domain=lead.domain,
        city=lead.city,
        industry=lead.industry,
        staff=lead.staff_in_city,
    )


COMPANY_LEADS = CompanyLeads(
    app="lead_finder",
    title="Lead Finder",
    lead_only=lead_only,
    by_hubspot=by_hubspot,
    detail=detail,
)
