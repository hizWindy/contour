"""Live voice's service (PLAN-V28 T1-2, T1-3): starting a talk, and opening its socket.

**A start** (`POST /assistant/voice/session`) checks, in this order, with the plan's codes:
1. the Call logs or the Meetings tick, never a Viewer (the route's `need`: 403
   `viewer_read_only` or `feature_not_allowed`);
2. the person's own switch (403 `live_voice_not_allowed`);
3. the server's switch and the key (409 `live_voice_off`);
4. the month's limit (429 `live_voice_limit`, until the month changes);
5. the server's talks at once (503 `live_voice_busy`, with `Retry-After`).
Then the person's other talks end (`replaced`), and a `ready` row is made. Its socket must open
within 60 seconds. With sign-in off there is no person: the laptop is one person, as for the
Assistant's other routes.

**The socket** opens a talk once: its owner's `ready` row (60 seconds at most) becomes `open`.

**The month** is a Melbourne calendar month (TBC). Its total is every talk started in it: what
the rows hold, plus what the talks running here have counted since their last write.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Final

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.companies import assistant_names
from apps.companies.assistant import person_key
from apps.companies.assistant_names import HintCache
from apps.companies.live_voice import store, words
from apps.companies.live_voice.google_live import Endpoint, GoogleLink, endpoint_for, open_link
from apps.companies.live_voice.meter import Meter
from apps.companies.live_voice.models import VoiceSession
from apps.companies.live_voice.pricing import prices_for
from apps.companies.live_voice.relay import BrowserSocket, Relay, RelayLimits
from apps.companies.live_voice.schemas import VoiceLimits, VoiceSessionOut
from apps.companies.live_voice.setup import build_setup, instruction
from apps.companies.live_voice.store import Save
from apps.companies.live_voice.talks import READY_FOR, Owner, Ready, Talks
from apps.companies.meeting_store import MeetingSource
from apps.companies.notes import MELBOURNE
from apps.companies.today import TaskCopy
from core.api.access import can_use
from core.auth import users
from core.auth.clock import utcnow
from core.auth.sessions import AuthContext
from core.config import Settings
from core.db.engine import get_sessionmaker
from core.prefs.service import effective_settings

log = logging.getLogger(__name__)

SOCKET_PATH: Final = "/api/v1/companies/assistant/voice/live"

Sessions = async_sessionmaker[AsyncSession]


def _on_app[T](app: FastAPI, name: str, make: Callable[[], T]) -> T:
    """The object on `app.state` (a test puts its own), made on first use."""
    found: T | None = getattr(app.state, name, None)
    if found is None:
        found = make()
        setattr(app.state, name, found)
    return found


def talks_of(app: FastAPI) -> Talks:
    return _on_app(app, "live_voice_talks", Talks)


def sessions_of(app: FastAPI) -> Sessions:
    found: Sessions | None = getattr(app.state, "session_factory", None)
    return found or get_sessionmaker()


def clock_of(app: FastAPI) -> Callable[[], datetime]:
    """The time now, as the routes see it (a test moves `app.state.clock`)."""
    clock: Callable[[], datetime] | None = getattr(app.state, "clock", None)
    return clock or utcnow


def owner_of(auth: AuthContext | None) -> Owner:
    return auth.user.id if auth is not None else None


# --- The month (T1-5) -----------------------------------------------------------------------------


def month_bounds(now: datetime) -> tuple[datetime, datetime, str]:
    """This Melbourne calendar month as [start, end) in UTC, and its name like 2026-11."""
    local = now.astimezone(MELBOURNE)
    first = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    following = (first + timedelta(days=32)).replace(day=1)
    return first.astimezone(UTC), following.astimezone(UTC), f"{first:%Y-%m}"


@dataclass(frozen=True)
class Spent:
    cost_usd: Decimal
    talk_seconds: int
    talks: int


async def spent_this_month(
    session: AsyncSession, talks: Talks, now: datetime, *, besides: uuid.UUID | None = None
) -> Spent:
    """Every talk started this month: the rows, with the talks running here counted from
    memory. `besides` leaves one talk out (its relay adds its own)."""
    start, end, _ = month_bounds(now)
    live = talks.live_counts(besides=besides)
    skip = [*live, *([besides] if besides is not None else [])]
    used = await store.month_use(session, start, end, besides=skip)
    return Spent(
        cost_usd=used.cost_usd + sum((counts.cost_usd for counts in live.values()), Decimal(0)),
        talk_seconds=used.talk_seconds + sum(counts.talk_seconds for counts in live.values()),
        talks=used.talks + len(live),
    )


def seconds_to(end: datetime, now: datetime) -> int:
    return max(1, int((end - now).total_seconds()))


class MonthBudget:
    """The relay's view of the month's limit: the cap in use (it may change on the Settings
    page), and what every other talk has spent."""

    def __init__(self, sessions: Sessions, talks: Talks, now: Callable[[], datetime]) -> None:
        self._sessions = sessions
        self._talks = talks
        self._now = now

    async def read(self, talk_id: uuid.UUID) -> tuple[Decimal, Decimal]:
        async with self._sessions() as session:
            settings = await effective_settings(session)
            spent = await spent_this_month(session, self._talks, self._now(), besides=talk_id)
        return settings.live_voice_month_cap_usd, spent.cost_usd


class TalkRows:
    """The relay's row in the database, written while this relay still holds the talk."""

    def __init__(
        self, sessions: Sessions, talk_id: uuid.UUID, lease: datetime, now: Callable[[], datetime]
    ) -> None:
        self._sessions = sessions
        self._talk_id = talk_id
        self._lease = lease
        self._now = now

    async def save(self, saved: Save) -> None:
        async with self._sessions() as session:
            await store.save(session, self._talk_id, self._lease, saved, self._now())
            await session.commit()

    async def finish(self, saved: Save, *, status: str, reason: str) -> None:
        async with self._sessions() as session:
            await store.finish(
                session,
                self._talk_id,
                self._lease,
                saved,
                status=status,
                reason=reason,
                now=self._now(),
            )
            await session.commit()


# --- The names (choice 22) ------------------------------------------------------------------------


async def names_for(
    session: AsyncSession,
    app: FastAPI,
    *,
    auth: AuthContext | None,
    settings: Settings,
    company_key: str | None,
    now: datetime,
) -> tuple[str, ...]:
    """This person's likely names, read on the server from our copy (the mic's hint list), only
    while Levi's OK is on. Never from the browser, and never written anywhere."""
    if not settings.live_voice_names_ok:
        return ()
    leads = [
        spec.company_leads
        for spec in getattr(app.state, "apps", [])
        if spec.company_leads is not None and can_use(auth, spec.name)
    ]
    found = await assistant_names.hint_list(
        session,
        auth=auth,
        settings=settings,
        company_key=company_key,
        leads=leads,
        source=_on_app(app, "meeting_source", MeetingSource),
        copy=_on_app(app, "today_tasks", TaskCopy),
        hints=_on_app(app, "name_hints", HintCache),
        now=now,
    )
    return tuple(name.text for name in found.names)


# --- A start (T1-2) -------------------------------------------------------------------------------


def limits_of(settings: Settings) -> VoiceLimits:
    return VoiceLimits(
        talk_seconds=settings.live_voice_talk_minutes * 60,
        idle_seconds=settings.live_voice_idle_minutes * 60,
        tool_seconds=settings.live_voice_tool_timeout_seconds,
    )


async def start_talk(
    session: AsyncSession,
    app: FastAPI,
    *,
    auth: AuthContext | None,
    settings: Settings,
    company_key: str | None,
    now: datetime,
) -> VoiceSessionOut:
    """Starts a talk: the checks in the plan's order, then a `ready` row. The route has checked
    the tick and the Viewer already."""
    owner = owner_of(auth)
    if auth is not None and not auth.user.live_voice:
        raise words.not_allowed(await users.platform_admin_name(session))
    if not settings.live_voice_ready:
        raise words.switched_off()
    names = await names_for(
        session, app, auth=auth, settings=settings, company_key=company_key, now=now
    )
    talks = talks_of(app)
    async with talks.start_lock:
        spent = await spent_this_month(session, talks, now)
        if spent.cost_usd >= settings.live_voice_month_cap_usd:
            raise words.month_limit(seconds_to(month_bounds(now)[1], now))
        if talks.count(now, besides=owner) >= settings.live_voice_max_talks:
            raise words.busy()
        wait = talks.starts.take(person_key(auth), now)
        if wait is not None:
            raise words.too_many_starts(wait)
        talks.replace(owner)  # a live talk ends as `replaced` and writes its own row
        live_here = [talk.talk_id for talk in talks.live()]
        ended = await store.end_others(session, owner, keep=live_here, reason="replaced", now=now)
        row = await store.create_ready(
            session,
            owner=owner,
            service=settings.live_voice_service,
            model=settings.live_voice_model,
            prompt_version=instruction().version,
            now=now,
        )
        await session.commit()
        talks.reserve(Ready(row.id, owner, now + READY_FOR, names))
    log.info(
        "live_voice_start",
        extra={"talk": str(row.id), "names": len(names), "ended_before": ended},
    )
    return VoiceSessionOut(
        id=row.id,
        socket=f"{SOCKET_PATH}?session={row.id}",
        expires_at=now + READY_FOR,
        limits=limits_of(settings),
    )


# --- The socket (T1-3) ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Opened:
    """A talk whose socket may run: its row (now `open`)."""

    row: VoiceSession
    resumed: bool
    names: tuple[str, ...] = field(default=(), repr=False)


async def open_talk(
    sessions: Sessions, talks: Talks, talk_id: uuid.UUID, owner: Owner, now: datetime
) -> Opened | None:
    """The talk's row becomes `open` for its owner, once. None when it can't: another person's,
    unknown, too old, opened already, or ended. The caller has taken `talks.begin_open`."""
    async with sessions() as session:
        row = await store.open_ready(session, talk_id, owner, since=now - READY_FOR, now=now)
        if row is not None:
            await session.commit()
            ready = talks.take_ready(talk_id)
            names = ready.names if ready is not None and ready.owner == owner else ()
            return Opened(row, resumed=False, names=names)
        found = await store.find(session, talk_id)
        if found is not None and found.user_id == owner and found.status == "ready":
            await store.end_one(session, talk_id, "expired", now)  # nobody opened it in time
            await session.commit()
            talks.take_ready(talk_id)
        return None


async def end_talk(sessions: Sessions, talk_id: uuid.UUID, reason: str, now: datetime) -> None:
    """Ends a talk nothing carries (its socket failed to start). Never raises: it is a clean-up."""
    try:
        async with sessions() as session:
            await store.end_one(session, talk_id, reason, now)
            await session.commit()
    except Exception as error:
        log.error("live_voice_end_failed", extra={"kind": type(error).__name__})


def relay_limits(app: FastAPI, settings: Settings) -> RelayLimits:
    """The relay's numbers from settings (a test puts its own on `app.state.live_voice_limits`)."""
    found: RelayLimits | None = getattr(app.state, "live_voice_limits", None)
    if found is not None:
        return found
    return RelayLimits(
        talk_seconds=settings.live_voice_talk_minutes * 60,
        idle_seconds=settings.live_voice_idle_minutes * 60,
        tool_seconds=settings.live_voice_tool_timeout_seconds,
    )


def make_relay(
    app: FastAPI,
    browser: BrowserSocket,
    opened: Opened,
    settings: Settings,
    *,
    names: tuple[str, ...],
) -> Relay:
    """The talk's relay, with Google's address (a test puts a fake one on
    `app.state.live_voice_endpoint`), the meter and the row's writer."""
    endpoint: Endpoint = getattr(app.state, "live_voice_endpoint", None) or endpoint_for(settings)
    sent_names = names if settings.live_voice_names_ok else ()

    async def dial(handle: str | None, seconds: float) -> GoogleLink:
        setup = build_setup(model=endpoint.model, names=sent_names, handle=handle)
        return await open_link(endpoint, setup, seconds=seconds)

    row = opened.row
    assert row.opened_at is not None  # the claim set it
    sessions = sessions_of(app)
    now = clock_of(app)
    return Relay(
        talk_id=row.id,
        owner=row.user_id,
        browser=browser,
        dial=dial,
        rows=TalkRows(sessions, row.id, row.opened_at, now),
        budget=MonthBudget(sessions, talks_of(app), now),
        meter=Meter(prices_for(settings.live_voice_model), totals=settings.live_voice_usage_totals),
        limits=relay_limits(app, settings),
        talk_minutes=settings.live_voice_talk_minutes,
    )
