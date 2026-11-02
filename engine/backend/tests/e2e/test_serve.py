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
    SIGNALHIRE_SAMPLE,
    build_app,
    fake_claude,
    research_signalhire_sample,
    sample_world,
    use_e2e_database,
)

TODAY = date(2026, 10, 26)


@pytest.fixture
def settings_restored(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """`use_e2e_database` changes the environment. Put every name it touches back after the test."""
    for name in (
        "POSTGRES_DB",
        "ANTHROPIC_API_KEY",
        "SIGNALHIRE_API_KEY",
        "HUBSPOT_NAMES_TO_CLAUDE_OK",
    ):
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
async def test_the_signalhire_sample_gets_its_staff_number_from_signal_hire(
    session: AsyncSession,
) -> None:
    card = await research_signalhire_sample(session, get_embedder(), TODAY)

    assert card.company == SIGNALHIRE_SAMPLE
    assert card.facts.staff_in_city.value == 210  # 105 people on file x 2
    assert card.from_signalhire == [
        "Staff in Melbourne: about 210, from Signal Hire (105 people on file x 2, TBC)."
    ]
    assert card.result == "pass" and card.problems == [] and card.dropped == []
