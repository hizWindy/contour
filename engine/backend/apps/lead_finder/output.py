"""What a lead card says about the office, the headcount, the space and what changed (Levi's
section 9, PLAN-V16 T1-10). Pure code: it only reads the facts, the sources and the tools' records
the research already has, so the same research always gives the same card.

- `office_of`: the current office. Its address comes from a property tool (the facts have none),
  its size, lease end and move-in date from the facts the rules used.
- `headcount_of` and `space_of`: local staff now and projected, and the space at about 10 m² a
  person, each marked confirmed or estimated.
- `what_changed`: this research against the last one of the same company: new, upgraded,
  downgraded or unchanged, with one sentence.
"""

from collections.abc import Sequence
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

from apps.lead_finder.fields import CompanyFacts, Fact
from apps.lead_finder.property import LEASE_SIGN, office_readings
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.scoring import month_year, parse_date
from apps.lead_finder.sourcing import FactSource
from core.sources.types import SOURCE_IDS, CompanyProperty

Basis = Literal["confirmed", "estimated"]
ChangeKind = Literal["new", "upgraded", "downgraded", "unchanged"]
# Best first. A lead with no tier (judged before PLAN-V16 T1-6) is compared by its result.
TIER_ORDER = ("A", "B", "C", "discard")
RESULT_ORDER = ("pass", "director_review", "watch", "drop")
RESULT_WORDS = {
    "pass": "Pass",
    "director_review": "Director review",
    "watch": "Watch",
    "drop": "Drop",
}
OFFICE_SOURCE_WORDS = {"claude": "web_research"}  # how `fact_sources` names the web research


class Office(BaseModel):
    """The current office, from the first source with a value (PLAN-V16 T1-8's order)."""

    address: str | None = Field(description="From a property tool. The facts hold no address.")
    building: str | None
    floor: str | None
    area_m2: int | None
    area_basis: Basis | None = Field(description="estimated: worked out from staff or growth")
    since: str | None = Field(description="A date or a year, like 2017")
    since_words: str | None = Field(examples=["At this address since at least 2017."])
    lease_end: str | None
    lease_end_basis: Basis | None
    fitout_by: str | None = Field(
        description="The firm that did the last fitout, if a note names it"
    )
    source: str | None = Field(
        description="Where it came from: property_daily, arealytics, hubspot or web_research"
    )


class Headcount(BaseModel):
    """Local staff, now and projected."""

    now: int | None
    projected: int | None
    now_basis: Basis | None
    projected_basis: Basis | None
    source_url: str | None


class Space(BaseModel):
    """The space at about 10 m² a person (`size.m2_per_staff`)."""

    now_m2: int | None
    projected_m2: int | None


class WhatChanged(BaseModel):
    kind: ChangeKind
    text: str = Field(examples=["Up from B to A: a new sign, a lease ending in 1 to 3 years."])


def _basis(fact: Fact[Any]) -> Basis | None:
    if fact.value is None:
        return None
    return "confirmed" if fact.label == "confirmed" else "estimated"


def _used(fact: str, sources: Sequence[FactSource]) -> str | None:
    used = next((entry.used for entry in sources if entry.fact == fact), None)
    return OFFICE_SOURCE_WORDS.get(used, used) if used else None


def office_of(
    facts: CompanyFacts,
    sources: Sequence[FactSource],
    found: CompanyProperty | None,
    metro: str | None,
    area_m2: int | None,
    area_estimated: bool,
    rules: LeadFinderRules,
    today: date,
) -> Office | None:
    """The current office, or None when nothing about it is known. `area_m2` and
    `area_estimated` are the size the rules judged (from the office's own area, else from staff)."""
    readings = office_readings(found, metro, rules, today)
    reading = next((readings[tool] for tool in SOURCE_IDS if tool in readings), None)
    leases = [
        (day, sign)
        for sign in facts.triggers
        if sign.id == LEASE_SIGN and (day := parse_date(sign.date)) is not None and day >= today
    ]
    lease = min(leases, key=lambda item: item[0])[1] if leases else None
    since = facts.office_since.value
    moved = parse_date(since)
    if reading is None and area_m2 is None and since is None and lease is None:
        return None
    source: str | None = reading.source if reading is not None else None
    for fact in ("office_m2", "office_since", "lease_end"):
        source = source or _used(fact, sources)
    known = area_m2 is not None or since is not None or lease is not None
    return Office(
        address=reading.address if reading else None,
        building=reading.building if reading else None,
        floor=", ".join(reading.floors) if reading and reading.floors else None,
        area_m2=area_m2,
        area_basis=None if area_m2 is None else "estimated" if area_estimated else "confirmed",
        since=since,
        since_words=f"At this address since at least {moved.year}." if moved else None,
        lease_end=lease.date if lease else None,
        lease_end_basis=(
            None if lease is None else "confirmed" if lease.label == "confirmed" else "estimated"
        ),
        fitout_by=facts.fitout_contractors[0] if facts.fitout_contractors else None,
        source=source or ("web_research" if known else None),
    )


def headcount_of(facts: CompanyFacts, rules: LeadFinderRules) -> Headcount | None:
    """Local staff now (a LinkedIn count is doubled, and so an estimate) and projected (what a
    note says the office will have). None when neither is known."""
    staff = facts.staff_in_city
    now = staff.value
    basis = _basis(staff)
    if now is not None and facts.staff_from_linkedin:
        now = round(now * rules.criteria.size.linkedin_staff_multiplier)
        basis = "estimated"
    projected = facts.staff_projected
    if now is None and projected.value is None:
        return None
    return Headcount(
        now=now,
        projected=projected.value,
        now_basis=basis,
        projected_basis=_basis(projected),
        source_url=staff.source_url or projected.source_url,
    )


def space_of(headcount: Headcount | None, rules: LeadFinderRules) -> Space | None:
    if headcount is None:
        return None
    per_person = rules.criteria.size.m2_per_staff

    def m2(staff: int | None) -> int | None:
        return round(staff * per_person) if staff is not None else None

    return Space(now_m2=m2(headcount.now), projected_m2=m2(headcount.projected))


# --- What changed -------------------------------------------------------------------------------


def _rank(tier: str | None, result: str | None) -> tuple[int, str] | None:
    """Where a lead stands, lower is better, and the words for it. Its tier when it has one."""
    if tier in TIER_ORDER:
        words = "Discard" if tier == "discard" else tier
        return TIER_ORDER.index(tier), words
    if result in RESULT_ORDER:
        return RESULT_ORDER.index(result), RESULT_WORDS[result]
    return None


def _why(now: dict[str, Any], before: dict[str, Any], labels: dict[str, str]) -> str:
    """The first thing that differs: a new sign, a sign that is gone, a dampener found or lifted,
    else the score."""

    def signs(card: dict[str, Any]) -> list[str]:
        return [str((item.get("trigger") or {}).get("id")) for item in card.get("triggers") or []]

    def found(card: dict[str, Any]) -> dict[str, str]:
        return {
            str(item.get("id")): str(item.get("label") or item.get("id"))
            for item in card.get("dampeners") or []
            if item.get("state") == "found" and not item.get("waived")
        }

    new_signs = [sign for sign in signs(now) if sign not in signs(before)]
    if new_signs:
        return f"a new sign, {_lower(labels.get(new_signs[0], new_signs[0]))}"
    damped, was_damped = found(now), found(before)
    new_dampers = [key for key in damped if key not in was_damped]
    if new_dampers:
        return f"a dampener was found, {_lower(damped[new_dampers[0]])}"
    gone = [sign for sign in signs(before) if sign not in signs(now)]
    if gone:
        return f"a sign no longer counts, {_lower(labels.get(gone[0], gone[0]))}"
    lifted = [key for key in was_damped if key not in damped]
    if lifted:
        return f"a dampener no longer applies, {_lower(was_damped[lifted[0]])}"
    return f"the score went from {before.get('score')} to {now.get('score')}"


def _lower(text: str) -> str:
    return text[:1].lower() + text[1:] if text else text


def what_changed(
    now: dict[str, Any], before: dict[str, Any] | None, rules: LeadFinderRules
) -> WhatChanged:
    """This research against the last research of the same company (`before`, its saved card, or
    None when there is none). Both are card JSON, so an old card with fewer fields still works."""
    if before is None:
        return WhatChanged(kind="new", text="New: the first research of this company.")
    labels = {sign.id: sign.label for sign in rules.criteria.triggers.every}
    here = _rank(now.get("tier"), now.get("result"))
    there = _rank(before.get("tier"), before.get("result"))
    if before.get("tier") not in TIER_ORDER:  # an old card: compare the results
        here = _rank(None, now.get("result"))
    if here is None or there is None or here[0] == there[0]:
        words = here[1] if here else "not ranked"
        tier = now.get("tier") in TIER_ORDER and before.get("tier") in TIER_ORDER
        return WhatChanged(
            kind="unchanged", text=f"Unchanged: still {'Tier ' if tier else ''}{words}."
        )
    why = _why(now, before, labels)
    if here[0] < there[0]:
        return WhatChanged(kind="upgraded", text=f"Up from {there[1]} to {here[1]}: {why}.")
    return WhatChanged(kind="downgraded", text=f"Down from {there[1]} to {here[1]}: {why}.")


def lease_words(office: Office | None) -> str | None:
    """'June 2028' for the CSV and the profile."""
    return month_year(office.lease_end) if office and office.lease_end else None
