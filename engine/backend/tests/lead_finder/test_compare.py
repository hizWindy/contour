"""`lead-finder compare-research` (PLAN-V27 T5-2), with the fake Claude: it measures both kinds of
research for each company, stops before the US$20 limit could pass, and spends nothing without
`--yes`. The paid run itself is on Al-khair's word."""

from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder import cli
from apps.lead_finder.compare import Measured, compare, table
from apps.lead_finder.research import ResearchRequest
from apps.lead_finder.rules import load_rules
from core.config import Settings
from core.memory.embedder import get_embedder
from tests.lead_finder.samples import FakeClaude


def settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def test_without_yes_it_says_the_most_it_costs_and_spends_nothing(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_claude() -> None:
        raise AssertionError("no Claude without --yes")

    monkeypatch.setattr(cli, "get_claude", no_claude)
    assert cli.main(["compare-research"]) == 1
    said = capsys.readouterr().out
    assert "twice" in said
    assert "At most US$20.00" in said  # 10 companies x 2 x US$2.50, held to the limit
    assert "--yes" in said


async def test_it_stops_before_a_company_that_could_pass_the_limit() -> None:
    requests = [ResearchRequest(company="Northwind", city="Sydney")]
    measured, stopped = await compare(
        None,  # type: ignore[arg-type]  # nothing is researched, so no database is used
        get_embedder(),
        FakeClaude(),
        load_rules(),
        settings(),
        requests,
        limit_usd=Decimal("4"),
    )
    assert measured == []
    assert stopped is not None and stopped.startswith("Stopped before Northwind")


def test_the_table_has_each_kind_and_its_middle_time() -> None:
    rows = [
        Measured("Northwind", "standard", 12, 2, Decimal("0.40"), 30.0, 90.0, "pass", "B"),
        Measured("Northwind", "deep", 14, 3, Decimal("0.70"), 20.0, 80.0, "pass", "B"),
    ]
    text = table(rows)
    assert "standard: 12 facts, US$0.40, middle time to the card 90 s" in text
    assert "deep: 14 facts, US$0.70, middle time to the card 80 s" in text
    assert "a person checks each fact" in text


@pytest.mark.integration
async def test_each_company_gets_both_kinds_measured(session: AsyncSession) -> None:
    claude = FakeClaude()
    requests = [ResearchRequest(company="Acme Software", city="Melbourne")]
    measured, stopped = await compare(
        session, get_embedder(), claude, load_rules(), settings(), requests
    )
    assert stopped is None
    assert [m.kind for m in measured] == ["standard", "deep"]
    standard, deep = measured
    assert standard.facts_found > 0 and deep.facts_found > 0
    assert deep.first_finding_s is not None  # the loop sends its findings as it goes
    assert all(m.cost_usd > 0 and m.card_s >= 0 for m in measured)
    assert "search:deep" in claude.calls and "search:property" in claude.calls
