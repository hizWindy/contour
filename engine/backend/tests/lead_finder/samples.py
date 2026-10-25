"""Saved sample answers, so tests never call Claude and cost nothing."""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from apps.lead_finder.fields import AngleNotes, CompanyFacts, Fact, Note, TriggerFound
from core.claude.client import Reply, Source, WebTools
from core.claude.pricing import Usage

NEWS = "https://www.afr.com/property/acme-moves-2026"
ASX = "https://www.asx.com.au/announcements/acme-contract"
SITE = "https://acme.com.au/about"


def fact(value: Any, url: str | None = NEWS, label: str = "confirmed") -> Fact[Any]:
    if value is None:
        return Fact(value=None, source_url=None, source_date=None, label=None)
    return Fact(value=value, source_url=url, source_date="2026-10-01", label=label)


def make_facts(**changes: Any) -> CompanyFacts:
    """A company that passes every rule: Melbourne, 2,500 m², a fresh lease trigger."""
    base = CompanyFacts(
        name="Acme Software",
        website=fact("acme.com.au", SITE),
        city=fact("Melbourne"),
        industry=fact("Software"),
        industry_group=None,
        owner=fact("ASX-listed, Australian", ASX),
        staff_in_city=fact(250),
        staff_from_linkedin=False,
        office_m2=fact(2500),
        local_team_runs_project=fact(True, SITE),
        healthy=fact(True, ASX),
        triggers=[
            TriggerFound(
                id="lease_ending",
                what_happened="Acme's Collins Street lease ends in March 2028.",
                date="2028-03",
                source_url=NEWS,
                label="confirmed",
            )
        ],
        boosters=[],
        expected_move=fact("2027", NEWS, "estimated"),
        contact_role="Head of Property",
        summary="Acme's Melbourne lease ends in 2028 and it is looking for a bigger office.",
        opening_line="Congratulations on the growth. Is a new office on the cards?",
    )
    return base.model_copy(update=changes)


ANGLE_NOTES = {
    "property": [
        Note(
            claim="Acme's Collins Street lease ends in March 2028.",
            url=NEWS,
            published="2026-10-01",
        )
    ],
    "people": [
        Note(claim="Acme has about 250 staff in Melbourne.", url=NEWS, published="2026-10-01"),
        Note(claim="Acme is run from its Melbourne head office.", url=SITE, published=None),
    ],
    "money": [Note(claim="Acme won a $50M contract.", url=ASX, published="2026-09-20")],
    "gaps": [Note(claim="Acme's office is 2,500 m².", url=NEWS, published="2026-10-01")],
}


@dataclass
class FakeClaude:
    """Answers like Claude, from the samples above. Records every request."""

    facts: CompanyFacts = field(default_factory=make_facts)
    invented_url: bool = False  # the notes cite a page the search never returned
    calls: list[str] = field(default_factory=list)

    async def ask[T: BaseModel](
        self, *, system: str, prompt: str, form: type[T], web: WebTools | None = None
    ) -> Reply[T]:
        if form is AngleNotes:
            angle = (
                "gaps"
                if "didn't find these facts" in prompt
                else prompt.split("Angle: ")[1].split(".")[0]
            )
            self.calls.append(f"search:{angle}")
            notes = ANGLE_NOTES[angle]
            sources = tuple(Source(n.url, "A page") for n in notes)
            if self.invented_url:
                notes = [
                    n.model_copy(update={"url": "https://made-up.example/page"}) for n in notes
                ]
            parsed: Any = AngleNotes(notes=notes)
            searches = min(2, web.max_searches) if web else 0  # the API enforces max_uses
            usage = Usage(
                input_tokens=20_000, output_tokens=1_000, web_searches=searches, web_fetches=1
            )
            cost = Decimal("0.100000") + searches * Decimal("0.01")  # 20k x $4/M + 1k x $20/M
            queries: tuple[str, ...] = (f"acme {angle}",)
        else:
            self.calls.append("extract")
            parsed = self.facts
            sources, queries = (), ()
            usage = Usage(input_tokens=5_000, output_tokens=1_000)
            cost = Decimal("0.040000")
        return Reply(
            model="claude-opus-5-5",
            stop_reason="end_turn",
            parsed=parsed,
            text=parsed.model_dump_json(),
            sources=sources,
            queries=queries,
            usage=usage,
            cost_usd=cost,
        )
