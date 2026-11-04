"""The fake backend's parts: the sample world, the Claude it uses, and the Signal Hire sample.

The whole fake backend (a run through the sample world over HTTP) is in
tests/lead_finder/test_flow.py.
"""

import os
from collections.abc import Iterator
from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.deps import claude_dependency
from core.config import get_settings
from core.memory.embedder import get_embedder
from core.signalhire.client import get_signalhire
from tests.e2e.serve import (
    DEMO_EMAIL,
    DEMO_USERNAME,
    DEMO_WORDS,
    E2E_ENV_NAMES,
    SIGNALHIRE_SAMPLE,
    WIPED_TABLES,
    build_app,
    demo_password,
    fake_claude,
    research_signalhire_sample,
    sample_world,
    use_e2e_database,
)

TODAY = date(2026, 10, 26)


@pytest.fixture
def settings_restored(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """`use_e2e_database` changes the environment. Put every name it touches back after the test."""
    for name in E2E_ENV_NAMES:
        monkeypatch.setenv(name, "set before the test")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()  # so no later test sees the e2e settings


def test_every_company_found_is_a_sample_found_this_week() -> None:
    scenario, company_facts = sample_world(TODAY)
    found = [company for companies in scenario.values() for company in companies]

    assert found and all(company.name.startswith("Sample ") for company in found)
    assert {company.date for company in found} == {"2026-10-23"}
    assert set(company_facts) <= {company.name for company in found}
    assert {city for _, city in scenario} == {"Melbourne", "Adelaide", "Perth"}


def test_runs_and_the_research_route_use_the_fake_claude() -> None:
    claude = fake_claude(TODAY, delay_seconds=0)
    app = build_app(claude)

    assert app.state.claude_provider() is claude
    assert app.dependency_overrides[claude_dependency]() is claude


@pytest.mark.usefixtures("settings_restored")
def test_no_key_for_a_real_service_survives_into_the_fake_backend() -> None:
    """Whatever engine/.env holds, a run on the fake backend reaches neither Claude nor Signal
    Hire."""
    use_e2e_database()

    assert os.environ["ANTHROPIC_API_KEY"] == ""
    assert os.environ["SIGNALHIRE_API_KEY"] == ""
    assert get_signalhire(get_settings()) is None  # so no client can be made, even if it is on


@pytest.mark.integration
async def test_the_signalhire_sample_shows_details_people_and_a_staff_conflict(
    session: AsyncSession,
) -> None:
    card = await research_signalhire_sample(session, get_embedder(), TODAY)

    assert card.company == SIGNALHIRE_SAMPLE
    assert card.facts.staff_in_city.value == 570  # 285 people on file x 2: the main source wins
    assert card.from_signalhire == [
        "Staff in Melbourne: about 570, from Signal Hire (285 people on file x 2, TBC)."
    ]
    staff = next(entry for entry in card.fact_sources if entry.fact == "staff_in_city")
    assert [(other.source, other.value) for other in staff.others] == [("claude", "250")]
    assert staff.conflict is not None  # 570 against 250: more than 2 times apart
    assert card.signalhire_company is not None
    assert card.signalhire_company.offices[0].head_office is True
    assert len(card.signalhire_people) == 2 and len(card.facts.decision_makers) == 1
    assert card.result == "pass" and card.problems == [] and card.dropped == []


# --- Sign-in in the fake backend (PLAN-V6 B4) -------------------------------------------------


@pytest.mark.usefixtures("settings_restored")
def test_sign_in_is_off_in_the_fake_backend_whatever_the_environment_says(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "true")  # as if engine/.env had it on
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    use_e2e_database()
    settings = get_settings()
    assert (settings.auth_required, settings.session_cookie_secure) == (False, False)


@pytest.mark.usefixtures("settings_restored")
def test_the_auth_option_turns_sign_in_on_and_never_secure() -> None:
    use_e2e_database(auth=True)
    settings = get_settings()
    assert (settings.auth_required, settings.session_cookie_secure) == (True, False)


def test_the_sign_in_tables_are_wiped_on_every_start() -> None:
    assert {"core.audit_log", "core.sessions", "core.users"} <= set(WIPED_TABLES)


def test_the_demo_password_is_new_each_time_and_passes_the_rules() -> None:
    from core.auth.passwords import check_rules

    passwords = {demo_password() for _ in range(40)}
    assert len(passwords) > 30  # random, not fixed
    for password in passwords:
        assert check_rules(password, email=DEMO_EMAIL, username=DEMO_USERNAME) == [], password
        assert all(word in DEMO_WORDS for word in password.split("-"))
