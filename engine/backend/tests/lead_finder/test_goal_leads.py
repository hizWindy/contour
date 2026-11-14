"""How many leads a run a person starts aims for (PLAN-V16 T1-9): the companies a goal needs, the
limit that binds, the recent pass rate and why a run ended short. The runs themselves are in
test_runs.py."""

from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.goal import (
    DEFAULT_PASS_RATE,
    PASS_RATE_FLOOR,
    companies_needed,
    goal_note,
    recent_pass_rate,
    short_of_goal,
    stopped_words,
)
from apps.lead_finder.options import build_run_options
from apps.lead_finder.params import DiscoveryParams
from apps.lead_finder.rules import load_rules
from core.runs.models import Run
from core.runs.schemas import RunCaps, RunCounts, RunOut
from tests.lead_finder.conftest import lf_settings

D = Decimal


def test_a_goal_needs_its_leads_over_the_pass_rate() -> None:
    """The plan's example: 20 leads at a pass rate of 40% needs about 50 companies."""
    assert companies_needed(20, D("0.40")) == 50
    assert companies_needed(1, D("0.40")) == 3
    assert companies_needed(20, D("0")) == 400  # never under the floor (5%): never endless


def test_the_note_names_the_limit_that_binds() -> None:
    assert goal_note(20, 50, 20, 60, D("20")) == (
        "20 leads needs about 50 companies. This run's company limit allows 20. "
        "An Admin can raise it in Settings."
    )
    assert goal_note(20, 50, 60, 18, D("20")) == (
        "20 leads needs about 50 companies. This run's money limit (US$20) allows about 18. "
        "An Admin can raise it in Settings."
    )
    assert goal_note(5, 13, 20, 50, D("20")) is None  # it fits
    assert goal_note(1, 3, 2, 50, D("20")).startswith("1 lead needs")  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("kind", "over", "words"),
    [
        ("run_cost", 0, "It stopped at the run limit (US$20)."),
        ("daily", 0, "It stopped at today's limit for Claude."),
        ("max_companies", 0, "It researched the most companies one run may (20)."),
        (None, 3, "It researched the most companies one run may (20)."),
        (None, 0, "Discovery found no more companies to research."),
    ],
)
def test_a_run_that_ends_short_says_why(kind: Any, over: int, words: str) -> None:
    assert stopped_words(kind, D("20"), 20, over) == words
    sentence = short_of_goal(12, 20, words)
    assert sentence == f"Found 12 of 20 leads. {words}"
    assert len(sentence) <= 120  # what a run's stop_reason holds


def test_the_start_page_offers_how_many_leads() -> None:
    options = build_run_options(load_rules(), lf_settings(), D("10"))
    assert options.goal_leads.model_dump() == {"default": 20, "min": 1, "max": 100}
    mine = build_run_options(load_rules(), lf_settings(manual_run_goal_leads=35), D("10"))
    assert mine.goal_leads.default == 35
    assert set(options.sources) == {"web", "property_daily", "arealytics"}


def test_a_run_asks_for_1_to_100_leads() -> None:
    from pydantic import ValidationError

    assert DiscoveryParams(goal_leads=1).goal_leads == 1
    assert DiscoveryParams().goal_leads is None  # the settings' default applies
    for wrong in (0, 101):
        with pytest.raises(ValidationError):
            DiscoveryParams(goal_leads=wrong)


def test_a_run_shows_its_goal_its_good_leads_and_where_they_came_from() -> None:
    from datetime import UTC, datetime
    from uuid import uuid4

    counts = RunCounts(goal=20, good=12, by_source={"web": 10, "property_daily": 3})

    def run(app: str) -> RunOut:
        return RunOut(
            id=uuid4(),
            app=app,
            mode="discovery",
            status="done",
            params={},
            caps=RunCaps(),
            rules_version="",
            prompt_versions="",
            cost_usd=D(0),
            web_searches=0,
            claude_requests=0,
            counts=counts,
            stop_reason=None,
            error=None,
            error_id=None,
            cancel_requested_at=None,
            created_at=datetime.now(UTC),
            started_at=None,
            finished_at=None,
        )

    shown = run("lead_finder").model_dump()
    assert (shown["goal_leads"], shown["good_leads"]) == (20, 12)
    assert shown["leads_by_source"] == {"web": 10, "property_daily": 3, "arealytics": 0}
    assert run("other").leads_by_source == {"web": 10, "property_daily": 3}
    assert RunOut.model_validate(shown).goal_leads == 20  # read back the same


# --- The recent pass rate ----------------------------------------------------------------------


def done_run(
    researched: int, good: int, day: int, *, mode: str = "discovery", status: str = "done"
) -> Run:
    from datetime import UTC, datetime

    return Run(
        app="lead_finder",
        mode=mode,
        status=status,
        params={},
        caps={},
        counts={"researched": researched, "by_result": {"pass": good, "watch": researched - good}},
        created_at=datetime(2026, 11, day, tzinfo=UTC),
    )


@pytest.mark.integration
async def test_the_pass_rate_comes_from_the_last_5_runs(session: AsyncSession) -> None:
    first = await recent_pass_rate(session)
    assert (first.rate, first.runs) == (DEFAULT_PASS_RATE, 0)  # 40% until there are any

    session.add(done_run(10, 9, 1))  # the oldest: left out, 5 newer runs researched
    for day in range(2, 7):
        session.add(done_run(10, 2, day))
    session.add(done_run(0, 0, 7))  # researched nothing: not counted
    session.add(done_run(10, 10, 8, mode="watchlist"))  # not discovery
    session.add(done_run(10, 10, 9, status="failed"))  # didn't finish
    await session.commit()

    rate = await recent_pass_rate(session)
    assert (rate.rate, rate.runs) == (D("0.2"), 5)


@pytest.mark.integration
async def test_a_bad_run_never_makes_the_estimate_endless(session: AsyncSession) -> None:
    session.add(done_run(10, 0, 1))
    await session.commit()
    rate = await recent_pass_rate(session)
    assert (rate.rate, rate.runs) == (PASS_RATE_FLOOR, 1)
