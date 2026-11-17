"""The test set: 10 public companies researched again and again, so a change to a prompt or a rule
can be judged by its score.

- `load_testset()` reads `testset.yaml`. A company may say what result it expects
  (`expect.results`), but only where the rules make it certain. Since PLAN-V16 T1-2 none is (Canva
  in Sydney used to be never a pass, and now Sydney can pass). Since PLAN-V21 T2-5 each also has a
  tier range (`tier_range`, like [C, A] for "C or better"): the quality bar a run is held to,
  proposed from what each company is and confirmed by Al-khair before M2 (**TBC**).
- A test set run is an ordinary run of mode `testset`: its leads are marked `is_test`, so they stay
  out of the results and never count as "already researched".
- `list_testset_runs` gives one summary for each past run, newest first, so scores can be
  compared over time. `report_of_testset` gives one run company by company.

The expectations are read from the file when a report is made, so a report of an old run uses
today's expectations (**TBC**: save them with the run if they start to change often).
"""

import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.rules import Result
from apps.lead_finder.schemas import TestItem, TestPage, TestReport, TestSummary
from apps.lead_finder.scoring import Tier
from apps.lead_finder.sources import FACT_FIELDS
from apps.lead_finder.tables import Lead, company_key
from core.api.errors import Problem
from core.runs.models import Run
from core.runs.models import RunEvent as RunEventRow

TESTSET = Path(__file__).resolve().parent / "testset.yaml"
APP = "lead_finder"
MODE = "testset"
CENT = Decimal("0.01")
TIER_RANK: dict[str, int] = {"discard": 0, "C": 1, "B": 2, "A": 3}  # low to high


class TestExpect(BaseModel):
    """What the rules make certain about a company's result."""

    __test__ = False
    model_config = ConfigDict(extra="forbid")

    results: list[Result] = Field(min_length=1)


class TestCompany(BaseModel):
    __test__ = False
    model_config = ConfigDict(extra="forbid")

    name: str
    city: str | None = None
    website: str | None = None
    why: str
    expect: TestExpect | None = None
    tier_range: tuple[Tier, Tier] | None = None  # (lowest, highest), PLAN-V21 T2-5

    @model_validator(mode="after")
    def _low_first(self) -> "TestCompany":
        if self.tier_range is not None:
            low, high = self.tier_range
            if TIER_RANK[low] > TIER_RANK[high]:
                raise ValueError(f"{self.name}: tier_range must go from the lowest to the highest")
        return self


def in_range(tier: str | None, tiers: tuple[Tier, Tier] | None) -> bool | None:
    """Whether a tier is inside a range. None with no range, or no tier (the company failed)."""
    if tiers is None or tier is None or tier not in TIER_RANK:
        return None
    low, high = tiers
    return TIER_RANK[low] <= TIER_RANK[tier] <= TIER_RANK[high]


class TestSet(BaseModel):
    __test__ = False
    model_config = ConfigDict(extra="forbid")

    companies: list[TestCompany] = Field(min_length=1)


def load_testset(path: Path = TESTSET) -> TestSet:
    return TestSet.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def unknown_facts(facts: dict[str, Any]) -> list[str]:
    """The facts of a card (as stored JSON) that research could not find."""
    found: list[str] = []
    for name in FACT_FIELDS:
        value = facts.get(name)
        if not isinstance(value, dict) or value.get("value") is None:
            found.append(name)
    return found


# --- Reports -------------------------------------------------------------------------------------


def _not_a_test_run() -> Problem:
    return Problem(404, "Test run not found", "There is no test set run with this id.")


async def _leads_by_key(session: AsyncSession, run_id: uuid.UUID) -> dict[str, Lead]:
    rows = await session.scalars(select(Lead).where(Lead.run_id == run_id))
    return {lead.company_key: lead for lead in rows}


async def _why_not(session: AsyncSession, run_id: uuid.UUID) -> dict[str, str]:
    """Why a company has no lead: the reason of its company_failed or company_skipped event."""
    rows = await session.execute(
        select(RunEventRow.type, RunEventRow.data)
        .where(
            RunEventRow.run_id == run_id,
            RunEventRow.type.in_(("company_failed", "company_skipped")),
        )
        .order_by(RunEventRow.seq)
    )
    found: dict[str, str] = {}
    for event_type, data in rows:
        name = data.get("name")
        if isinstance(name, str):
            word = "Failed" if event_type == "company_failed" else "Skipped"
            found[company_key(name)] = f"{word}: {data.get('reason', '')}".strip()
    return found


def _summary(run: Run, items: list[TestItem]) -> TestSummary:
    expected = [item for item in items if item.expected is not None]
    ranged = [item for item in items if item.tier_range is not None]
    researched = [item for item in items if item.result is not None]
    total = Decimal(run.cost_usd)
    average = (total / len(researched)).quantize(CENT) if researched else Decimal(0)
    return TestSummary(
        run_id=run.id,
        created_at=run.created_at,
        status=run.status,
        companies=len(items),
        expected=len(expected),
        matched=sum(1 for item in expected if item.ok),
        ranged=len(ranged),
        in_range=sum(1 for item in ranged if item.in_range),
        avg_cost_usd=average,
        total_cost_usd=total,
        rules_version=run.rules_version,
        prompt_versions=run.prompt_versions,
    )


async def _items(session: AsyncSession, run: Run, testset: TestSet) -> list[TestItem]:
    leads = await _leads_by_key(session, run.id)
    why_not = await _why_not(session, run.id)
    items: list[TestItem] = []
    for company in testset.companies:
        key = company_key(company.name)
        lead = leads.get(key)
        expected = list(company.expect.results) if company.expect else None
        result = lead.result if lead is not None else None
        tier = lead.tier if lead is not None else None
        facts = lead.card.get("facts", {}) if lead is not None else {}
        items.append(
            TestItem(
                name=company.name,
                city=company.city,
                expected=expected,
                result=result,
                score=lead.score if lead is not None else None,
                unknown_facts=unknown_facts(facts) if lead is not None else [],
                cost_usd=Decimal(lead.cost_usd) if lead is not None else Decimal(0),
                ok=None if expected is None else (result is not None and result in expected),
                lead_id=lead.id if lead is not None else None,
                note=None if lead is not None else why_not.get(key, "Not researched"),
                tier=tier,
                tier_range=list(company.tier_range) if company.tier_range else None,
                in_range=in_range(tier, company.tier_range),
            )
        )
    return items


async def report_of_testset(
    session: AsyncSession, run_id: uuid.UUID, testset: TestSet | None = None
) -> TestReport:
    """One test set run, company by company. Raises Problem 404 for any other run."""
    run = await session.get(Run, run_id)
    if run is None or run.app != APP or run.mode != MODE:
        raise _not_a_test_run()
    items = await _items(session, run, testset or load_testset())
    return TestReport(summary=_summary(run, items), items=items)


async def list_testset_runs(
    session: AsyncSession, limit: int = 50, offset: int = 0, testset: TestSet | None = None
) -> TestPage:
    """One summary for each test set run, newest first."""
    chosen = testset or load_testset()
    where = (Run.app == APP, Run.mode == MODE)
    total = await session.scalar(select(func.count()).select_from(Run).where(*where)) or 0
    runs = await session.scalars(
        select(Run)
        .where(*where)
        .order_by(Run.created_at.desc(), Run.id)
        .limit(limit)
        .offset(offset)
    )
    items = [_summary(run, await _items(session, run, chosen)) for run in runs]
    return TestPage(total=total, items=items)
