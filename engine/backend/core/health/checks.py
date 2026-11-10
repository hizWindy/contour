"""One check for each system (PLAN-V13 T1-2). See `core.health` for the rules they keep.

Each check is two parts: an async part that gathers the facts (the database, a free call), and a
pure part (`*_finding`) that turns them into a state and a sentence. The tests drive the pure parts
with made-up facts, and the async parts with fakes.

Times in a sentence are Melbourne time, like "6:02 am", or "8 Nov, 6:02 am" when not today.
"""

import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import ROUND_UP, Decimal
from typing import Any
from zoneinfo import ZoneInfo

import anthropic
import httpx2
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import BACKEND_DIR, Settings
from core.health.run import Check, Finding
from core.health.traffic import ApiTraffic, Traffic
from core.hubspot.check import ConnectionCheck
from core.hubspot.sync import SyncOut
from core.schedules.calc import DEFAULT_ZONE
from core.schedules.models import Schedule
from core.signalhire.client import SignalHireError, get_signalhire

log = logging.getLogger(__name__)

ZONE = DEFAULT_ZONE
CLAUDE_TIMEOUT_SECONDS = 5.0
OVERDUE = timedelta(minutes=5)  # a schedule this late was not picked up: the loop isn't running
STUCK = timedelta(minutes=10)  # "starting" this long: the start never finished
SEE_THE_LOG = "The details are in the backend log."


# --- Words ------------------------------------------------------------------------------------


def clock_text(moment: datetime) -> str:
    """ "6:02 am" in Melbourne time."""
    local = moment.astimezone(ZoneInfo(ZONE))
    return local.strftime("%I:%M %p").lstrip("0").replace("AM", "am").replace("PM", "pm")


def when_text(moment: datetime, now: datetime) -> str:
    """ "6:02 am" today, else "8 Nov, 6:02 am" (Melbourne days)."""
    zone = ZoneInfo(ZONE)
    day = moment.astimezone(zone).date()
    if day == now.astimezone(zone).date():
        return clock_text(moment)
    return f"{day.day} {day.strftime('%b')}, {clock_text(moment)}"


def usd(amount: Decimal) -> str:
    return f"US${amount.quantize(Decimal('0.01'), ROUND_UP):,.2f}"


def plural(count: int, word: str, many: str | None = None) -> str:
    return f"{count:,} {word if count == 1 else (many or word + 's')}"


# --- What the checks are given ----------------------------------------------------------------


async def claude_models(key: str, *, http_client: httpx2.AsyncClient | None = None) -> None:
    """Asks Anthropic for its model list: free, and proves the key works. Never an answer from a
    model, so it never costs money. `http_client` is for the tests."""
    client = anthropic.AsyncAnthropic(
        api_key=key, max_retries=0, timeout=CLAUDE_TIMEOUT_SECONDS, http_client=http_client
    )
    try:
        await client.models.list(limit=1)
    finally:
        await client.close()


async def signalhire_credits(settings: Settings) -> int:
    """The Signal Hire account's credit balance: free, and proves the key works."""
    client = get_signalhire(settings)
    if client is None:
        raise LookupError("no key")
    async with client:
        return await client.credits()


@dataclass(frozen=True)
class Migrations:
    """The migrations this code knows: the newest (`heads`) and every one (`known`)."""

    heads: frozenset[str]
    known: frozenset[str]


@functools.cache
def code_migrations() -> Migrations:
    """From the migration files."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini")))
    known = frozenset(revision.revision for revision in script.walk_revisions())
    return Migrations(heads=frozenset(script.get_heads()), known=known)


async def code_migrations_async() -> Migrations:
    return await asyncio.to_thread(code_migrations)


@dataclass(frozen=True)
class Probes:
    """The calls to the outside, swapped for fakes in the tests."""

    claude_models: Callable[[str], Awaitable[None]] = claude_models
    signalhire_credits: Callable[[Settings], Awaitable[int]] = signalhire_credits
    migrations: Callable[[], Awaitable[Migrations]] = code_migrations_async
    hubspot_check: Callable[[FastAPI, bool], Awaitable[ConnectionCheck]] | None = None


@dataclass(frozen=True)
class Context:
    app: FastAPI
    settings: Settings
    sessions: async_sessionmaker[AsyncSession]
    now: datetime
    refresh: bool = False
    probes: Probes = field(default_factory=Probes)


# --- Database ---------------------------------------------------------------------------------


def database_finding(
    pgvector: str | None, database_heads: Sequence[str], code: Migrations
) -> Finding:
    found = sorted(database_heads)
    if pgvector is None:
        return Finding(
            "problem", "It answers, but pgvector isn't turned on.", "Run: engine migrate"
        )
    at = ", ".join(found) or "none"
    if set(found) == set(code.heads):
        return Finding("ok", f"It answers. pgvector {pgvector}, migration {at}.")
    if any(head not in code.known for head in found):
        return Finding(
            "problem",
            f"The database is at migration {at}, which this code doesn't know.",
            "This backend is older than its database. Run the newer code.",
        )
    needed = ", ".join(sorted(code.heads))
    return Finding(
        "problem",
        f"The database is at migration {at}, and the code needs {needed}.",
        "Run: engine migrate",
    )


async def check_database(ctx: Context) -> Finding:
    try:
        async with ctx.sessions() as session:
            pgvector = await session.scalar(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            )
            database_heads = list(
                await session.scalars(text("SELECT version_num FROM alembic_version"))
            )
    except (DBAPIError, SQLAlchemyError, OSError):
        log.warning("health_database_unreachable", exc_info=True)
        return Finding(
            "problem",
            "The database can't be reached.",
            "Start it (on the laptop: docker compose up -d in engine/), then check again.",
        )
    return database_finding(
        None if pgvector is None else str(pgvector),
        database_heads,
        await ctx.probes.migrations(),
    )


# --- Claude -----------------------------------------------------------------------------------


NO_CLAUDE_KEY = Finding(
    "off",
    "No Claude key is set, so research and call prep can't run.",
    "Add ANTHROPIC_API_KEY to engine/.env and restart the backend.",
)


def claude_error_finding(error: Exception) -> Finding:
    """What a failed model-list call means. Only our own words: never the error's text."""
    if isinstance(error, anthropic.AuthenticationError):
        return Finding(
            "problem",
            "Anthropic refused the key.",
            "Make a new key in the Anthropic Console, put it in ANTHROPIC_API_KEY and restart.",
        )
    if isinstance(error, anthropic.PermissionDeniedError):
        return Finding(
            "problem",
            "Anthropic accepted the key but won't let it do this.",
            "Check the key's workspace in the Anthropic Console.",
        )
    if isinstance(error, anthropic.RateLimitError):
        return Finding(
            "problem",
            "Anthropic says the key is over its rate limit right now.",
            "Wait a minute and check again. A run in progress slows down on its own.",
        )
    if isinstance(error, anthropic.APIStatusError):
        return Finding(
            "problem",
            f"Anthropic had a problem (error {error.status_code}).",
            "Check status.anthropic.com, then check again.",
        )
    if isinstance(error, anthropic.APIConnectionError):  # a timeout is one of these
        return Finding(
            "problem",
            "Anthropic can't be reached.",
            "Check this computer's internet connection, then check again.",
        )
    return Finding("problem", "The check of Claude failed.", SEE_THE_LOG)


def claude_ok(spent_usd: Decimal, daily_cap_usd: Decimal) -> Finding:
    return Finding(
        "ok",
        f"Key works. {usd(spent_usd)} spent in the last 24 hours, of the "
        f"{usd(daily_cap_usd)} daily limit.",
    )


async def check_claude(ctx: Context) -> Finding:
    key = ctx.settings.anthropic_api_key
    if key is None or not key.get_secret_value():
        return NO_CLAUDE_KEY
    try:
        await ctx.probes.claude_models(key.get_secret_value())
    except Exception as error:
        log.warning("health_claude_failed", extra={"kind": type(error).__name__})
        return claude_error_finding(error)
    from core.claude.daily import read_spent
    from core.prefs.service import effective_settings

    async with ctx.sessions() as session:
        spent, _ = await read_spent(session)
        settings = await effective_settings(session, base=ctx.settings)
    return claude_ok(spent, settings.daily_cap_usd)


# --- HubSpot ----------------------------------------------------------------------------------


def hubspot_finding(
    check: ConnectionCheck,
    newest: SyncOut | None,
    good: SyncOut | None,
    companies: int,
    now: datetime,
    stale_after: timedelta,
) -> Finding:
    if not check.key_set:
        return Finding(
            "off",
            "No HubSpot key is set, so nothing is copied from HubSpot.",
            "Add HUBSPOT_SERVICE_KEY to engine/.env and restart the backend.",
        )
    if not check.connected:
        return Finding(
            "problem",
            "HubSpot didn't accept the key, or can't be reached.",
            check.problem or SEE_THE_LOG,
        )
    reads = [scope for scope in check.scopes if scope.access == "read"]
    missing = [scope.label for scope in reads if scope.state == "no"]
    if missing:
        have = sum(scope.state == "yes" for scope in reads)
        return Finding(
            "problem",
            f"{have} of {len(reads)} read permissions. Missing: {', '.join(missing)}.",
            "Add them to the key in HubSpot (Settings, Integrations, Private apps).",
        )
    if any(scope.state == "unknown" for scope in reads):
        return Finding(
            "problem",
            "HubSpot didn't answer every permission check.",
            "Check again in a minute.",
        )
    if newest is not None and newest.status == "failed":
        return Finding(
            "problem",
            f"The last sync failed ({when_text(newest.started_at, now)}).",
            "Start one again on the HubSpot tab. " + SEE_THE_LOG,
        )
    running = " A sync is running now." if newest is not None and newest.status == "running" else ""
    if good is None or good.finished_at is None:
        return Finding(
            "problem",
            "No sync has finished yet." + running,
            "Start one on the HubSpot tab.",
        )
    if now - good.finished_at > stale_after:
        return Finding(
            "problem",
            f"The last good sync was {when_text(good.finished_at, now)}.{running}",
            "The daily copy may be off: check Schedules, or start a sync on the HubSpot tab.",
        )
    return Finding(
        "ok",
        f"Last sync {when_text(good.finished_at, now)}, "
        f"{plural(companies, 'company', 'companies')}.{running}",
    )


async def check_hubspot(ctx: Context) -> Finding:
    from core.hubspot import connection
    from core.hubspot.service import summary
    from core.hubspot.sync import last_good, recent_syncs

    if ctx.probes.hubspot_check is not None:
        check = await ctx.probes.hubspot_check(ctx.app, ctx.refresh)
    else:
        check = await connection.connection_check(ctx.app, refresh=ctx.refresh)
    async with ctx.sessions() as session:
        syncs = await recent_syncs(session, limit=1)
        newest = syncs[0] if syncs else None
        good_row = await last_good(session)
        counts = await summary(session)
    good = SyncOut.model_validate(good_row) if good_row is not None else None
    hours = ctx.settings.hubspot_sync_max_age_hours
    stale_after = timedelta(hours=2 * hours if hours > 0 else 48)
    return hubspot_finding(check, newest, good, counts.companies, ctx.now, stale_after)


# --- Signal Hire ------------------------------------------------------------------------------


def signalhire_finding(credits: int | None, error: Exception | None) -> Finding:
    if error is None and credits is not None:
        return Finding("ok", f"Key works. The account has {plural(credits, 'credit')}.")
    if isinstance(error, SignalHireError):  # its title and detail are our own words
        return Finding("problem", f"{error.title}.", error.detail)
    return Finding("problem", "The check of Signal Hire failed.", SEE_THE_LOG)


async def check_signalhire(ctx: Context) -> Finding:
    key = ctx.settings.signalhire_api_key
    if key is None or not key.get_secret_value():
        return Finding(
            "off",
            "No Signal Hire key is set. Staff counts come from HubSpot and Claude.",
            "Add SIGNALHIRE_API_KEY to engine/.env and restart the backend.",
        )
    try:
        credits = await ctx.probes.signalhire_credits(ctx.settings)
    except Exception as error:
        log.warning("health_signalhire_failed", extra={"kind": type(error).__name__})
        return signalhire_finding(None, error)
    return signalhire_finding(credits, None)


# --- Email ------------------------------------------------------------------------------------


def email_finding(settings: Settings) -> Finding:
    """From the settings only: nothing is sent."""
    from core.email.sender import masked

    people = len(settings.lead_finder_notify_emails)
    who = (
        f" The run email goes to {plural(people, 'person', 'people')}."
        if people
        else " No one gets the run email yet (LEAD_FINDER_NOTIFY_EMAILS is empty)."
    )
    if settings.email_provider == "log":
        return Finding(
            "off",
            "Emails are written to the backend log, not sent." + who,
            "To send them, set EMAIL_PROVIDER=resend with EMAIL_API_KEY and EMAIL_FROM.",
        )
    missing = [
        name
        for name, value in (
            ("EMAIL_API_KEY", settings.email_api_key and settings.email_api_key.get_secret_value()),
            ("EMAIL_FROM", settings.email_from),
        )
        if not value
    ]
    if missing:
        return Finding(
            "problem",
            f"Email is set to Resend, but {' and '.join(missing)} "
            f"{'is' if len(missing) == 1 else 'are'} missing, so no email can go out.",
            "Add them to the server's settings and restart the backend.",
        )
    address = settings.email_from or ""
    if "<" in address:  # "Contour HQ <leads@...>": the part in the brackets
        address = address.split("<", 1)[1].rstrip("> ")
    domain = masked(address).removeprefix("***@")
    return Finding("ok", f"Sends through Resend, from an address at {domain}." + who)


async def check_email(ctx: Context) -> Finding:
    return email_finding(ctx.settings)


# --- Schedules --------------------------------------------------------------------------------


@dataclass(frozen=True)
class ScheduleState:
    id: Any
    job: str
    name: str
    enabled: bool
    state: str  # ok, problem or off
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_status: str | None
    note: str | None  # why it is a problem, in plain words


def schedule_state(row: Schedule, now: datetime) -> ScheduleState:
    note: str | None = None
    if row.enabled:
        if row.last_status == "failed":
            note = f"It failed last time. {row.last_error or SEE_THE_LOG}"
        elif row.last_status == "skipped":
            note = f"It didn't start last time. {row.last_error or ''}".strip()
        elif (
            row.last_status == "starting"
            and row.last_run_at is not None
            and now - row.last_run_at > STUCK
        ):
            note = "It began starting and never finished."
        elif row.next_run_at is not None and now - row.next_run_at > OVERDUE:
            note = f"It was due at {when_text(row.next_run_at, now)} and hasn't started."
    state = "off" if not row.enabled else ("problem" if note else "ok")
    return ScheduleState(
        id=row.id,
        job=row.job,
        name=row.name,
        enabled=row.enabled,
        state=state,
        next_run_at=row.next_run_at,
        last_run_at=row.last_run_at,
        last_status=row.last_status,
        note=note,
    )


def schedules_finding(rows: Sequence[Schedule], now: datetime, loop_running: bool) -> Finding:
    states = [schedule_state(row, now) for row in rows]
    on = [item for item in states if item.enabled]
    if not on:
        return Finding("off", "Every schedule is off.", None, states)
    if not loop_running:
        return Finding(
            "problem",
            f"{plural(len(on), 'schedule is', 'schedules are')} on, but the scheduler isn't "
            "running in this backend, so none will start.",
            "Restart the backend. If the database was down when it started, start that first.",
            states,
        )
    bad = [item for item in on if item.state == "problem"]
    if bad:
        first = bad[0]
        more = f" And {plural(len(bad) - 1, 'other')}." if len(bad) > 1 else ""
        return Finding(
            "problem",
            f"{first.name}: {first.note}{more}",
            "Open Schedules to see why, then run it again or wait for its next time.",
            states,
        )
    upcoming = sorted(
        (item for item in on if item.next_run_at is not None),
        key=lambda item: item.next_run_at or now,
    )
    nxt = (
        f" Next: {upcoming[0].name}, {when_text(upcoming[0].next_run_at, now)}."
        if upcoming and upcoming[0].next_run_at is not None
        else ""
    )
    return Finding("ok", f"{plural(len(on), 'schedule')} on.{nxt}", None, states)


async def check_schedules(ctx: Context) -> Finding:
    from core.schedules.service import all_schedules

    async with ctx.sessions() as session:
        rows = await all_schedules(session)
    scheduler = getattr(ctx.app.state, "scheduler", None)
    loop_running = bool(scheduler is not None and getattr(scheduler, "running", False))
    return schedules_finding(rows, ctx.now, loop_running)


# --- API --------------------------------------------------------------------------------------


def api_finding(traffic: Traffic, now: datetime) -> Finding:
    started = datetime.fromtimestamp(traffic.since, tz=UTC)
    span = (
        "in the last hour"
        if traffic.taken - traffic.since >= 59 * 60
        else f"since {when_text(started, now)}"
    )
    if traffic.errors:
        worst = traffic.endpoints[0]
        return Finding(
            "problem",
            f"{plural(traffic.errors, 'error')} {span}, {worst.errors:,} on {worst.method} "
            f"{worst.path}.",
            SEE_THE_LOG,
            traffic,
        )
    if not traffic.endpoints:
        return Finding("ok", f"No requests {span}.", None, traffic)
    slowest = max(traffic.endpoints, key=lambda item: item.slowest_ms)
    return Finding(
        "ok",
        f"{plural(traffic.requests, 'request')} {span}, no errors. Slowest: {slowest.method} "
        f"{slowest.path}, {slowest.slowest_ms:,} ms.",
        None,
        traffic,
    )


async def check_api(ctx: Context) -> Finding:
    traffic: ApiTraffic | None = getattr(ctx.app.state, "api_traffic", None)
    if traffic is None:
        return Finding("off", "This backend doesn't count its requests.", None, None)
    return api_finding(traffic.snapshot(), ctx.now)


# --- All of them ------------------------------------------------------------------------------


def all_checks(ctx: Context) -> list[Check]:
    """Every check, in the order the page lists them when all are well."""
    return [
        Check("database", "Database", lambda: check_database(ctx)),
        Check("claude", "Claude", lambda: check_claude(ctx)),
        Check("hubspot", "HubSpot", lambda: check_hubspot(ctx)),
        Check("signalhire", "Signal Hire", lambda: check_signalhire(ctx)),
        Check("email", "Email", lambda: check_email(ctx)),
        Check("schedules", "Schedules", lambda: check_schedules(ctx)),
        Check("api", "API", lambda: check_api(ctx)),
    ]
