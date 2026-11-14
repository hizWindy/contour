"""A person overrides an exclusion: the lead is judged again without it (PLAN-V16 T1-3).

Levi's section 3 leaves some companies out and doesn't score them (a law firm, a government
department...). A person with the Lead Finder tick can say "judge this one anyway". It is free: no
search and no Claude, just the saved facts judged again with `scoring.judge`. The card keeps
`excluded`, now with who did it and when, so the lead still says it was left out and was brought
back. The result, the score and the columns copied from them are replaced.
"""

import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.research import LeadCard, apply_verdict, verdict_columns
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.scoring import Override, judge
from apps.lead_finder.tables import Lead
from core.api.errors import Problem
from core.hubspot.matching import HubSpotMatch

MELBOURNE = ZoneInfo("Australia/Melbourne")

NOT_EXCLUDED = Problem(
    409,
    "Nothing to override",
    "No rule left this lead out, so there is nothing to override.",
    code="not_excluded",
)
ALREADY_OVERRIDDEN = Problem(
    409,
    "Already overridden",
    "This exclusion was overridden already. The lead is judged without it.",
    code="already_overridden",
)


async def override_exclusion(
    session: AsyncSession,
    lead_id: uuid.UUID,
    by: str,
    rules: LeadFinderRules,
    now: datetime | None = None,
) -> LeadCard | None:
    """Judges the lead again without its exclusion, and saves it. None for an unknown lead.

    `by` is who did it, for the card. Raises a 409 `not_excluded` when no exclusion applies, and a
    409 `already_overridden` when it was overridden before. The lead is read FOR UPDATE, so two
    clicks at once give one override and one refusal.
    """
    lead = await session.scalar(
        select(Lead)
        .where(Lead.id == lead_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if lead is None:
        return None
    card = LeadCard.model_validate(lead.card)
    excluded = card.excluded
    if excluded is None:
        await session.rollback()
        raise NOT_EXCLUDED
    if excluded.overridden_by is not None:
        await session.rollback()
        raise ALREADY_OVERRIDDEN
    moment = now or datetime.now(UTC)
    hubspot = TypeAdapter(HubSpotMatch).validate_python(lead.card["hubspot"])
    verdict = judge(
        card.facts,
        hubspot,
        rules,
        moment.astimezone(MELBOURNE).date(),
        overrides={excluded.reason_id: Override(by=by, at=moment)},
    )
    changed = apply_verdict(card, verdict)
    await session.execute(update(Lead).where(Lead.id == lead_id).values(**verdict_columns(changed)))
    await session.commit()
    return changed
