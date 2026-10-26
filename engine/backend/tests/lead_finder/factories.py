"""Leads, runs and memory items for tests, built straight into the tables.

A test sets only the columns it cares about. Every lead gets a card that parses as a `LeadCard`
(so `GET /leads/{id}` works), and a `created_at` that grows by one minute with each lead made,
so "newest" never depends on the clock or on ties.

    lead = make_lead("Acme Software", score=80, city="Perth")
    session.add(lead)
    await session.commit()

`vector(cos)` makes a memory vector whose cosine similarity with `vector(1.0)` is exactly `cos`,
so look-alike tests can say which company is nearer without loading the memory model.
"""

import itertools
import math
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.research import HubSpotOut, LeadCard, ResearchCost
from apps.lead_finder.scoring import RuleCheck, TriggerScore
from apps.lead_finder.tables import Lead, company_key
from core.memory.embedder import Embedder
from core.memory.models import EMBEDDING_DIM, MemoryItem
from core.runs.models import Run
from tests.lead_finder.samples import fact, make_facts

START = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
_clock = itertools.count()
NEWS = "https://www.afr.com/property/acme-moves-2026"


def next_time() -> datetime:
    """A time one minute after the last one this function gave."""
    return START + timedelta(minutes=next(_clock))


def default_checks(result: str) -> list[RuleCheck]:
    """The rule checks a card of this result would hold."""
    if result == "drop":
        return [RuleCheck(rule="HubSpot", outcome="fail", detail="Open deal in HubSpot: Acme")]
    if result == "director_review":
        return [
            RuleCheck(rule="City", outcome="director", detail="Sydney: a Director decides"),
            RuleCheck(rule="Trigger", outcome="ok", detail="Acme signed a new lease."),
        ]
    if result == "watch":
        return [
            RuleCheck(rule="Trigger", outcome="unknown", detail="No sign of an office change yet")
        ]
    return [RuleCheck(rule="Trigger", outcome="ok", detail="Acme signed a new lease.")]


def make_card(
    lead_id: uuid.UUID,
    company: str,
    *,
    result: str = "pass",
    score: int = 70,
    city: str | None = "Melbourne",
    office_m2: int | None = 2500,
    trigger_id: str | None = "lease_ending",
    source_url: str = NEWS,
    checks: list[RuleCheck] | None = None,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    """A lead card as the database stores it (JSON that parses as a `LeadCard`)."""
    facts = make_facts(name=company, city=fact(city), office_m2=fact(office_m2))
    triggers = (
        [
            TriggerScore(
                trigger=facts.triggers[0].model_copy(
                    update={"id": trigger_id, "source_url": source_url}
                ),
                group="main",
                source_kind="news",
                points=score,
            )
        ]
        if trigger_id
        else []
    )
    card = LeadCard(
        id=lead_id,
        company=company,
        result=result,
        score=score,
        summary=f"{company} is looking at a new office.",
        why_it_fits=f"City: {city}. Result: {result}.",
        contact_role="Head of Property",
        opening_line=None,
        checks=checks if checks is not None else default_checks(result),
        triggers=triggers,
        office_m2=office_m2,
        office_m2_estimated=False,
        fitout_aud=None,
        facts=facts,
        hubspot=HubSpotOut(
            status="new",
            hubspot_id=None,
            name=None,
            owner=None,
            matched_by=None,
            open_deals=[],
            last_dissolved=None,
        ),
        dropped=[],
        problems=[],
        research=ResearchCost(
            cost_usd=Decimal("0.4"),
            cap_usd=Decimal("2.5"),
            web_searches=6,
            claude_requests=4,
            angles_from_memory=[],
        ),
        rules_version="rules1",
        prompt_version="prompts1",
        created_at=created_at or START,
    )
    return card.model_dump(mode="json")


def make_lead(company: str = "Acme Software", **changes: Any) -> Lead:
    """A lead, not yet added to a session. `changes` are Lead columns (`score=80`,
    `city="Perth"`, `is_test=True`, `status="watching"`...). `company_key` follows `company`
    unless it is given. `card` is built from the same values unless it is given."""
    lead_id = changes.pop("id", None) or uuid.uuid4()
    created_at = changes.pop("created_at", None) or next_time()
    result = changes.pop("result", "pass")
    score = changes.pop("score", 70)
    city = changes.pop("city", "Melbourne")
    office_m2 = changes.pop("office_m2", 2500)
    trigger_id = changes.pop("trigger_id", "lease_ending")
    trigger_ids = changes.pop("trigger_ids", [trigger_id] if trigger_id else [])
    checks = changes.pop("checks", None)
    card = changes.pop("card", None)
    if card is None:
        card = make_card(
            lead_id,
            company,
            result=result,
            score=score,
            city=city,
            office_m2=office_m2,
            trigger_id=trigger_id,
            checks=checks,
            created_at=created_at,
        )
    values: dict[str, Any] = {
        "id": lead_id,
        "company": company,
        "company_key": company_key(company),
        "city": city,
        "result": result,
        "score": score,
        "office_m2": office_m2,
        "office_m2_estimated": False,
        "trigger_id": trigger_id,
        "trigger_ids": trigger_ids,
        "hubspot_status": "new",
        "card": card,
        "cost_usd": Decimal("0.400000"),
        "web_searches": 6,
        "rules_version": "rules1",
        "prompt_version": "prompts1",
        "created_at": created_at,
        "updated_at": created_at,
        "status": "new",
        "origin": "typed",
        "is_test": False,
    }
    values.update(changes)
    return Lead(**values)


async def add_all(session: AsyncSession, *rows: object) -> None:
    """Saves rows (leads, runs, memory items) in one commit. Runs are written first, so the
    leads can point at them."""
    session.add_all([row for row in rows if isinstance(row, Run)])
    await session.flush()
    session.add_all([row for row in rows if not isinstance(row, Run)])
    await session.commit()


def make_run(**changes: Any) -> Run:
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "app": "lead_finder",
        "mode": "discovery",
        "status": "done",
        "created_at": next_time(),
    }
    values.update(changes)
    return Run(**values)


def vector(cos: float = 1.0) -> list[float]:
    """A memory vector. `vector(c)` has cosine similarity `c` with `vector(1.0)`: the two
    differ by an angle whose cosine is `c`. Two vectors with the same `cos` are identical."""
    if not -1.0 <= cos <= 1.0:
        raise ValueError("cos must be between -1 and 1")
    numbers = [0.0] * EMBEDDING_DIM
    numbers[0] = cos
    numbers[1] = math.sqrt(1.0 - cos * cos)
    return numbers


def make_profile(
    subject: str,
    cos: float = 1.0,
    *,
    app: str = "lead_finder",
    meta: dict[str, Any] | None = None,
    content: str | None = None,
) -> MemoryItem:
    """A `company_profile` memory item."""
    return MemoryItem(
        app=app,
        kind="company_profile",
        subject=subject,
        content=content or f"{subject}: a company with an office.",
        meta=meta or {},
        embedding=vector(cos),
    )


def lead_profile(lead: Lead, cos: float = 1.0) -> MemoryItem:
    """The profile research saves for a lead: subject is the company, `meta.job_id` the lead."""
    return make_profile(
        lead.company,
        cos,
        meta={"job_id": str(lead.id), "result": lead.result, "score": lead.score},
    )


def deal_profile(
    name: str,
    cos: float,
    *,
    hubspot_id: str,
    has_deal: bool = True,
    cities: list[str] | None = None,
    industry: str | None = "Software",
    deal_status: str | None = "open",
) -> MemoryItem:
    """A HubSpot company profile, with the meta the HubSpot profile builder writes."""
    return make_profile(
        name,
        cos,
        app="hubspot",
        meta={
            "hubspot_id": hubspot_id,
            "cities": cities if cities is not None else ["Melbourne"],
            "industry": industry,
            "has_deal": has_deal,
            "deal_status": deal_status,
        },
    )


class FakeEmbedder(Embedder):
    """An embedder that needs no model: every text becomes `vector(1.0)`. It records the texts."""

    def __init__(self) -> None:
        super().__init__("fake", Path("."), None)
        self.texts: list[str] = []

    async def embed_passages(self, texts: list[str]) -> list[list[float]]:
        self.texts.extend(texts)
        return [vector(1.0) for _ in texts]

    async def embed_query(self, text: str) -> list[float]:
        return vector(1.0)
