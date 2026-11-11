"""Call prep races (PLAN-V15 T3-2): two things at once never pay twice or fail.

- two starts for the same call give one prep, even when both get past the first check;
- a prep a restart left searching is failed before a new one starts, and a slow one that is
  really running comes back instead of a second, paid one;
- two preps for one company pay for one web check: the second waits and reuses its notes;
- two first saves of a line edit, or of Your style, never give a 500;
- two Admins adding a team note at once never pass 8 notes;
- migration 0017 fails stuck preps, keeps the newest searching one for each call, and runs down.
"""

import asyncio
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest
from alembic import command
from psycopg import sql
from pydantic import BaseModel
from sqlalchemy import func, select

from apps.companies import api_preps
from apps.companies import prep as prep_module
from apps.companies.prep import STUCK_ERROR, PrepRunner
from apps.companies.tables import Prep, ScriptEdit, ScriptStyle
from core.api.deps import settings_dependency
from core.claude.client import Reply, WebTools
from core.config import get_settings
from tests.companies.helpers import API, signed_in_as
from tests.companies.test_prep import FakeClaude, people_and_calls, prep_settings
from tests.companies.test_script_notes import as_admin
from tests.conftest import alembic_config, server_conninfo
from tests.core.auth_world import World
from tests.lead_finder.factories import FakeEmbedder

pytestmark = pytest.mark.integration
PREPS = f"{API}/preps"
CALL = {"company_key": "101", "contact_id": "c1"}


class GatedClaude(FakeClaude):
    """A fake Claude whose first request waits until the test opens the gate."""

    def __init__(self) -> None:
        super().__init__()
        self.gate = asyncio.Event()
        self.waiting = asyncio.Event()

    async def ask[T: BaseModel](
        self,
        *,
        system: str,
        prompt: str,
        form: type[T],
        web: WebTools | None = None,
        model: str | None = None,
        effort: str | None = None,
        max_continues: int | None = None,
    ) -> Reply[T]:
        if not self.waiting.is_set():
            self.waiting.set()
            await self.gate.wait()
        return await super().ask(
            system=system,
            prompt=prompt,
            form=form,
            web=web,
            model=model,
            effort=effort,
            max_continues=max_continues,
        )


@pytest.fixture
def claude() -> GatedClaude:
    return GatedClaude()


@pytest.fixture
def runner(world: World, claude: GatedClaude) -> PrepRunner:
    made = PrepRunner(sessions=world.factory, claude=lambda: claude, embedder=FakeEmbedder)
    world.app.state.prep_runner = made
    return made


@pytest.fixture
def prep_on(world: World) -> Iterator[None]:
    world.app.dependency_overrides[settings_dependency] = lambda: prep_settings()
    yield


async def preps(world: World) -> list[Prep]:
    async with world.factory() as db:
        return list(await db.scalars(select(Prep).order_by(Prep.created_at)))


async def finish(claude: GatedClaude, runner: PrepRunner) -> None:
    claude.gate.set()
    await runner.wait()


# --- Duplicate preps ----------------------------------------------------------------------------


@pytest.mark.usefixtures("prep_on")
async def test_two_starts_for_one_call_give_one_prep(
    world: World, claude: GatedClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first, second = await asyncio.gather(
            client.post(PREPS, json=CALL), client.post(PREPS, json=CALL)
        )
        assert first.status_code == second.status_code == 202, (first.text, second.text)
        assert first.json()["id"] == second.json()["id"]
        await finish(claude, runner)
    assert len(await preps(world)) == 1
    assert len(claude.asked) == 1


@pytest.mark.usefixtures("prep_on")
async def test_the_unique_index_catches_a_start_that_got_past_the_check(
    world: World, claude: GatedClaude, runner: PrepRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both starts read "nothing running" before either saved: the second one's save hits the
    unique index, and it gets the first one's prep back."""
    await people_and_calls(world)
    real = api_preps._searching
    blind = {"once": False}

    async def searching(*args: Any) -> Prep | None:
        if blind["once"]:
            blind["once"] = False
            return None
        return await real(*args)

    monkeypatch.setattr(api_preps, "_searching", searching)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first = await client.post(PREPS, json=CALL)
        await claude.waiting.wait()
        blind["once"] = True
        second = await client.post(PREPS, json=CALL)
        assert second.status_code == 202, second.text
        assert second.json()["id"] == first.json()["id"]
        await finish(claude, runner)
    assert len(await preps(world)) == 1


@pytest.mark.usefixtures("prep_on")
async def test_a_stuck_prep_fails_first_and_a_slow_running_one_comes_back(
    world: World, claude: GatedClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    long_ago = datetime.now(UTC) - timedelta(minutes=10)
    stuck = Prep(
        company_key="101",
        company_name="ABC Logistics",
        contact_id="c1",
        status="searching",
        created_at=long_ago,
    )
    slow = Prep(
        company_key="101", company_name="ABC Logistics", status="searching", created_at=long_ago
    )
    async with world.factory() as db:
        db.add_all([stuck, slow])
        await db.commit()
    runner._busy.add(slow.id)  # still running here, after 10 minutes
    async with signed_in_as(world, "mia", ["companies"]) as client:
        new = await client.post(PREPS, json=CALL)
        assert new.status_code == 202, new.text
        assert new.json()["id"] != str(stuck.id)
        # The cold call's prep is slow but alive: it comes back, and nothing new is paid for.
        cold = await client.post(PREPS, json={"company_key": "101", "cold": True})
        assert cold.json()["id"] == str(slow.id)
        runner._busy.discard(slow.id)
        await finish(claude, runner)
    by_id = {prep.id: prep for prep in await preps(world)}
    assert by_id[stuck.id].status == "failed"
    assert by_id[stuck.id].error == STUCK_ERROR
    assert len(by_id) == 3
    assert len(claude.asked) == 1


# --- One web check ------------------------------------------------------------------------------


@pytest.mark.usefixtures("prep_on")
async def test_two_preps_for_one_company_pay_for_one_web_check(
    world: World, claude: GatedClaude, runner: PrepRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(prep_module, "WEB_WAIT_POLL_SECONDS", 0.05)
    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        person = await client.post(PREPS, json=CALL)
        await claude.waiting.wait()  # the first one is doing its web check
        cold = await client.post(PREPS, json={"company_key": "101", "cold": True})
        assert person.status_code == cold.status_code == 202
        await asyncio.sleep(0.2)
        assert len(claude.asked) == 0  # the second one waits for the first one's check
        await finish(claude, runner)
    searched = [ask for ask in claude.asked if ask["web"] is not None]
    assert len(claude.asked) == 2
    assert len(searched) == 1
    done = {str(prep.id): prep for prep in await preps(world)}
    assert done[person.json()["id"]].status == "ready"
    assert done[person.json()["id"]].web_searches > 0
    assert done[cold.json()["id"]].status == "ready"
    assert done[cold.json()["id"]].web_searches == 0


async def test_a_prep_waits_for_another_web_check_only_so_long(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the other check never ends, the prep goes on without the web, never paying twice."""
    monkeypatch.setattr(prep_module, "WEB_WAIT_SECONDS", 0.2)
    monkeypatch.setattr(prep_module, "WEB_WAIT_POLL_SECONDS", 0.05)
    other = Prep(
        company_key="101", company_name="ABC", contact_id="c1", status="searching", facts={}
    )
    mine = Prep(company_key="101", company_name="ABC", status="searching", facts={})
    async with world.factory() as db:
        db.add_all([other, mine])
        await db.commit()
        assert await prep_module.take_web_check(db, other, days=7) is True
        assert await prep_module.take_web_check(db, mine, days=7) is False


# --- First saves --------------------------------------------------------------------------------


async def test_two_first_saves_never_give_a_500(world: World) -> None:
    async with signed_in_as(world, "mia", ["companies"]) as client:
        lines = await asyncio.gather(
            client.put(f"{API}/script-edits", json={**CALL, "slot": "goal", "text": "One."}),
            client.put(f"{API}/script-edits", json={**CALL, "slot": "goal", "text": "Two."}),
        )
        assert [line.status_code for line in lines] == [200, 200], [x.text for x in lines]
        styles = await asyncio.gather(
            client.put(f"{API}/script-style/mine", json={"text": "Short openers."}),
            client.put(f"{API}/script-style/mine", json={"text": "Warm openers."}),
        )
        assert [style.status_code for style in styles] == [200, 200], [x.text for x in styles]
        assert (await client.get(f"{API}/script-style")).json()["mine"] in (
            "Short openers.",
            "Warm openers.",
        )
        # Saving again still replaces it, and an empty text still clears it.
        again = await client.put(f"{API}/script-style/mine", json={"text": "Plain words."})
        assert again.json()["mine"] == "Plain words."
        cleared = await client.put(f"{API}/script-style/mine", json={"text": ""})
        assert cleared.json()["mine"] == ""
    async with world.factory() as db:
        assert await db.scalar(select(func.count()).select_from(ScriptEdit)) == 1
        assert await db.scalar(select(func.count()).select_from(ScriptStyle)) == 0


async def test_two_admins_at_once_never_pass_8_team_notes(world: World) -> None:
    async with world.factory() as db:
        db.add_all(
            ScriptStyle(scope="team", text=f"Note {number}.", status="active")
            for number in range(7)
        )
        await db.commit()
    async with as_admin(world, "alkhair") as one, as_admin(world, "levi") as two:
        added = await asyncio.gather(
            one.post(f"{API}/script-style/team", json={"text": "Say the lease month."}),
            two.post(f"{API}/script-style/team", json={"text": "Ask about growth."}),
        )
    assert sorted(response.status_code for response in added) == [201, 409]
    async with world.factory() as db:
        active = await db.scalar(
            select(func.count())
            .select_from(ScriptStyle)
            .where(ScriptStyle.scope == "team", ScriptStyle.status == "active")
        )
    assert active == 8


# --- Migration 0017 -----------------------------------------------------------------------------


@pytest.fixture
def scratch_url(database_url: str) -> Iterator[tuple[str, str]]:
    """A throwaway database to migrate up and down: (Alembic's url, psycopg's conninfo)."""
    settings = get_settings()
    name = f"{settings.postgres_db}_mig17"
    server = server_conninfo(settings)
    drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
    with psycopg.connect(server, autocommit=True) as connection:
        connection.execute(drop)
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield settings.database_url(name), server_conninfo(settings, name)
    finally:
        with psycopg.connect(server, autocommit=True) as connection:
            connection.execute(drop)


def test_0017_fails_stuck_preps_and_adds_the_index_and_the_tones(
    scratch_url: tuple[str, str],
) -> None:
    url, conninfo = scratch_url
    config = alembic_config(url)
    command.upgrade(config, "0015_script_notes")
    rows = {
        "stuck": ("101", "c1", "searching", "now() - interval '9 minutes'"),
        "older": ("102", None, "searching", "now() - interval '2 minutes'"),
        "newer": ("102", None, "searching", "now() - interval '1 minute'"),
        "alone": ("103", "c3", "searching", "now()"),
        "ready": ("101", "c1", "ready", "now() - interval '9 minutes'"),
    }
    ids = {name: uuid.uuid4() for name in rows}
    with psycopg.connect(conninfo, autocommit=True) as connection:
        for name, (key, contact, status, when) in rows.items():
            connection.execute(
                sql.SQL(
                    "INSERT INTO companies.preps (id, company_key, company_name, contact_id, "
                    "status, created_at) VALUES (%s, %s, 'A company', %s, %s, {})"
                ).format(sql.SQL(when)),
                (ids[name], key, contact, status),
            )
    command.upgrade(config, "0017_call_prep")
    with psycopg.connect(conninfo, autocommit=True) as connection:
        found: dict[uuid.UUID, str] = dict(
            connection.execute("SELECT id, status FROM companies.preps").fetchall()
        )
        assert {name: found[ids[name]] for name in rows} == {
            "stuck": "failed",
            "older": "failed",
            "newer": "searching",
            "alone": "searching",
            "ready": "ready",
        }
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                "INSERT INTO companies.preps (id, company_key, company_name, status) "
                "VALUES (%s, '102', 'A company', 'searching')",
                (uuid.uuid4(),),
            )
        connection.execute(
            "INSERT INTO companies.script_prefs (id, scope, tone) VALUES (%s, 'team', 'formal')",
            (uuid.uuid4(),),
        )
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO companies.script_prefs (id, scope, tone) VALUES (%s, 'mine', 'loud')",
                (uuid.uuid4(),),
            )
    command.check(config)  # the models declare the same index and table
    command.downgrade(config, "-1")
    with psycopg.connect(conninfo, autocommit=True) as connection:
        assert connection.execute("SELECT to_regclass('companies.script_prefs')").fetchone() == (
            None,
        )
        indexes = connection.execute(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'companies'"
        ).fetchall()
        assert ("ux_preps_searching",) not in indexes
    command.upgrade(config, "head")


# --- A clean shutdown ---------------------------------------------------------------------------


@pytest.mark.usefixtures("prep_on")
async def test_a_shutdown_stops_running_preps_in_plain_words(
    world: World, claude: GatedClaude, runner: PrepRunner, caplog: pytest.LogCaptureFixture
) -> None:
    from apps.companies.app import stop_preps

    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        started = await client.post(PREPS, json=CALL)
        await claude.waiting.wait()  # the prep is waiting on Claude
    with caplog.at_level("INFO", logger="apps.companies.prep"):
        await stop_preps(world.app)
    async with world.factory() as db:
        done = await db.get(Prep, uuid.UUID(started.json()["id"]))
    assert done is not None
    assert done.status == "failed"
    assert done.error == prep_module.STOPPED
    assert (done.facts or {}).get("error_code") == "stopped"
    assert any(record.message == "prep_stopped" for record in caplog.records)
    assert not runner.running(done.id)
    await stop_preps(world.app)  # nothing left: safe to call again
