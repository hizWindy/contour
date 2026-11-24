"""`lead-finder compare-research` (PLAN-V27 T5-2, paid, on Al-khair's word): today's research and
Quick Deep Research's loop on the 10 test companies, one after the other, with memory off so each
one searches.

For each company and each kind it records what the keep rule (choice 25) needs: the facts found,
the signs found, the cost, the time to the first finding and the time to the finished card. A
person then checks each fact against its source (the facts right), and the Log gets the table.

It stops before a company whose two researches could pass the US$20 limit, at the company cap.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.context import ResearchContext
from apps.lead_finder.research import LeadCard, ResearchRequest, research_company
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sources import FACT_FIELDS
from core.claude.client import Claude
from core.config import Settings
from core.memory.embedder import Embedder

LIMIT_USD = Decimal("20")  # the comparison's whole cost (T5-2)
Kind = Literal["standard", "deep"]
KINDS: tuple[Kind, ...] = ("standard", "deep")


@dataclass(frozen=True, slots=True)
class Measured:
    company: str
    kind: Kind
    facts_found: int
    signs_found: int
    cost_usd: Decimal
    first_finding_s: float | None  # None: no finding at all
    card_s: float
    result: str
    tier: str | None


def facts_found(card: LeadCard) -> int:
    return sum(1 for name in FACT_FIELDS if getattr(card.facts, name).value is not None)


def most_per_company(settings: Settings) -> Decimal:
    """The most both researches of one company can cost: twice the company cap."""
    return settings.company_cap_usd * len(KINDS)


async def measure(
    session: AsyncSession,
    embedder: Embedder,
    claude: Claude,
    rules: LeadFinderRules,
    settings: Settings,
    request: ResearchRequest,
    kind: Kind,
) -> Measured:
    started = time.monotonic()
    first: list[float] = []

    async def found(text: str, url: str, next_question: str | None) -> None:
        if not first:
            first.append(time.monotonic() - started)

    context = ResearchContext(on_finding=found, deep=kind == "deep")
    card = await research_company(
        session, embedder, claude, rules, settings, request, context=context
    )
    return Measured(
        company=request.company,
        kind=kind,
        facts_found=facts_found(card),
        signs_found=len(card.triggers),
        cost_usd=card.research.cost_usd,
        first_finding_s=first[0] if first else None,
        card_s=time.monotonic() - started,
        result=str(card.result),
        tier=card.tier,
    )


async def compare(
    session: AsyncSession,
    embedder: Embedder,
    claude: Claude,
    rules: LeadFinderRules,
    settings: Settings,
    requests: Sequence[ResearchRequest],
    limit_usd: Decimal = LIMIT_USD,
) -> tuple[list[Measured], str | None]:
    """Both kinds for each company, until the limit would be passed. Returns the measures and
    why it stopped early (None when every company ran)."""
    measured: list[Measured] = []
    spent = Decimal(0)
    for request in requests:
        if spent + most_per_company(settings) > limit_usd:
            return measured, (
                f"Stopped before {request.company}: US${spent:.2f} spent, and its two researches "
                f"could pass the US${limit_usd:.0f} limit."
            )
        fresh = request.model_copy(update={"use_memory": False})
        for kind in KINDS:
            one = await measure(session, embedder, claude, rules, settings, fresh, kind)
            spent += one.cost_usd
            measured.append(one)
    return measured, None


def table(measured: Sequence[Measured]) -> str:
    lines = [
        f"{'Company':<22} {'Kind':<9} {'Facts':>5} {'Signs':>5} {'US$':>7} "
        f"{'First s':>7} {'Card s':>7}  Result"
    ]
    for m in measured:
        first = f"{m.first_finding_s:.0f}" if m.first_finding_s is not None else "-"
        lines.append(
            f"{m.company[:22]:<22} {m.kind:<9} {m.facts_found:>5} {m.signs_found:>5} "
            f"{m.cost_usd:>7.2f} {first:>7} {m.card_s:>7.0f}  {m.result} {m.tier or ''}".rstrip()
        )
    for kind in KINDS:
        rows = [m for m in measured if m.kind == kind]
        if not rows:
            continue
        times = sorted(m.card_s for m in rows)
        middle = times[len(times) // 2]
        cost = sum((m.cost_usd for m in rows), Decimal(0))
        facts = sum(m.facts_found for m in rows)
        lines.append(
            f"{kind}: {facts} facts, US${cost:.2f}, middle time to the card {middle:.0f} s"
        )
    lines.append("Facts right: a person checks each fact against its source (T5-2).")
    return "\n".join(lines)
