"""The fake backend's parts that need no database: the sample world and the Claude it uses.

The whole fake backend (a run through the sample world over HTTP) is in
tests/lead_finder/test_flow.py.
"""

from datetime import date

from core.api.deps import claude_dependency
from tests.e2e.serve import build_app, fake_claude, sample_world

TODAY = date(2026, 10, 26)


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
