"""Who started the work that is running now (PLAN-V26 T1-1).

The lane a Claude request waits in follows who started the work, not the code that asks: a call
prep from a click is People, and the same prep made by the morning search ahead is Jobs. So the
code that asks never names a lane. The places where work starts do:

- the sign-in guard (`core.api.guard`) for each request: People, and the person who is signed in;
- the run engine (`core.runs.manager`) for each run: Runs, or People for a run someone waits on;
- the scheduler (`core.schedules.runner`) for each job: Jobs.

Anything else (start-up, the command line) is Jobs. asyncio copies a context into each task it
makes, so work started in the background keeps the lane and the person of whoever started it.
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Final, Literal

type Lane = Literal["people", "runs", "jobs"]
LANES: Final[tuple[Lane, ...]] = ("people", "runs", "jobs")


@dataclass(frozen=True, slots=True)
class Work:
    lane: Lane = "jobs"
    user_id: uuid.UUID | None = None  # the person who started it. None: nobody did, like a schedule
    key: str | None = None  # what a screen asks the wait of, like "prep:<id>"


_NOBODY: Final = Work()  # frozen, so one can be shared
_work: ContextVar[Work] = ContextVar("work", default=_NOBODY)


def current() -> Work:
    return _work.get()


@contextmanager
def doing(work: Work) -> Iterator[None]:
    """The block, and every task it makes, is this work."""
    token = _work.set(work)
    try:
        yield
    finally:
        _work.reset(token)


@contextmanager
def waiting_as(key: str) -> Iterator[None]:
    """The same work, under a key that a screen can ask the wait of."""
    with doing(replace(current(), key=key)):
        yield
