"""The jobs the core itself offers to a schedule. PLAN-V6 D1.

**The HubSpot sync** (`core.hubspot_sync`): copies HubSpot into our database (free, read only). It
is on by default, every day at 6:00 am Melbourne time, so the company list is never a day behind.
`mode` in its settings is `auto` (a full read when the last full one is old, else only what
changed), `full` or `changes`.
"""

from datetime import time
from typing import cast

from core.hubspot.sync import ModeChoice, SyncAlreadyRunning
from core.schedules.calc import Cadence
from core.schedules.jobs import DefaultSchedule, JobContext, JobResult, JobSkipped, JobSpec

HUBSPOT_SYNC = "core.hubspot_sync"


async def start_hubspot_sync(context: JobContext) -> JobResult:
    from core.hubspot.connection import sync_runner

    mode = str(context.settings.get("mode", "auto"))
    if mode not in ("auto", "full", "changes"):
        raise JobSkipped(f"The sync mode {mode!r} isn't one of auto, full or changes.")
    try:
        started = await sync_runner(context.app).start(
            trigger="schedule", mode=cast(ModeChoice, mode)
        )
    except LookupError:
        raise JobSkipped("HubSpot isn't connected: there is no HUBSPOT_SERVICE_KEY.") from None
    except SyncAlreadyRunning:
        raise JobSkipped("A HubSpot sync is already running.") from None
    return JobResult(ref=f"sync:{started.id}")


async def hubspot_sync_running(context: JobContext) -> bool:
    from core.hubspot.connection import sync_runner

    return sync_runner(context.app).busy


CORE_JOBS = (
    JobSpec(
        key=HUBSPOT_SYNC,
        project="core",
        title="Copy HubSpot",
        start=start_hubspot_sync,
        running=hubspot_sync_running,
        default=DefaultSchedule(
            cadence=Cadence(every=1, unit="days", at=time(6, 0)),
            enabled=True,
            settings={"mode": "auto"},
        ),
    ),
)
