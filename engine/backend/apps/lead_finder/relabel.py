"""HubSpot labels for saved leads, from our copy as it is now (PLAN-V5 D2).

A lead's label (New, In HubSpot, Open deal, Dissolved deal, Possible match) is worked out when
the company is researched, against the HubSpot copy of that day. After a sync the copy can say
more: on 4 Nov 2026, 35 of 52 dev leads researched against the 100-company export turned out to
be in HubSpot already, 15 with an open deal. `relabel` matches each lead again and, with
`write=True`, saves the new label, the HubSpot id and the card's HubSpot section.

What it does not change: the lead's result and score (a person reads "Open deal" next to them),
its status, and leads that were sent (their label came from the send). The look-alike check
(`similar_profile`) is not run: it needs each lead's profile text, and the name and website
checks find what a sync can change. Free: no Claude, no HubSpot call.
"""

from collections import Counter
from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.research import HubSpotOut
from apps.lead_finder.tables import Lead
from core.hubspot.matching import match_company
from core.prefs.service import effective_settings


@dataclass(frozen=True)
class Relabelled:
    total: int  # leads looked at
    changed: int  # leads whose label changed
    moves: dict[tuple[str, str], int]  # (old label, new label) -> how many


async def relabel(session: AsyncSession, *, write: bool) -> Relabelled:
    """Matches every lead that wasn't sent against our HubSpot copy. Saves only with `write`."""
    settings = await effective_settings(session)
    leads = (
        await session.scalars(select(Lead).where(Lead.status != "sent").order_by(Lead.created_at))
    ).all()
    moves: Counter[tuple[str, str]] = Counter()
    changed = 0
    for lead in leads:
        match = await match_company(
            session,
            lead.company,
            website=lead.domain,
            city=lead.city,
            hubspot_id=lead.hubspot_id if lead.origin == "hubspot" else None,
            fuzzy_min=settings.match_fuzzy_min,
            profile_min=settings.match_profile_min,
        )
        moves[(lead.hubspot_status, match.status)] += 1
        if match.status == lead.hubspot_status and match.hubspot_id == lead.hubspot_id:
            continue
        changed += 1
        if write:
            card = dict(lead.card or {})
            card["hubspot"] = HubSpotOut(**asdict(match)).model_dump(mode="json")
            lead.card = card
            lead.hubspot_status = match.status
            lead.hubspot_id = match.hubspot_id
    if write:
        await session.commit()
    else:
        await session.rollback()
    return Relabelled(total=len(leads), changed=changed, moves=dict(moves))


def describe(result: Relabelled, *, written: bool) -> str:
    lines = [
        f"{result.total} leads looked at; {result.changed} get a new HubSpot label.",
        "Old label -> new label: count",
    ]
    for (old, new), count in sorted(result.moves.items(), key=lambda item: -item[1]):
        lines.append(f"  {old} -> {new}: {count}")
    if written:
        lines.append(
            "Saved. Results and scores are unchanged; a lead with an open deal is not suggested."
        )
    else:
        lines.append("Nothing saved (a dry run). Add --yes to save the new labels.")
    return "\n".join(lines)
