"""Sync on Meetings (PLAN-V18 T1-5): a full read of HubSpot's meetings now, in the background.

- `started`, then `running` while it (or any other read) runs, and `fresh` within a minute of a
  good read: HubSpot isn't asked;
- a failed read: the list stays as it was, and the status says how the newest read ended;
- a missing permission, and no HubSpot key;
- the daily sync and a Sync never save at the same time (the save lock);
- the log lines carry counts and times, never a meeting's title.

Every company, person and meeting here is made up.
"""

import asyncio
import logging
from collections.abc import Iterator, Sequence
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.hubspot import connection, meetings
from core.hubspot.client import PAGE_SIZE, Filter, HubSpotUnavailable, ObjectType, Page
from core.hubspot.meetings import MeetingsRefresher, SyncAnswer
from tests.core.hubspot_fake import SCOPE_FOR, FakeHubSpot
from tests.core.test_hubspot_meetings import NOW, Clock, a_meeting, copied, reads

Factory = async_sessionmaker[AsyncSession]
pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def no_read_left_over() -> Iterator[None]:
    """A test that fails half way never leaves a read "running" for the next one."""
    yield
    meetings._running.clear()


class Held(FakeHubSpot):
    """A HubSpot whose meetings search waits until the test lets it answer."""

    def __init__(self) -> None:
        super().__init__()
        self.searching = asyncio.Event()
        self.go = asyncio.Event()

    async def search_objects(
        self,
        object_type: ObjectType,
        *,
        filters: Sequence[Filter],
        properties: Sequence[str],
        sort_by: str | None = None,
        descending: bool = False,
        after: str | None = None,
        limit: int = PAGE_SIZE,
    ) -> Page:
        self.searching.set()
        await self.go.wait()
        return await super().search_objects(
            object_type,
            filters=filters,
            properties=properties,
            sort_by=sort_by,
            descending=descending,
            after=after,
            limit=limit,
        )


def refresher_for(factory: Factory, fake: FakeHubSpot | None, clock: Clock) -> MeetingsRefresher:
    return MeetingsRefresher(sessions=factory, hubspot=lambda: fake, clock=clock)


async def status(factory: Factory) -> meetings.MeetingsStatus:
    async with factory() as session:
        return await meetings.status(session)


async def test_sync_starts_a_full_read_then_says_running_then_fresh(
    session_factory: Factory,
) -> None:
    fake = Held()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    a_meeting(fake, "402", NOW - timedelta(days=60))  # 60 days back: in the window
    clock = Clock()
    refresher = refresher_for(session_factory, fake, clock)

    first = await refresher.sync_now()
    assert first == SyncAnswer("started", None)
    assert (await status(session_factory)).syncing is True  # before the read has even begun
    await asyncio.wait_for(fake.searching.wait(), timeout=10)
    assert await refresher.sync_now() == SyncAnswer("running", None)  # nothing new starts
    assert meetings.reading()
    fake.go.set()
    await refresher.wait()

    after = await status(session_factory)
    assert (after.state, after.syncing, after.last_read) == ("ready", False, "done")
    assert after.checked_at == NOW  # the clock didn't move while it read
    assert set(await copied(session_factory)) == {"401", "402"}
    (read,) = await reads(session_factory)
    assert (read.kind, read.state) == ("full", "done")  # the whole window, not changes

    # Under a minute later, a press asks HubSpot nothing.
    fake.calls.clear()
    clock.now = NOW + timedelta(seconds=59)
    assert await refresher.sync_now() == SyncAnswer("fresh", NOW)
    assert fake.calls == [] and len(await reads(session_factory)) == 1
    # A minute on, it reads again, even within 15 minutes (the refresh's rule doesn't apply).
    clock.now = NOW + timedelta(minutes=1)
    assert await refresher.sync_now() == SyncAnswer("started", NOW)
    await refresher.wait()
    assert len(await reads(session_factory)) == 2


async def test_sync_answers_running_while_the_daily_read_runs(session_factory: Factory) -> None:
    fake = Held()
    clock = Clock()
    daily = asyncio.create_task(meetings.copy_meetings(session_factory, fake, clock=clock))
    await asyncio.wait_for(fake.searching.wait(), timeout=10)
    refresher = refresher_for(session_factory, fake, clock)
    assert await refresher.sync_now() == SyncAnswer("running", None)
    # A refresh skips itself too: one read at a time.
    assert await meetings.refresh(session_factory, fake, clock=clock) == 0
    fake.go.set()
    assert await daily == []
    assert not meetings.reading()


async def test_a_failed_sync_keeps_the_copy_and_the_status_says_it_failed(
    session_factory: Factory,
) -> None:
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    clock = Clock()
    await meetings.copy_meetings(session_factory, fake, clock=clock)  # a good read at NOW

    a_meeting(fake, "402", NOW + timedelta(days=2))
    fake.fail["search_meetings"] = [
        HubSpotUnavailable("HubSpot didn't answer", "It timed out or the connection broke.")
    ]
    clock.now = NOW + timedelta(minutes=5)
    refresher = refresher_for(session_factory, fake, clock)
    assert await refresher.sync_now() == SyncAnswer("started", NOW)
    await refresher.wait()

    assert set(await copied(session_factory)) == {"401"}  # the copy from before stays
    failed = await status(session_factory)
    assert (failed.state, failed.last_read, failed.checked_at) == ("ready", "failed", NOW)
    # A failed newest read is never "fresh": pressing again reads again.
    clock.now = NOW + timedelta(minutes=5, seconds=10)
    assert (await refresher.sync_now()).state == "started"
    await refresher.wait()
    assert set(await copied(session_factory)) == {"401", "402"}


async def test_a_missing_permission_shows_in_the_status(session_factory: Factory) -> None:
    fake = FakeHubSpot()
    fake.scopes.discard(SCOPE_FOR["meetings"])
    refresher = refresher_for(session_factory, fake, Clock())
    assert (await refresher.sync_now()).state == "started"
    await refresher.wait()
    waiting = await status(session_factory)
    assert (waiting.state, waiting.last_read, waiting.checked_at) == ("waiting", "waiting", None)


async def test_with_no_key_nothing_starts(session_factory: Factory) -> None:
    refresher = refresher_for(session_factory, None, Clock())
    with pytest.raises(LookupError):
        await refresher.sync_now()
    assert not refresher.syncing and not meetings.reading()
    app = FastAPI()  # no key and no client of its own: HubSpot isn't set up
    with pytest.raises(LookupError):
        await connection.sync_meetings_now(app)


async def test_the_daily_sync_and_a_sync_never_save_at_the_same_time(
    session_factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both read at once. Each save holds the meetings' save lock, so one waits for the other."""
    spans: list[tuple[float, float]] = []
    upsert = meetings._upsert
    loop = asyncio.get_running_loop()

    async def slow_upsert(session: AsyncSession, found: Any) -> int:
        began = loop.time()
        changed = await upsert(session, found)
        await asyncio.sleep(0.3)  # still inside the save's transaction, holding the lock
        spans.append((began, loop.time()))
        return changed

    monkeypatch.setattr(meetings, "_upsert", slow_upsert)
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1))
    clock = Clock()
    refresher = refresher_for(session_factory, fake, clock)
    assert (await refresher.sync_now()).state == "started"
    daily = asyncio.create_task(meetings.copy_meetings(session_factory, fake, clock=clock))
    await asyncio.gather(daily, refresher.wait())

    assert len(spans) == 2
    first, second = sorted(spans)
    assert first[1] <= second[0]  # the second save began after the first one ended
    assert [read.state for read in await reads(session_factory)] == ["done", "done"]


async def test_the_sync_logs_counts_and_times_never_a_title(
    session_factory: Factory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    fake = FakeHubSpot()
    a_meeting(fake, "401", NOW + timedelta(days=1), hs_meeting_title="Sample Freight fit-out")
    refresher = refresher_for(session_factory, fake, Clock())
    await refresher.sync_now()
    await refresher.wait()
    synced = [
        record for record in caplog.records if record.getMessage() == "hubspot_meetings_synced"
    ]
    assert len(synced) == 1
    line = synced[0].__dict__
    assert (line["state"], line["changed"]) == ("done", 1) and line["seconds"] >= 0
    logged = "\n".join(repr(record.__dict__) for record in caplog.records)
    assert "Sample Freight" not in logged


async def test_the_backend_stopping_stops_a_sync(session_factory: Factory) -> None:
    fake = Held()
    refresher = refresher_for(session_factory, fake, Clock())
    app = FastAPI()
    app.state.hubspot_provider = lambda: fake
    app.state.meetings_refresher = refresher
    assert await connection.sync_meetings_now(app) == SyncAnswer("started", None)
    await asyncio.wait_for(fake.searching.wait(), timeout=10)
    await connection.shut_down(app)
    assert not refresher.syncing and not meetings.reading() and fake.closed
    assert await reads(session_factory) == []  # stopped before its save
