"""What a lead sends to HubSpot (PLAN-V5 D3), and what changes on the lead once it is sent.

The map is rules/hubspot_map.yaml: our field -> HubSpot's company field. This file only turns a
saved lead into a `WriteRequest` for the core's writer (core/hubspot/writer.py), which does the
rest: the preview, the empty-fields rule, the once-only key, the write log. So the Lead Finder
has no HubSpot calls of its own.

HubSpot's formats: the state as VIC, SA, WA ...; the website as a plain domain; the industry as
one of HubSpot's own choices (the writer matches our label to its list, and an industry HubSpot
doesn't list goes in the note). The 7 `contour_ai_*` fields don't exist yet (F1), so the writer
puts their values in the note until the admin makes them.

The note (TBC with Levi): the trigger with its link, the score, the result and a link to the
lead card.
"""

import uuid
from collections.abc import Mapping
from datetime import date
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.tables import Lead
from core.hubspot.importer import normalize_domain
from core.hubspot.writer import CompanyTarget, WriteOut, WriteRequest

APP = "lead_finder"
MELBOURNE = ZoneInfo("Australia/Melbourne")
# The state of each city the Lead Finder searches, in HubSpot's form.
CITY_STATE = {
    "Melbourne": "VIC",
    "Adelaide": "SA",
    "Perth": "WA",
    "Sydney": "NSW",
    "Brisbane": "QLD",
}
RESULT_WORDS = {
    "pass": "Pass",
    "director_review": "Director review",
    "watch": "Watch",
    "drop": "Drop",
}
FIELD_LABELS = {
    "name": "Company name",
    "domain": "Website",
    "city": "City",
    "state": "State",
    "industry": "Industry",
    "staff": "Staff",
    "ai_suggested": "AI suggested",
    "trigger": "AI trigger",
    "trigger_date": "AI trigger date",
    "source_link": "AI source link",
    "score": "AI score",
    "result": "AI result",
    "research_date": "AI research date",
}
# HubSpot statuses that name a company already in HubSpot.
KNOWN = ("in_hubspot", "open_deal", "dissolved_deal")


def subject_of(lead_id: uuid.UUID) -> str:
    return f"lead:{lead_id}"


def _first_trigger(card: Mapping[str, Any]) -> Mapping[str, Any]:
    triggers = card.get("triggers") or []
    first = triggers[0] if triggers and isinstance(triggers[0], dict) else {}
    found = first.get("trigger")
    return found if isinstance(found, dict) else {}


def lead_values(lead: Lead, rules: LeadFinderRules) -> dict[str, str | None]:
    """Our side of the map: each field in hubspot_map.yaml, with the lead's value."""
    trigger = _first_trigger(lead.card or {})
    labels = {item.id: item.label for item in rules.criteria.triggers.every}
    trigger_id = lead.trigger_id or trigger.get("id")
    researched: date = lead.created_at.astimezone(MELBOURNE).date()
    return {
        "name": lead.company,
        "domain": normalize_domain(lead.domain),
        "city": lead.city,
        "state": CITY_STATE.get(lead.city or ""),
        "industry": lead.industry,
        "staff": str(lead.staff_in_city) if lead.staff_in_city else None,
        "ai_suggested": "true",
        "trigger": labels.get(trigger_id or "", trigger_id) if trigger_id else None,
        "trigger_date": lead.trigger_date.isoformat() if lead.trigger_date else None,
        "source_link": trigger.get("source_url") or None,
        "score": str(lead.score),
        "result": RESULT_WORDS.get(lead.result, lead.result),
        "research_date": researched.isoformat(),
    }


def note_for(lead: Lead, values: Mapping[str, str | None], card_url: str | None) -> str:
    """The note's text (TBC with Levi): the trigger with its link, the score, the result."""
    trigger = _first_trigger(lead.card or {})
    lines = ["Suggested by Contour's Lead Finder."]
    if values.get("trigger"):
        happened = str(trigger.get("what_happened") or "").strip()
        when = f" ({values['trigger_date']})" if values.get("trigger_date") else ""
        lines.append(f"Trigger: {values['trigger']}{when}. {happened}".strip())
    if values.get("source_link"):
        lines.append(f"Source: {values['source_link']}")
    checked = f" of {lead.score_checked} checked" if lead.score_checked else ""
    lines.append(f"Score: {lead.score}{checked}. Result: {values.get('result')}.")
    if card_url:
        lines.append(f"Lead card: {card_url}")
    return "\n".join(lines)


def send_request(
    lead: Lead, rules: LeadFinderRules, *, card_url: str | None = None
) -> WriteRequest:
    """The change one lead asks HubSpot for."""
    values = lead_values(lead, rules)
    fields: dict[str, str] = {}
    labels: dict[str, str] = {}
    for ours, target in rules.hubspot_map.company.items():
        value = values.get(ours)
        if value:
            fields[target.property] = value
            labels[target.property] = FIELD_LABELS.get(ours, ours)
    warnings: list[str] = []
    if lead.hubspot_status == "open_deal":
        warnings.append("This company has an open deal in HubSpot. The rules say never suggest it.")
    if lead.hubspot_status == "possible_match":
        warnings.append(
            "This lead might be a company already in HubSpot (a possible match). Check the "
            "match on the lead card first, or a second company may be made."
        )
    if lead.result == "drop":
        warnings.append("The research dropped this lead.")
    return WriteRequest(
        app=APP,
        subject=subject_of(lead.id),
        company=CompanyTarget(
            hubspot_id=lead.hubspot_id if lead.hubspot_status in KNOWN else None,
            name=lead.company,
            domain=values["domain"],
        ),
        fields=fields,
        labels=labels,
        note=note_for(lead, values, card_url),
        list_name=rules.hubspot_map.list_name,
        warnings=warnings,
    )


async def mark_sent(session: AsyncSession, written: WriteOut) -> None:
    """After a lead's write is done: its status is `sent` (only this sets it), and it points at
    the HubSpot record. Its research result stays as it was."""
    if not written.subject.startswith("lead:") or written.hubspot_company_id is None:
        return
    lead_id = uuid.UUID(written.subject.removeprefix("lead:"))
    lead = await session.get(Lead, lead_id)
    if lead is None:
        return
    # A new lead (or a possible match) is now in HubSpot. An open or dissolved deal stays as is.
    status = (
        "in_hubspot" if lead.hubspot_status in ("new", "possible_match") else lead.hubspot_status
    )
    card = dict(lead.card or {})
    hubspot = dict(card.get("hubspot") or {})
    hubspot.update(
        {
            "hubspot_id": written.hubspot_company_id,
            "name": hubspot.get("name") or written.plan.company_name,
            "status": status,
            "matched_by": hubspot.get("matched_by") or "hubspot_id",
        }
    )
    if status == "in_hubspot":
        hubspot["candidates"] = []  # it is no longer a guess
    card["hubspot"] = hubspot
    await session.execute(
        update(Lead)
        .where(Lead.id == lead_id)
        .values(
            status="sent",
            hubspot_id=written.hubspot_company_id,
            hubspot_status=status,
            card=card,
        )
    )
    await session.commit()
