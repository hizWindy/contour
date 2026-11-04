"""What the Schedules endpoints send and take. PLAN-V6 D3.

A schedule is read as `ScheduleOut`: the row, the cadence in plain words, the saved choices in a
sentence, what one start would cost (from the job's own estimate) and whether its last start is
still going. A change is `ScheduleEdit`: any of on or off, the cadence and the saved choices; what
isn't sent stays as it is.
"""

import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.api.models import OutModel

EVERY_MAX = {"days": 365, "weeks": 52}  # a year
CLOCK = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleEstimate(OutModel):
    """What one start of the job costs. `valid` is false when the saved choices can't be used, and
    `problem` says in plain words why it wouldn't start now (too dear for the limits, say)."""

    valid: bool
    problem: str | None
    typical_usd: Decimal = Field(description="A typical start. 0 for a job that is free")
    worst_usd: Decimal = Field(description="The most a start can cost: its own limit stops it")
    per_month_usd: Decimal = Field(description="Typical starts in a month at this schedule")
    cap_usd: Decimal = Field(description="The limit for one start")
    daily_left_usd: Decimal = Field(description="What is left of today's limit")
    basis: str = Field(description="Where the prices come from, in plain words")


class ScheduleOut(OutModel):
    id: uuid.UUID
    project: str = Field(examples=["lead_finder"])
    job: str = Field(examples=["lead_finder.discovery"])
    name: str = Field(examples=["Find new leads"])
    enabled: bool
    every: int
    unit: Literal["days", "weeks"]
    weekday: int | None = Field(description="0 Monday to 6 Sunday. Set for a schedule in weeks")
    at: str = Field(description="The time of day, 24-hour, like 07:00", examples=["07:00"])
    timezone: str = Field(examples=["Australia/Melbourne"])
    when: str = Field(
        description="The cadence in words", examples=["Every 2 weeks on Monday at 7:00 am"]
    )
    settings: dict[str, Any] = Field(description="The job's saved choices")
    summary: str = Field(description="The saved choices in a sentence. Empty if the job has none")
    next_run_at: datetime | None = Field(description="When it runs next. Empty while it is off")
    last_run_at: datetime | None
    last_status: Literal["starting", "started", "skipped", "failed"] | None
    last_kind: Literal["run", "sync"] | None = Field(
        description="What the last start made: a run or a HubSpot sync"
    )
    last_id: str | None = Field(description="The id of that run or sync")
    last_error: str | None = Field(description="Why the last start didn't happen, in plain words")
    running: bool = Field(description="True while the work the last start began is still going")
    installed: bool = Field(description="False when the engine no longer has this job")
    estimate: ScheduleEstimate | None


class ScheduleList(BaseModel):
    items: list[ScheduleOut]


class ScheduleEdit(BaseModel):
    """Any of these. What isn't sent stays as it is."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = Field(None, description="Switch it on or off")
    every: int | None = Field(None, ge=1, le=365, description="Every how many days or weeks")
    unit: Literal["days", "weeks"] | None = None
    weekday: int | None = Field(None, ge=0, le=6, description="0 Monday to 6 Sunday, for weeks")
    at: str | None = Field(
        None, description="The time of day, 24-hour, like 07:00", examples=["07:00"]
    )
    settings: dict[str, Any] | None = Field(
        None, description="The job's choices. They replace the saved ones as a whole"
    )

    @field_validator("at")
    @classmethod
    def _clock(cls, value: str | None) -> str | None:
        if value is not None and not CLOCK.fullmatch(value):
            raise ValueError("Use a 24-hour time like 07:00")
        return value


class RunNow(BaseModel):
    """How a start by hand went. A reason is plain words a person can read."""

    status: Literal["started", "skipped", "failed"]
    ref: str | None = Field(description="The id of the run or sync it made, when it started")
    reason: str | None = Field(description="Why it didn't start, when it didn't")
