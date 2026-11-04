"""What can run on a schedule: a `JobSpec` is what a project (or the core) offers. PLAN-V6 D1.

A project lists its jobs in its `AppSpec` (`jobs=(JobSpec(...),)`), the way it lists its run kinds.
The core adds its own (the HubSpot sync, in `core_jobs.py`). A job's `start` begins the work and
returns at once, like starting a run does: it doesn't wait for the work to finish. It answers with
the id of the run or sync it made, or raises `JobSkipped` with a reason a person can read.

`default` is the schedule made for the job at the first start (it is never made again, and never
changed by the next start, so a person's edits and switch-offs stay).

Three more hooks serve the Schedules page (PLAN-V6 D3). All are optional:
- `estimate`: what one start costs and whether it would start now (`JobEstimate`). A job that costs
  nothing answers with zeros, so the page can say "Free"; a job with no hook shows no estimate.
- `describe`: the saved choices in one plain sentence.
- `check_settings`: checks the choices a person saved and returns them cleaned, or raises
  `JobSettingsError` with a message a person can read.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import FastAPI

from core.schedules.calc import Cadence


@dataclass(frozen=True)
class JobContext:
    """What a job is given when it starts."""

    app: FastAPI
    schedule_id: uuid.UUID
    settings: dict[str, Any]  # the schedule's own choices (JSON)
    now: datetime


@dataclass(frozen=True)
class JobResult:
    ref: str  # the run id or the sync id, as text: the Schedules page links to it


class JobSkipped(Exception):
    """The job didn't start, for a reason a person can read ("It is still running"). Not an error:
    the schedule waits for its next time."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class JobSettingsError(ValueError):
    """The choices saved for a job can't be used. The message is for a person to read."""


@dataclass(frozen=True)
class JobEstimate:
    """What one start of a job costs, and whether it would start now. Money is US dollars."""

    valid: bool  # False when the saved choices can't be used
    problem: str | None  # why it wouldn't start now, in plain words. None when it would
    typical_usd: Decimal  # a typical start. 0 for a job that costs nothing
    worst_usd: Decimal  # the most a start can cost: its own limits stop it there
    cap_usd: Decimal  # the limit for one start
    daily_left_usd: Decimal  # what is left of today's limit
    basis: str = ""  # where the prices come from, in plain words


@dataclass(frozen=True)
class DefaultSchedule:
    cadence: Cadence
    enabled: bool
    settings: dict[str, Any] = field(default_factory=dict)


JobStart = Callable[[JobContext], Awaitable[JobResult]]
JobRunning = Callable[[JobContext], Awaitable[bool]]
JobEstimateFn = Callable[[JobContext], Awaitable[JobEstimate]]
JobDescribe = Callable[[dict[str, Any]], str]
JobCheckSettings = Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class JobSpec:
    key: str  # like "lead_finder.discovery"
    project: str  # "lead_finder", or "core"
    title: str  # what the Schedules page shows
    start: JobStart
    # True while the work the last start began is still going. A schedule that comes due then is
    # skipped, with a note, and waits for its next time.
    running: JobRunning | None = None
    default: DefaultSchedule | None = None
    estimate: JobEstimateFn | None = None
    describe: JobDescribe | None = None
    check_settings: JobCheckSettings | None = None
