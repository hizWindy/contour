"""Reads and writes `companies.voice_sessions` (PLAN-V28 T1-2): the one module for the table.

Each function does one short statement and leaves committing to its caller, so no connection is
held while a talk waits on Google or the browser. The status moves on in one statement each
(`UPDATE ... WHERE status = ... RETURNING`), so two sockets can never open one talk.

A talk's owner is a user id, or none where sign-in is off. The month is a Melbourne calendar month
(TBC), and a talk counts in the month it started.
"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, and_, func, or_, select, true, update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.live_voice.meter import Counts, token_columns
from apps.companies.live_voice.models import VoiceSession
from apps.companies.live_voice.pricing import KINDS, Tokens


def _owned_by(owner: uuid.UUID | None) -> ColumnElement[bool]:
    if owner is None:
        return VoiceSession.user_id.is_(None)
    return VoiceSession.user_id == owner


def counts_of(row: VoiceSession) -> Counts:
    """What a row has counted so far: where a resumed talk's meter starts."""
    return Counts(
        tokens=Tokens(**{kind: int(getattr(row, f"tokens_{kind}")) for kind in KINDS}),
        cost_usd=Decimal(row.cost_usd),
        listen_seconds=row.listen_seconds,
        speak_seconds=row.speak_seconds,
        talk_seconds=row.talk_seconds,
        tool_calls=row.tool_calls,
        reconnects=row.reconnects,
    )


def _count_values(counts: Counts) -> dict[str, Any]:
    return {
        **token_columns(counts.tokens),
        "cost_usd": counts.cost_usd,
        "listen_seconds": counts.listen_seconds,
        "speak_seconds": counts.speak_seconds,
        "talk_seconds": counts.talk_seconds,
        "tool_calls": counts.tool_calls,
        "reconnects": counts.reconnects,
    }


async def create_ready(
    session: AsyncSession,
    *,
    owner: uuid.UUID | None,
    service: str,
    model: str,
    prompt_version: str,
    now: datetime,
) -> VoiceSession:
    row = VoiceSession(
        user_id=owner,
        status="ready",
        service=service,
        model=model,
        prompt_version=prompt_version,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return row


async def find(session: AsyncSession, talk_id: uuid.UUID) -> VoiceSession | None:
    return await session.get(VoiceSession, talk_id, populate_existing=True)


async def end_others(
    session: AsyncSession,
    owner: uuid.UUID | None,
    *,
    keep: Collection[uuid.UUID],
    reason: str,
    now: datetime,
) -> int:
    """Ends this person's talks that haven't ended, except `keep` (those a relay here carries:
    it writes its own row). Their handles go. Returns how many."""
    result = await session.execute(
        update(VoiceSession)
        .where(
            _owned_by(owner),
            VoiceSession.status != "ended",
            VoiceSession.id.not_in(list(keep)) if keep else true(),
        )
        .values(
            status="ended",
            end_reason=reason,
            ended_at=now,
            updated_at=now,
            resume_handle=None,
        )
        .returning(VoiceSession.id)
    )
    return len(result.all())


async def open_ready(
    session: AsyncSession,
    talk_id: uuid.UUID,
    owner: uuid.UUID | None,
    *,
    since: datetime,
    now: datetime,
) -> VoiceSession | None:
    """A ready talk of this person, started at or after `since`, becomes open. None when it isn't
    one (another person's, too old, or opened already)."""
    result = await session.execute(
        update(VoiceSession)
        .where(
            VoiceSession.id == talk_id,
            _owned_by(owner),
            VoiceSession.status == "ready",
            VoiceSession.created_at >= since,
        )
        .values(status="open", opened_at=now, updated_at=now)
        .returning(VoiceSession)
    )
    return result.scalar_one_or_none()


async def open_again(
    session: AsyncSession,
    talk_id: uuid.UUID,
    owner: uuid.UUID | None,
    *,
    dropped_since: datetime,
    written_since: datetime,
    now: datetime,
) -> VoiceSession | None:
    """A talk of this person that can carry on after a backend restart becomes open again: one the
    backend marked `dropped` at or after `dropped_since`, or one still `open` (a backend that died
    without marking it) whose row was written at or after `written_since`. Either needs a resume
    handle. The caller checks that no relay here carries it."""
    result = await session.execute(
        update(VoiceSession)
        .where(
            VoiceSession.id == talk_id,
            _owned_by(owner),
            VoiceSession.resume_handle.is_not(None),
            or_(
                and_(VoiceSession.status == "dropped", VoiceSession.ended_at >= dropped_since),
                and_(VoiceSession.status == "open", VoiceSession.updated_at >= written_since),
            ),
        )
        .values(status="open", end_reason=None, ended_at=None, opened_at=now, updated_at=now)
        .returning(VoiceSession)
    )
    return result.scalar_one_or_none()


async def end_one(session: AsyncSession, talk_id: uuid.UUID, reason: str, now: datetime) -> None:
    """Ends one talk that hasn't ended (a ready one nobody opened in time, or one that can't carry
    on), and drops its handle."""
    await session.execute(
        update(VoiceSession)
        .where(VoiceSession.id == talk_id, VoiceSession.status != "ended")
        .values(status="ended", end_reason=reason, ended_at=now, updated_at=now, resume_handle=None)
    )


@dataclass(frozen=True)
class Save:
    """What a relay writes: the counts, and the handle (a secret) while the talk may resume."""

    counts: Counts
    handle: str | None

    def __repr__(self) -> str:  # never the handle
        return f"Save(cost_usd={self.counts.cost_usd})"


def _held(talk_id: uuid.UUID, lease: datetime) -> list[ColumnElement[bool]]:
    """The relay that opened the talk at `lease` still has it: a talk opened again elsewhere
    (after a restart) has a newer `opened_at`, so an old relay can't write over it."""
    return [
        VoiceSession.id == talk_id,
        VoiceSession.status == "open",
        VoiceSession.opened_at == lease,
    ]


async def save(
    session: AsyncSession, talk_id: uuid.UUID, lease: datetime, saved: Save, now: datetime
) -> None:
    """The counts every 30 seconds, while the talk is open."""
    await session.execute(
        update(VoiceSession)
        .where(*_held(talk_id, lease))
        .values(**_count_values(saved.counts), resume_handle=saved.handle, updated_at=now)
    )


async def finish(
    session: AsyncSession,
    talk_id: uuid.UUID,
    lease: datetime,
    saved: Save,
    *,
    status: str,
    reason: str,
    now: datetime,
) -> None:
    """The end: `ended` (the handle goes) or `dropped` (the backend stopped: the handle stays, so
    the talk may carry on)."""
    handle = saved.handle if status == "dropped" else None
    await session.execute(
        update(VoiceSession)
        .where(*_held(talk_id, lease))
        .values(
            **_count_values(saved.counts),
            status=status,
            end_reason=reason,
            ended_at=now,
            updated_at=now,
            resume_handle=handle,
        )
    )


@dataclass(frozen=True)
class MonthUse:
    cost_usd: Decimal
    talk_seconds: int
    talks: int


async def month_use(
    session: AsyncSession,
    start: datetime,
    end: datetime,
    *,
    besides: Collection[uuid.UUID] = (),
) -> MonthUse:
    """Every talk started in [start, end): US$, seconds open and how many. `besides` leaves out
    the talks whose newest counts are in memory (their relays add them)."""
    statement = select(
        func.coalesce(func.sum(VoiceSession.cost_usd), 0),
        func.coalesce(func.sum(VoiceSession.talk_seconds), 0),
        func.count(VoiceSession.id),
    ).where(VoiceSession.created_at >= start, VoiceSession.created_at < end)
    if besides:
        statement = statement.where(VoiceSession.id.not_in(list(besides)))
    cost_usd, seconds, talks = (await session.execute(statement)).one()
    return MonthUse(Decimal(cost_usd), int(seconds), int(talks))
