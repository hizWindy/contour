"""Start-up and shut-down of the scheduler. The app's lifespan calls these two functions.

The scheduler starts only in the backend that holds the run engine's lock (`app.state.run_manager`
is set only then), so two backends can never both start a job. If the database was down at start,
there is no run manager and no scheduler: restart the backend once the database is up.
"""

import logging

from fastapi import FastAPI

from core.db.engine import get_sessionmaker
from core.schedules.core_jobs import CORE_JOBS
from core.schedules.jobs import JobSpec
from core.schedules.runner import Scheduler

log = logging.getLogger(__name__)


def all_jobs(app: FastAPI) -> list[JobSpec]:
    """The core's jobs and every project's."""
    jobs = list(CORE_JOBS)
    for spec in getattr(app.state, "apps", []):
        jobs.extend(spec.jobs)
    return jobs


async def start_up(app: FastAPI) -> None:
    """Starts the scheduler. Never raises: a start-up must not fail because of a schedule."""
    if getattr(app.state, "run_manager", None) is None:
        log.warning("scheduler_not_started", extra={"reason": "this backend has no run engine"})
        return
    try:
        sessions = getattr(app.state, "session_factory", None) or get_sessionmaker()
        scheduler = Scheduler(app=app, sessions=sessions, jobs=all_jobs(app))
        await scheduler.start()
    except Exception:
        log.exception("scheduler_not_started")
        return
    app.state.scheduler = scheduler


async def shut_down(app: FastAPI) -> None:
    scheduler: Scheduler | None = getattr(app.state, "scheduler", None)
    if scheduler is not None:
        await scheduler.stop()
