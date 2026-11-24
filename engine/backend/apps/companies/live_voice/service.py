"""Live voice's service (PLAN-V28 T1-2): starting a talk.

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

**The month** is a Melbourne calendar month (TBC). Its total is every talk started in it: what
the rows hold, plus what the talks running here have counted since their last write.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Final

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import assistant_names
from apps.companies.assistant import person_key
from apps.companies.assistant_names import HintCache
from apps.companies.live_voice import store, words
from apps.companies.live_voice.schemas import VoiceLimits, VoiceSessionOut
from apps.companies.live_voice.setup import instruction
from apps.companies.live_voice.talks import READY_FOR, Owner, Ready, Talks
from apps.companies.meeting_store import MeetingSource
from apps.companies.notes import MELBOURNE
from apps.companies.today import TaskCopy
from core.api.access import can_use
from core.auth import users
from core.auth.sessions import AuthContext
from core.config import Settings

log = logging.getLogger(__name__)

SOCKET_PATH: Final = "/api/v1/companies/assistant/voice/live"


def _on_app[T](app: FastAPI, name: str, make: Callable[[], T]) -> T:
    """The object on `app.state` (a test puts its own), made on first use."""
    found: T | None = getattr(app.state, name, None)
    if found is None:
        found = make()
        setattr(app.state, name, found)
    return found


def talks_of(app: FastAPI) -> Talks:
    return _on_app(app, "live_voice_talks", Talks)


def owner_of(auth: AuthContext | None) -> Owner:
    return auth.user.id if auth is not None else None


# --- The month -----------------------------------------------------------------------------------


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
