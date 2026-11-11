"""GET /api/v1/health/details (PLAN-V13 T1-2), on the test database and the real app.

The calls to the outside are fakes that count their calls: Claude's model list, Signal Hire's
balance and HubSpot's permission check. The database and the migrations are the real ones.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import Settings
from core.health.checks import Probes
from core.hubspot.check import PROBES, ConnectionCheck, ScopeOut
from core.signalhire.client import SignalHireUnavailable
from tests.core.auth_world import World, make_account, sign_in

pytestmark = pytest.mark.integration

URL = "/api/v1/health/details"
Factory = async_sessionmaker[AsyncSession]


@dataclass
class Calls:
    claude: list[str] = field(default_factory=list)
    signalhire: int = 0
    hubspot: list[bool] = field(default_factory=list)
    signalhire_refuses: bool = False


def probes(calls: Calls) -> Probes:
    async def claude(key: str) -> None:
        calls.claude.append(key)

    async def credits(settings: Settings) -> int:
        calls.signalhire += 1
        if calls.signalhire_refuses:
            raise SignalHireUnavailable("Signal Hire refused the key", "Check the key.")
        return 27

    async def hubspot(app: FastAPI, refresh: bool) -> ConnectionCheck:
        calls.hubspot.append(refresh)
        scopes = [
            ScopeOut(scope=p.scope, access=p.access, label=p.label, state="yes") for p in PROBES
        ]
        return ConnectionCheck(
            key_set=True, connected=True, scopes=scopes, checked_at=datetime.now(UTC)
        )

    return Probes(claude_models=claude, signalhire_credits=credits, hubspot_check=hubspot)


@dataclass
class Setup:
    world: World
    client: httpx.AsyncClient
    calls: Calls
    factory: Factory


@pytest.fixture
async def setup(world: World, session_factory: Factory) -> AsyncIterator[Setup]:
    world.settings(auth_required=True)
    calls = Calls()
    world.app.state.health_probes = probes(calls)
    world.app.state.health_settings = Settings(
        _env_file=None,
        anthropic_api_key="sk-ant-test",
        signalhire_api_key="sh-test",
        email_provider="log",
    )
    async with world.browser() as client:
        yield Setup(world, client, calls, session_factory)


async def signed_in_as(setup: Setup, role: str) -> None:
    await make_account(setup.world)
    async with setup.factory() as db:
        await db.execute(text("UPDATE core.users SET role = :role"), {"role": role})
        await db.commit()
    assert (await sign_in(setup.client)).status_code == 200


async def test_no_session_is_401(setup: Setup) -> None:
    answer = await setup.client.get(URL)
    assert (answer.status_code, answer.json()["code"]) == (401, "auth_required")


@pytest.mark.parametrize("role", ["staff", "viewer"])
async def test_staff_and_viewers_get_403_and_nothing_is_checked(setup: Setup, role: str) -> None:
    await signed_in_as(setup, role)
    answer = await setup.client.get(URL)
    assert (answer.status_code, answer.json()["code"]) == (403, "admin_only")
    assert (setup.calls.claude, setup.calls.signalhire, setup.calls.hubspot) == ([], 0, [])


async def test_an_admin_gets_every_system(setup: Setup) -> None:
    await signed_in_as(setup, "admin")
    answer = await setup.client.get(URL)
    assert answer.status_code == 200, answer.text
    body = answer.json()
    found = {item["id"]: item for item in body["checks"]}
    assert list(found) == [
        "database",
        "claude",
        "hubspot",
        "signalhire",
        "email",
        "schedules",
        "api",
    ]
    assert found["database"]["state"] == "ok"
    assert found["database"]["sentence"].startswith("It answers. pgvector ")
    assert found["claude"]["state"] == "ok"
    assert found["claude"]["sentence"].startswith("Key works. US$0.00 spent in the last 24 hours")
    assert setup.calls.claude == ["sk-ant-test"]  # the model list only: the fake is all it calls
    assert (found["hubspot"]["state"], found["hubspot"]["sentence"]) == (
        "problem",
        "No sync has finished yet.",
    )
    assert found["signalhire"]["sentence"] == "Key works. The account has 27 credits."
    assert found["email"]["state"] == "off"
    assert (found["schedules"]["state"], found["schedules"]["sentence"]) == (
        "off",
        "Every schedule is off.",
    )
    assert found["api"]["state"] == "ok"
    for item in body["checks"]:
        assert item["took_ms"] >= 0 and item["checked_at"]
    assert body["schedules"] == []


async def test_the_answer_is_kept_for_a_minute_unless_asked_again(setup: Setup) -> None:
    await signed_in_as(setup, "admin")
    first = (await setup.client.get(URL)).json()
    again = (await setup.client.get(URL)).json()
    assert again == first
    assert (len(setup.calls.claude), setup.calls.signalhire, setup.calls.hubspot) == (1, 1, [False])

    setup.calls.signalhire_refuses = True
    fresh = (await setup.client.get(URL, params={"refresh": "true"})).json()
    assert (len(setup.calls.claude), setup.calls.signalhire, setup.calls.hubspot) == (
        2,
        2,
        [False, True],
    )
    signalhire = next(item for item in fresh["checks"] if item["id"] == "signalhire")
    assert signalhire == {
        **signalhire,
        "state": "problem",
        "sentence": "Signal Hire refused the key.",
        "next_step": "Check the key.",
    }
    # The two earlier requests were counted by the API's own counter, by the path in the code.
    counted = {(item["method"], item["path"]): item for item in fresh["api"]["endpoints"]}
    assert counted[("GET", URL)]["requests"] >= 2
    assert counted[("GET", URL)]["errors"] == 0
