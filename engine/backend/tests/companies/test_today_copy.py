"""Today's 5-minute copy of each person's HubSpot tasks (PLAN-V22 T1-3 and T1-4, `TaskCopy`), on
its own: no database and no HubSpot, a made-up reader only.

- two asks at once make one read;
- a change made here (Done, reopen, a new task) shows at once, and over the reads of the next 2
  minutes, as HubSpot's search lags; when a read has the task, HubSpot's own record wins;
- a task ticked done is remembered as it was, so opening it again keeps its company;
- what a person's copy remembers is bounded.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from apps.companies.today import BEFORE_CAP, CHANGES_HOLD, TaskCopy
from core.hubspot.tasks import OpenTask, TaskRead

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


def task(task_id: str, *, company: str | None = "201", hours: int = 1) -> OpenTask:
    return OpenTask(
        id=task_id,
        subject=f"Task {task_id}",
        kind="todo",
        status="NOT_STARTED",
        priority=None,
        due_at=NOW + timedelta(hours=hours),
        owner_id="o1",
        company_id=company,
    )


class Reader:
    """HubSpot's search, made up: it answers with `tasks`, and counts each read."""

    def __init__(self, *tasks: OpenTask) -> None:
        self.tasks = list(tasks)
        self.reads = 0
        self.gate: asyncio.Event | None = None

    async def __call__(self) -> TaskRead:
        self.reads += 1
        if self.gate is not None:
            await self.gate.wait()
        return TaskRead(tasks=tuple(self.tasks))


def ids(kept: object) -> list[str]:
    return [item.id for item in getattr(kept, "tasks", ())]


def now_held(copy: TaskCopy, owner: str = "o1") -> int:
    """How many changes made here the person's copy still lays over its reads."""
    return len(copy._entries[owner].changes)


async def test_two_asks_at_once_make_one_read() -> None:
    copy, reader = TaskCopy(), Reader(task("501"))
    reader.gate = asyncio.Event()
    first = asyncio.create_task(copy.tasks("o1", now=NOW, fresh=False, read=reader))
    second = asyncio.create_task(copy.tasks("o1", now=NOW, fresh=True, read=reader))
    await asyncio.sleep(0)
    reader.gate.set()
    done = await asyncio.gather(first, second)
    assert reader.reads == 1
    assert [ids(kept) for kept in done] == [["501"], ["501"]]


async def test_a_change_made_here_shows_at_once_and_over_a_read_that_lags() -> None:
    copy, reader = TaskCopy(), Reader(task("501"), task("502"))
    await copy.tasks("o1", now=NOW, fresh=False, read=reader)
    changed = NOW + timedelta(seconds=30)
    copy.change("o1", "501", None, changed)  # ticked done here
    copy.change("o1", "503", task("503", hours=2), changed)  # added here
    kept = await copy.tasks("o1", now=changed, fresh=False, read=reader)
    assert sorted(ids(kept)) == ["502", "503"] and reader.reads == 1  # at once, no read

    # Sync a minute on: HubSpot's search still shows 501, and not 503 yet.
    kept = await copy.tasks("o1", now=NOW + timedelta(minutes=1), fresh=True, read=reader)
    assert reader.reads == 2 and sorted(ids(kept)) == ["502", "503"]

    # A minute later the search has caught up: HubSpot's own record of 503 wins.
    reader.tasks = [task("502"), task("503", company="202", hours=2)]
    kept = await copy.tasks("o1", now=NOW + timedelta(minutes=2), fresh=True, read=reader)
    assert reader.reads == 3 and now_held(copy) == 2
    [new] = [item for item in kept.tasks if item.id == "503"]
    assert new.company_id == "202"

    # Over 2 minutes after the changes (and a minute after the last read), a read is shown as it
    # is.
    reader.tasks = [task("501"), task("502")]
    later = NOW + timedelta(minutes=3)
    assert later - changed > CHANGES_HOLD
    kept = await copy.tasks("o1", now=later, fresh=True, read=reader)
    assert sorted(ids(kept)) == ["501", "502"] and now_held(copy) == 0


async def test_a_task_ticked_done_is_remembered_as_it_was() -> None:
    copy, reader = TaskCopy(), Reader(task("501", company="201"))
    await copy.tasks("o1", now=NOW, fresh=False, read=reader)
    copy.change("o1", "501", None, NOW)
    remembered = copy.kept("o1", "501")
    assert remembered is not None and remembered.company_id == "201"  # reopen keeps it
    assert copy.kept("o2", "501") is None  # another person's copy knows nothing of it


async def test_what_a_copy_remembers_is_bounded() -> None:
    copy = TaskCopy()
    reader = Reader(*(task(str(number)) for number in range(BEFORE_CAP + 50)))
    await copy.tasks("o1", now=NOW, fresh=False, read=reader)
    for number in range(BEFORE_CAP + 50):
        copy.change("o1", str(number), None, NOW)
    assert copy.kept("o1", "0") is None  # the oldest went first
    assert copy.kept("o1", str(BEFORE_CAP + 49)) is not None
    copy.change("o1", "x", None, NOW + CHANGES_HOLD)  # a change 2 minutes on forgets the old ones
    assert now_held(copy) == 1
