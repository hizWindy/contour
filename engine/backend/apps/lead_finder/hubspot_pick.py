"""A person settles a possible HubSpot match on the lead card (PLAN-V27 T1-3, choice 4).

A maybe (`possible_match`) lists up to 3 HubSpot companies it might be. Two buttons settle it:

- **Same company:** the lead is linked to that HubSpot company. Its status is the company's own
  (in HubSpot, open deal or dissolved deal), or `quiet` when nobody has worked it for
  `hubspot_quiet_months` (choice 3). Results then hides it unless it is quiet.
- **It's new:** the lead is new to HubSpot, and stays with the new leads.

Either way the card is judged again with its saved facts (an open deal fails the HubSpot rule, as
at research), its candidates are cleared, and `confirmed_by` says who did it. `relabel` leaves a
settled lead as it is. Free: our HubSpot copy only, no Claude and no HubSpot call.
"""

import uuid
from dataclasses import asdict
from datetime import date
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.quiet import quiet_status
from apps.lead_finder.rejudge import overrides_of
from apps.lead_finder.research import HubSpotOut, LeadCard, apply_verdict, verdict_columns
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.scoring import judge
from apps.lead_finder.tables import Lead
from core.api.errors import Problem
from core.hubspot.matching import HubSpotMatch, match_company

Pick = Literal["same", "new"]

NOT_A_MAYBE = Problem(
    409,
    "Already settled",
    "This lead isn't a possible match any more, so there is nothing to settle.",
    code="not_a_maybe",
)
NOT_A_CANDIDATE = Problem(
    422,
    "Not one of its matches",
    "Pick one of the HubSpot companies this lead might be.",
    code="not_a_candidate",
    errors=[{"field": "body.hubspot_id", "message": "Pick one of the companies listed."}],
)
COMPANY_GONE = Problem(
    409,
    "That company is no longer in HubSpot",
    "It was removed from our HubSpot copy. Sync HubSpot, then look at the lead again.",
    code="hubspot_company_gone",
)


async def pick_match(
    session: AsyncSession,
    lead_id: uuid.UUID,
    pick: Pick,
    hubspot_id: str | None,
    *,
    by: str,
    rules: LeadFinderRules,
    quiet_months: int,
    today: date,
) -> LeadCard | None:
    """Settles the lead's possible match and saves it. None for an unknown lead.

    Raises 409 `not_a_maybe` for a lead that isn't a possible match (a second click), 422
    `not_a_candidate` for a HubSpot id that isn't one of its candidates, and 409
    `hubspot_company_gone` when that company left our copy. The lead is read FOR UPDATE, so two
    clicks at once give one change and one refusal."""
    lead = await session.scalar(
        select(Lead)
        .where(Lead.id == lead_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if lead is None:
        return None
    if lead.hubspot_status != "possible_match":
        await session.rollback()
        raise NOT_A_MAYBE
    card = LeadCard.model_validate(lead.card)
    if pick == "same":
        if hubspot_id is None or hubspot_id not in {c.hubspot_id for c in card.hubspot.candidates}:
            await session.rollback()
            raise NOT_A_CANDIDATE
        match = await match_company(session, card.company, hubspot_id=hubspot_id)
        if match.matched_by != "hubspot_id":
            await session.rollback()
            raise COMPANY_GONE
        quiet = await quiet_status(session, match, quiet_months, today)
        hubspot = HubSpotOut(
            **{**asdict(match), "status": quiet.status},
            last_activity=quiet.last_activity,
            confirmed_by=by,
        )
    else:
        match = HubSpotMatch(status="new")
        hubspot = HubSpotOut(**asdict(match), confirmed_by=by)
    verdict = judge(card.facts, match, rules, today, overrides=overrides_of(lead.card))
    changed = apply_verdict(card.model_copy(update={"hubspot": hubspot}), verdict)
    await session.execute(
        update(Lead)
        .where(Lead.id == lead_id)
        .values(
            hubspot_status=hubspot.status,
            hubspot_id=hubspot.hubspot_id,
            **verdict_columns(changed),
        )
    )
    await session.commit()
    return changed
