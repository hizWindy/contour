"""A goal of good leads is a number to report against, never a reason to stop a run (PLAN-V20).

Before PLAN-V20 a run a person started aimed for 20 good leads (PLAN-V16 T1-9): the Start page asked
how many, the estimate said how many companies that needed, the run stopped starting companies once
it had them, and a run that ended short said "Found 12 of 20 leads". None of the first 7 live runs
found more than 3 good leads, so it never stopped one, and it only put a bar that read 0 of 20 on
every run page. The runs themselves are in test_runs.py.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from apps.lead_finder.options import build_run_options
from apps.lead_finder.params import DiscoveryParams
from apps.lead_finder.rules import load_rules
from core.config import EDITABLE_KEYS, Settings
from core.runs.schemas import RunCaps, RunCounts, RunOut
from tests.lead_finder.conftest import lf_settings

D = Decimal


def test_the_start_page_no_longer_offers_how_many_leads() -> None:
    options = build_run_options(load_rules(), lf_settings(), D("10"))
    assert "goal_leads" not in options.model_dump()
    assert set(options.sources) == {"web", "property_daily", "arealytics"}


def test_there_is_no_setting_for_how_many_leads_a_run_a_person_starts_aims_for() -> None:
    assert "manual_run_goal_leads" not in EDITABLE_KEYS
    assert "manual_run_goal_leads" not in Settings.model_fields
    assert "lead_finder_goal_good_leads" in EDITABLE_KEYS  # the round's goal stays: Levi's number


def test_a_page_that_was_open_before_the_change_can_still_send_a_goal() -> None:
    """It is accepted, and ignored: the run page shows no goal for such a run."""
    assert DiscoveryParams(goal_leads=35).goal_leads == 35
    assert DiscoveryParams().goal_leads is None


def test_a_run_shows_its_goal_its_good_leads_and_where_they_came_from() -> None:
    """An automatic run still reports against its share of the round's goal."""
    counts = RunCounts(goal=25, good=12, by_source={"web": 10, "property_daily": 3})

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
    assert (shown["goal_leads"], shown["good_leads"]) == (25, 12)
    assert shown["leads_by_source"] == {"web": 10, "property_daily": 3, "arealytics": 0}
    assert run("other").leads_by_source == {"web": 10, "property_daily": 3}
    assert RunOut.model_validate(shown).goal_leads == 25  # read back the same
