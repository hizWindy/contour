"""How long sign-in records are kept (PLAN-V26 T3-4, choices 14 and 15).

Off until Levi says yes (`SIGN_IN_RECORDS_OK`, S3). Then a daily job deletes the sign-in log's
entries older than `SIGN_IN_KEEP_DAYS` (90, TBC), and the sign-in page says so. Call notes, preps,
forms and spending records are never touched.
"""

from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any

from core.auth import audit
from core.config import Settings, get_settings
from core.db.engine import get_sessionmaker
from core.schedules.calc import Cadence
from core.schedules.jobs import DefaultSchedule, JobContext, JobEstimate, JobResult, JobSpec

SIGN_IN_RECORDS = "core.sign_in_records"


def keep_days(settings: Settings) -> int | None:
    """The days records are kept, or None while nothing is deleted."""
    return settings.sign_in_keep_days if settings.sign_in_records_ok else None


def kept_since(settings: Settings, now: datetime) -> datetime | None:
    days = keep_days(settings)
    return now - timedelta(days=days) if days else None


def describe(settings: dict[str, Any]) -> str:
    days = keep_days(get_settings())
    if days is None:
        return "Deletes nothing yet. It waits for Levi's OK."
    return f"Deletes sign-in records older than {days} days, and nothing else."


async def start(context: JobContext) -> JobResult:
    from core.api.signin import auth_settings_dependency

    provider = context.app.dependency_overrides.get(
        auth_settings_dependency, auth_settings_dependency
    )
    before = kept_since(provider(), context.now)
    if before is None:
        # Not a skip: a skipped job shows as a problem on Health, and waiting isn't one.
        return JobResult(ref="sign-in-records:waiting")
    sessions = getattr(context.app.state, "session_factory", None) or get_sessionmaker()
    async with sessions() as db:
        gone = await audit.delete_before(db, before)
        await db.commit()
    return JobResult(ref=f"sign-in-records:{gone}")


async def estimate(context: JobContext) -> JobEstimate:
    zero = Decimal(0)
    return JobEstimate(
        valid=True,
        problem=None,
        typical_usd=zero,
        worst_usd=zero,
        cap_usd=zero,
        daily_left_usd=zero,
        basis="Free: it only deletes old rows of the sign-in log, and asks Claude nothing.",
    )


SIGN_IN_RECORDS_JOB = JobSpec(
    key=SIGN_IN_RECORDS,
    project="core",
    title="Old sign-in records",
    start=start,
    estimate=estimate,
    describe=describe,
    default=DefaultSchedule(cadence=Cadence(every=1, unit="days", at=time(5, 0)), enabled=True),
)
