"""The email when a scheduled run ends (PLAN-V9 C2): what it says, who gets it, and that a run a
person started sends none. Sent with the log sender, so nothing leaves this computer."""

import asyncio
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI

from apps.lead_finder.jobs import start_discovery
from apps.lead_finder.run_email import (
    GoodLead,
    build_email,
    cost_per_good_lead,
    good_leads,
    review_link,
    should_email,
)
from core.email.sender import log_sender
from core.runs.manager import RunManager
from core.runs.schemas import RunCaps, RunCounts, RunOut
from core.schedules.jobs import JobContext
from tests.core.runs_fakes import wait_until_idle
from tests.lead_finder.conftest import APP, MakeLeadFinderManager, lf_settings
from tests.lead_finder.jobs_world import NOW, Gate, add_past_prices, the_schedule, waiting_kinds
from tests.lead_finder.samples import FakeClaude, sample_scenario

D = Decimal
RUN_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
LINK = f"https://hq.example.com/results?run_id={RUN_ID}"


def run(**changes: Any) -> RunOut:
    values: dict[str, Any] = {
        "id": RUN_ID,
        "app": "lead_finder",
        "mode": "discovery",
        "status": "done",
        "params": {"cities": ["Melbourne"]},
        "caps": RunCaps(run_cap_usd=D(20), max_companies=20, company_cap_usd=D("2.50")),
        "rules_version": "v",
        "prompt_versions": "p",
        "cost_usd": D("3.60"),
        "web_searches": 10,
        "claude_requests": 12,
        "counts": RunCounts(by_result={"pass": 1, "director_review": 2, "watch": 4, "drop": 5}),
        "stop_reason": None,
        "error": None,
        "error_id": None,
        "schedule_id": uuid.uuid4(),
        "cancel_requested_at": None,
        "created_at": datetime(2026, 11, 9, tzinfo=UTC),
        "started_at": None,
        "finished_at": None,
    }
    return RunOut(**{**values, **changes})


TOP = [
    GoodLead("Sample Energy", "pass", 82, "Sample Energy is hiring 120 engineers in Melbourne."),
    GoodLead("Sample Defence", "director_review", 70, "Won a $40M navy contract."),
]


# --- What it says (pure) -------------------------------------------------------------------------


def test_good_leads_and_the_cost_of_each() -> None:
    assert good_leads({"pass": 1, "director_review": 2, "watch": 4}) == 3
    assert cost_per_good_lead(D("3.60"), 3) == D("1.20")  # the plan's US$1.20
    assert cost_per_good_lead(D("3.60"), 0) is None


def test_a_done_run_says_the_numbers_the_top_leads_and_links_to_the_review() -> None:
    email = build_email(run(), TOP, LINK)
    assert email.subject == "Lead Finder: 3 good leads in Melbourne"
    text = email.text
    assert "3 good leads (Pass or Director review), 4 Watch, 5 Drop." in text
    assert "Cost US$3.60, US$1.20 per good lead." in text
    assert "1. Sample Energy (Pass, score 82): Sample Energy is hiring 120 engineers" in text
    assert "2. Sample Defence (Director review, score 70): Won a $40M navy contract." in text
    assert f"Review the leads: {LINK}" in text
    assert "Nothing goes to HubSpot until you approve it." in text
    assert "Review the leads</a>" in email.html
    assert f'href="{LINK}"' in email.html


def test_a_run_with_no_good_leads_says_so() -> None:
    email = build_email(run(counts=RunCounts(by_result={"watch": 2})), [], LINK)
    assert email.subject == "Lead Finder: 0 good leads in Melbourne"
    assert "No good leads yet." in email.text


def test_a_run_that_stopped_early_says_why_with_its_numbers() -> None:
    email = build_email(run(stop_reason="The run reached its limit of US$20.00"), TOP, LINK)
    assert "It stopped early: The run reached its limit of US$20.00" in email.text


@pytest.mark.parametrize(("status", "what"), [("failed", "failed"), ("cancelled", "was stopped")])
def test_a_failed_or_stopped_run_sends_a_short_why(status: str, what: str) -> None:
    email = build_email(run(status=status, stop_reason="Claude can't be reached"), [], LINK)
    assert email.subject == f"Lead Finder: the Melbourne run {what}"
    assert "Why: Claude can't be reached" in email.text
    assert "The top good leads" not in email.text


def test_html_in_a_company_name_is_shown_as_text() -> None:
    email = build_email(run(), [GoodLead("<b>Bold</b> Co", "pass", 80, "x")], LINK)
    assert "&lt;b&gt;Bold&lt;/b&gt; Co" in email.html


def test_only_a_scheduled_run_that_ended_for_good_emails() -> None:
    assert should_email(run())
    assert not should_email(run(schedule_id=None))  # a person started it
    assert not should_email(run(status="interrupted"))  # it carries on later
    assert not should_email(run(status="running"))


def test_the_link_uses_app_url_then_the_public_origin() -> None:
    assert review_link(lf_settings(app_url="https://hq.example.com/"), RUN_ID) == LINK
    laptop = review_link(lf_settings(), RUN_ID)
    assert laptop == f"http://localhost:5173/results?run_id={RUN_ID}"


# --- A fake scheduled run ------------------------------------------------------------------------

db = pytest.mark.integration
NOTIFY = lf_settings(
    lead_finder_notify_emails=["levi@example.com"], app_url="https://hq.example.com"
)
CHOICES = {"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30}


def scheduled(manager: RunManager, schedule_id: uuid.UUID, settings: dict[str, Any]) -> JobContext:
    app = FastAPI()
    app.state.run_manager = manager
    return JobContext(app, schedule_id, settings, NOW)


@db
async def test_a_scheduled_run_sends_one_email_with_its_numbers_and_link(
    make_lf_manager: MakeLeadFinderManager, session_factory: Any
) -> None:
    await add_past_prices(session_factory)
    schedule = await the_schedule(session_factory, CHOICES)
    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()), settings=NOTIFY)
    before = len(log_sender().sent)

    started = await start_discovery(scheduled(manager, schedule.id, CHOICES))
    await wait_until_idle(manager, timeout=60)

    sent = log_sender().sent[before:]
    assert len(sent) == 1
    (email,) = sent
    assert email.to == ["levi@example.com"]
    assert email.subject == "Lead Finder: 2 good leads in Melbourne"  # Unyte and Boxhill pass
    assert f"https://hq.example.com/results?run_id={started.ref}" in email.text
    assert "The top good leads:" in email.text


@db
async def test_a_run_a_person_started_sends_no_email(
    make_lf_manager: MakeLeadFinderManager, session_factory: Any
) -> None:
    await add_past_prices(session_factory)
    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()), settings=NOTIFY)
    before = len(log_sender().sent)
    await manager.start(APP, "discovery", CHOICES)
    await wait_until_idle(manager, timeout=60)
    assert log_sender().sent[before:] == []


@db
async def test_a_stopped_scheduled_run_sends_the_why_email(
    make_lf_manager: MakeLeadFinderManager, session_factory: Any
) -> None:
    await add_past_prices(session_factory)
    schedule = await the_schedule(session_factory, CHOICES)
    gate = Gate()
    manager = make_lf_manager(FakeClaude(), settings=NOTIFY, kinds=waiting_kinds(gate))
    before = len(log_sender().sent)

    started = await start_discovery(scheduled(manager, schedule.id, CHOICES))
    await asyncio.wait_for(gate.entered.wait(), 10)
    await manager.cancel(uuid.UUID(started.ref or ""))
    await wait_until_idle(manager, timeout=30)

    (email,) = log_sender().sent[before:]
    assert email.subject == "Lead Finder: the Melbourne run was stopped"
    assert "Why: " in email.text


@db
async def test_no_addresses_means_no_email(
    make_lf_manager: MakeLeadFinderManager, session_factory: Any
) -> None:
    await add_past_prices(session_factory)
    schedule = await the_schedule(session_factory, CHOICES)
    manager = make_lf_manager(FakeClaude(scenario=sample_scenario()))  # no addresses
    before = len(log_sender().sent)
    await start_discovery(scheduled(manager, schedule.id, CHOICES))
    await wait_until_idle(manager, timeout=60)
    assert log_sender().sent[before:] == []
