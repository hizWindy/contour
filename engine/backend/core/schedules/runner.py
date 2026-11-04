"""The loop that starts what is due. PLAN-V6 D1.

Once a minute it asks the table what is on and due, and starts those jobs. It runs in the backend
that holds the run engine's lock, so there is only ever one of it for a database.

**Never twice.** A due schedule is claimed (its next time moved on, saved) before its job starts.
**Missed times** (the backend was off) run once, when it is back: the claim moves the next time to
the first one still to come. **Still running** (the last start's work hasn't finished): skipped,
with a note, and the schedule waits for its next time.

A job that fails to start never stops the loop, and its error text never reaches the table: a person
sees a fixed sentence, and the details are in the backend log.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.auth.clock import utcnow
from core.schedules import service
from core.schedules.jobs import JobContext, JobSkipped, JobSpec

log = logging.getLogger(__name__)

TICK_SECONDS = 60.0
STILL_RUNNING = "It is still running from the last time, so this time was skipped."
NOT_INSTALLED = "This job isn't part of the engine any more."
COULD_NOT_START = "It could not start. The details are in the backend log."


@dataclass(frozen=True)
class Fired:
    """What one due schedule came to, for the tests and the log."""

    schedule_id: object
    job: str
    status: str  # started, skipped or failed
    ref: str | None = None
    reason: str | None = None


class Scheduler:
    def __init__(
        self,
        *,
        app: FastAPI,
        sessions: async_sessionmaker[AsyncSession],
        jobs: Sequence[JobSpec],
        clock: Callable[[], datetime] = utcnow,
        tick_seconds: float = TICK_SECONDS,
    ) -> None:
        self._app = app
        self._sessions = sessions
        self._jobs: Mapping[str, JobSpec] = {job.key: job for job in jobs}
        self._clock = clock
        self._tick_seconds = tick_seconds
        self._task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        """Makes the default schedules, marks what a stopped backend left half-started, and begins
        the loop."""
        now = self._clock()
        async with self._sessions() as db:
            made = await service.ensure_defaults(db, self._jobs.values(), now)
            left = await service.recover_unfinished(db, now)
        log.info("scheduler_started", extra={"defaults_made": made, "unfinished": left})
        self._task = asyncio.create_task(self._loop(), name="scheduler")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("scheduler_tick_failed")  # the loop never dies of one bad pass
            await asyncio.sleep(self._tick_seconds)

    async def tick(self) -> list[Fired]:
        """One pass: claims what is due, then starts each job. Safe to call by hand."""
        now = self._clock()
        async with self._sessions() as db:
            claimed = await service.claim_due(db, now)
        return [await self._fire(claim, now) for claim in claimed]

    async def _fire(self, claim: service.Claimed, now: datetime) -> Fired:
        spec = self._jobs.get(claim.job)
        if spec is None:
            return await self._finish(claim, "failed", reason=NOT_INSTALLED)
        context = JobContext(self._app, claim.id, dict(claim.settings), now)
        try:
            if spec.running is not None and await spec.running(context):
                return await self._finish(claim, "skipped", reason=STILL_RUNNING)
            result = await spec.start(context)
        except JobSkipped as skipped:
            return await self._finish(claim, "skipped", reason=skipped.reason)
        except Exception:
            log.exception("scheduled_job_failed", extra={"job": claim.job})
            return await self._finish(claim, "failed", reason=COULD_NOT_START)
        return await self._finish(claim, "started", ref=result.ref)

    async def _finish(
        self,
        claim: service.Claimed,
        status: str,
        *,
        ref: str | None = None,
        reason: str | None = None,
    ) -> Fired:
        async with self._sessions() as db:
            await service.record(db, claim.id, status, ref=ref, error=reason)
        log.info("scheduled_job", extra={"job": claim.job, "status": status, "ref": ref})
        return Fired(claim.id, claim.job, status, ref, reason)
