"""The jobs the core itself offers to a schedule. PLAN-V6 D1.

**The HubSpot sync** (`core.hubspot_sync`): copies HubSpot into our database (free, read only). It
is on by default, every day at 6:00 am Melbourne time, so the company list is never a day behind.
`mode` in its settings is `auto` (a full read when the last full one is old, else only what
changed), `full` or `changes`.
"""

from datetime import time
from decimal import Decimal
from typing import Any, cast

from core.hubspot.sync import ModeChoice, SyncAlreadyRunning
from core.schedules.calc import Cadence
from core.schedules.jobs import (
    DefaultSchedule,
    JobContext,
    JobEstimate,
    JobResult,
    JobSettingsError,
    JobSkipped,
    JobSpec,
)

HUBSPOT_SYNC = "core.hubspot_sync"
MODES = ("auto", "full", "changes")
MODE_WORDS = {
    "auto": "Copies everything when the last full copy is old, and only what changed otherwise.",
    "full": "Copies everything, and finds the records that were deleted in HubSpot.",
    "changes": "Copies only what changed since the last copy.",
}


def describe_hubspot_sync(settings: dict[str, Any]) -> str:
    mode = str(settings.get("mode", "auto"))
    return MODE_WORDS.get(mode, f"The sync mode {mode!r} isn't one of auto, full or changes.")


def check_hubspot_settings(settings: dict[str, Any]) -> dict[str, Any]:
    unknown = sorted(set(settings) - {"mode"})
    if unknown:
        raise JobSettingsError(f"{', '.join(unknown)} isn't a choice here. Only mode is used.")
    mode = settings.get("mode", "auto")
    if mode not in MODES:
        raise JobSettingsError("mode must be auto, full or changes.")
    return {"mode": mode}


async def estimate_hubspot_sync(context: JobContext) -> JobEstimate:
    """Free: reading HubSpot has no Claude in it."""
    zero = Decimal(0)
    return JobEstimate(
        valid=True,
        problem=None,
        typical_usd=zero,
        worst_usd=zero,
        cap_usd=zero,
        daily_left_usd=zero,
        basis="Copying HubSpot is free: it reads HubSpot and asks Claude nothing.",
    )


async def start_hubspot_sync(context: JobContext) -> JobResult:
    from core.hubspot.connection import sync_runner

    mode = str(context.settings.get("mode", "auto"))
    if mode not in MODES:
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
        estimate=estimate_hubspot_sync,
        describe=describe_hubspot_sync,
        check_settings=check_hubspot_settings,
        default=DefaultSchedule(
            cadence=Cadence(every=1, unit="days", at=time(6, 0)),
            enabled=True,
            settings={"mode": "auto"},
        ),
    ),
)
