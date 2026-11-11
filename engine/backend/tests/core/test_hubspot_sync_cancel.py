"""PLAN-V15 T1-3: a sync shows it is alive (the heartbeat), says its phase, and can be stopped,
fast and cleanly. A left-over "running" row is cleared at start-up."""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import Settings
from core.hubspot.models import HubSpotCompany, HubSpotSync
from core.hubspot.sync import (
    CANCELLED_AFTER_SAVE,
    CANCELLED_BEFORE_SAVE,
    SyncAlreadyRunning,
    SyncNotFound,
    SyncNotRunning,
    SyncRunner,
    begin,
    mark_stale,
    run,
)
from core.memory.models import MemoryItem
from tests.core.hubspot_fake import FakeHubSpot
from tests.core.test_hubspot_sync import CountingEmbedder, contour

pytestmark = pytest.mark.integration
SETTINGS = Settings()


class GatedEmbedder(CountingEmbedder):
    """Waits at the first embedding until `gate` opens: the sync is then in its profiles phase,
    after the companies were saved."""

    def __init__(self) -> None:
        super().__init__()
        self.gate = asyncio.Event()
        self.reached = asyncio.Event()

    async def embed_passages(self, texts: list[str]) -> list[list[float]]:
        self.reached.set()
        await self.gate.wait()
        return await super().embed_passages(texts)


def gated_read(fake: FakeHubSpot) -> asyncio.Event:
    """Makes the fake wait before each page until the returned event is set."""
    gate = asyncio.Event()
    original = fake.list_objects

    async def slow(*args, **kwargs):  # type: ignore[no-untyped-def]
        await gate.wait()
        return await original(*args, **kwargs)

    fake.list_objects = slow  # type: ignore[method-assign]
    return gate


def runner_for(
    sessions: async_sessionmaker[AsyncSession], fake: FakeHubSpot, embedder: CountingEmbedder
) -> SyncRunner:
    return SyncRunner(
        sessions=sessions,
        hubspot=lambda: fake,
        embedder=lambda: embedder,  # type: ignore[arg-type, return-value]
        settings=lambda: SETTINGS,
    )


async def row_of(sessions: async_sessionmaker[AsyncSession], sync_id: int) -> HubSpotSync:
    async with sessions() as session:
        row = await session.get(HubSpotSync, sync_id)
        assert row is not None
        return row


async def until(check, seconds: float = 3.0) -> None:  # type: ignore[no-untyped-def]
    deadline = time.monotonic() + seconds
    while not await check():
        assert time.monotonic() < deadline, "timed out"
        await asyncio.sleep(0.02)


async def test_a_cancel_while_reading_stops_within_seconds_and_changes_nothing(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    fake = contour()
    gated_read(fake)  # never opened: the read hangs, like a slow HubSpot
    runner = runner_for(session_factory, fake, CountingEmbedder())
    started = await runner.start(trigger="website")

    async def reading() -> bool:
        return (await row_of(session_factory, started.id)).phase == "reading"

    await until(reading)
    clock = time.monotonic()
    out = await runner.cancel(started.id)
    assert time.monotonic() - clock < 5
    assert out.status == "cancelled" and out.finished_at is not None
    assert out.cancel_requested_at is not None and out.phase is None
    assert out.warnings[-1] == CANCELLED_BEFORE_SAVE
    assert await session.scalar(select(func.count()).select_from(HubSpotCompany)) == 0
    assert fake.closed and not runner.busy


async def test_a_cancel_while_rebuilding_profiles_keeps_the_companies_and_the_next_sync_owes_them(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    first = await begin(session_factory, trigger="command", mode="full", settings=SETTINGS)
    await run(first, sessions=session_factory, hubspot=contour(), embedder=CountingEmbedder())  # type: ignore[arg-type]
    embedder = GatedEmbedder()
    changed = contour()
    changed.add_company("104", name="Delta Build")  # a new company: its profile must be embedded
    runner = runner_for(session_factory, changed, embedder)
    started = await runner.start(trigger="website", mode="full")
    await asyncio.wait_for(embedder.reached.wait(), 5)

    assert (await row_of(session_factory, started.id)).phase == "profiles"
    out = await runner.cancel(started.id)
    assert out.status == "cancelled" and out.profiles_skipped
    assert out.warnings[-1] == CANCELLED_AFTER_SAVE
    assert await session.scalar(select(func.count()).select_from(HubSpotCompany)) == 4

    # The next sync is a changes sync that finds nothing changed (an empty HubSpot answer), yet
    # it rebuilds every profile the stopped one skipped.
    again = CountingEmbedder()
    plan = await begin(session_factory, trigger="command", mode="changes", settings=SETTINGS)
    assert plan.mode == "changes"
    done = await run(plan, sessions=session_factory, hubspot=FakeHubSpot(), embedder=again)  # type: ignore[arg-type]
    assert done.status == "done" and not done.profiles_skipped
    # All 4 profiles are rebuilt; only Delta Build's text is new, so only it is embedded.
    assert done.profiles_rebuilt == 4 and again.texts == [again.texts[0]]
    assert "Delta Build" in again.texts[0]
    profiles = await session.scalar(
        select(func.count()).select_from(MemoryItem).where(MemoryItem.app == "hubspot")
    )
    assert profiles == 4


async def test_the_heartbeat_and_phase_are_written_while_it_runs(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("core.hubspot.sync.HEARTBEAT_SECONDS", 0.05)
    fake = contour()
    gate = gated_read(fake)
    runner = runner_for(session_factory, fake, CountingEmbedder())
    started = await runner.start(trigger="website")
    first = None

    async def beating() -> bool:
        nonlocal first
        row = await row_of(session_factory, started.id)
        if row.heartbeat_at is None:
            return False
        first = first or row.heartbeat_at
        return row.heartbeat_at > first

    await until(beating)
    row = await row_of(session_factory, started.id)
    assert row.phase == "reading" and row.status == "running"
    gate.set()
    await runner.wait(started.id)
    done = await row_of(session_factory, started.id)
    assert done.status == "done" and done.phase is None
    assert done.profiles_done == done.profiles_total == 3


async def test_a_stop_asked_on_another_backend_is_seen_by_the_heartbeat(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """During a deploy the Stop can reach the backend that doesn't run the sync. It saves the
    request, and the running sync sees it at its next heartbeat."""
    monkeypatch.setattr("core.hubspot.sync.HEARTBEAT_SECONDS", 0.05)
    fake = contour()
    gated_read(fake)
    plan = await begin(session_factory, trigger="command", mode="auto", settings=SETTINGS)
    running = asyncio.create_task(
        run(plan, sessions=session_factory, hubspot=fake, embedder=CountingEmbedder())  # type: ignore[arg-type]
    )
    other = runner_for(session_factory, contour(), CountingEmbedder())  # another backend's runner
    await asyncio.sleep(0.1)
    asked = await other.cancel(plan.id)
    assert asked.status == "running" and asked.cancel_requested_at is not None
    out = await asyncio.wait_for(running, 5)  # the command's run returns, it doesn't crash
    assert out.status == "cancelled" and out.warnings[-1] == CANCELLED_BEFORE_SAVE


async def test_a_sync_with_a_fresh_heartbeat_is_never_cleared_however_long_it_runs(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    plan = await begin(session_factory, trigger="website", mode="auto", settings=SETTINGS)
    async with session_factory() as session:
        row = await session.get(HubSpotSync, plan.id)
        assert row is not None
        row.started_at = datetime.now(UTC) - timedelta(minutes=45)
        row.heartbeat_at = datetime.now(UTC) - timedelta(seconds=20)
        await session.commit()
        assert await mark_stale(session) == 0
        await session.commit()
    with pytest.raises(SyncAlreadyRunning):
        await begin(session_factory, trigger="command", mode="auto", settings=SETTINGS)


@pytest.mark.parametrize(
    ("heartbeat_minutes", "phase", "owed"),
    [(None, None, False), (5, "reading", False), (5, "profiles", True)],
)
async def test_a_left_over_row_is_cleared_when_the_backend_starts(
    session_factory: async_sessionmaker[AsyncSession],
    heartbeat_minutes: int | None,
    phase: str | None,
    owed: bool,
) -> None:
    """Like the sync stuck in production since the 11 Nov deploy: started long ago, no heartbeat
    (the old code wrote none)."""
    now = datetime.now(UTC)
    async with session_factory() as session:
        row = HubSpotSync(
            mode="full",
            trigger="startup",
            status="running",
            phase=phase,
            started_at=now - timedelta(minutes=30),
            heartbeat_at=None if heartbeat_minutes is None else now - timedelta(minutes=5),
        )
        session.add(row)
        await session.commit()
        sync_id = row.id
    runner = runner_for(session_factory, contour(), CountingEmbedder())
    assert await runner.clear_left_over() == 1
    left = await row_of(session_factory, sync_id)
    assert left.status == "interrupted" and left.finished_at is not None and left.phase is None
    assert left.profiles_skipped is owed


async def test_stopping_a_left_over_row_nobody_runs_ends_it_at_once(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        row = HubSpotSync(
            mode="full",
            trigger="startup",
            status="running",
            started_at=datetime.now(UTC) - timedelta(minutes=30),
        )
        session.add(row)
        await session.commit()
        sync_id = row.id
    runner = runner_for(session_factory, contour(), CountingEmbedder())
    out = await runner.cancel(sync_id)
    assert out.status == "cancelled" and out.warnings[-1] == CANCELLED_BEFORE_SAVE


async def test_stopping_a_finished_or_unknown_sync_is_refused(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    runner = runner_for(session_factory, contour(), CountingEmbedder())
    started = await runner.start(trigger="website")
    await runner.wait(started.id)
    with pytest.raises(SyncNotRunning):
        await runner.cancel(started.id)
    with pytest.raises(SyncNotFound):
        await runner.cancel(987_654)


async def test_a_late_finish_never_overwrites_a_row_that_was_cleared(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    fake = contour()
    gate = gated_read(fake)
    runner = runner_for(session_factory, fake, CountingEmbedder())
    started = await runner.start(trigger="website")
    async with session_factory() as session:
        assert await mark_stale(session, older_than=timedelta(seconds=-60)) == 1
        await session.commit()
    gate.set()
    await runner.wait(started.id)
    assert (await row_of(session_factory, started.id)).status == "interrupted"


async def test_the_runner_keeps_one_task_per_sync_and_stops_them_all(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    fake = contour()
    gated_read(fake)
    runner = runner_for(session_factory, fake, CountingEmbedder())
    first = await runner.start(trigger="website")
    async with session_factory() as session:  # as if the first were left over, then a second
        await mark_stale(session, older_than=timedelta(seconds=-60))
        await session.commit()
    second = await runner.start(trigger="website")
    assert runner.running_ids() == {first.id, second.id}
    await runner.stop()
    assert runner.running_ids() == set()
    assert (await row_of(session_factory, second.id)).status == "interrupted"


async def test_the_stop_route_answers_202_then_409_and_404_for_an_unknown_sync(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    import httpx

    from core.api.app import create_app

    fake = contour()
    gated_read(fake)
    app = create_app()
    app.state.hubspot_syncs = runner_for(session_factory, fake, CountingEmbedder())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        started = (await client.post("/api/v1/hubspot/sync")).json()
        stopped = await client.post(f"/api/v1/hubspot/syncs/{started['id']}/cancel")
        assert stopped.status_code == 202
        assert stopped.json()["status"] == "cancelled"
        assert stopped.json()["warnings"][-1] == CANCELLED_BEFORE_SAVE
        again = await client.post(f"/api/v1/hubspot/syncs/{started['id']}/cancel")
        assert (again.status_code, again.json()["code"]) == (409, "not_running")
        unknown = await client.post("/api/v1/hubspot/syncs/987654/cancel")
        assert (unknown.status_code, unknown.json()["code"]) == (404, "sync_not_found")


async def test_the_backend_clears_a_stuck_row_when_it_starts(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The fix for the sync stuck since the 11 Nov deploy: the next backend to start (or to take
    over) ends it, so the website stops waiting on it and a new sync can start."""
    from fastapi import FastAPI

    from core.hubspot import connection

    async with session_factory() as session:
        row = HubSpotSync(
            mode="full",
            trigger="startup",
            status="running",
            started_at=datetime.now(UTC) - timedelta(hours=10),
        )
        session.add(row)
        await session.commit()
        sync_id = row.id
    app = FastAPI()
    fake = contour()
    app.state.hubspot_provider = lambda: fake
    app.state.hubspot_syncs = runner_for(session_factory, fake, CountingEmbedder())
    await connection.start_up(app)  # the test settings never start a sync at start-up
    assert (await row_of(session_factory, sync_id)).status == "interrupted"


def test_with_no_hubspot_set_up_start_up_touches_nothing() -> None:
    from fastapi import FastAPI

    from core.hubspot.connection import hubspot_set_up

    assert not hubspot_set_up(FastAPI())  # the tests' key is empty
