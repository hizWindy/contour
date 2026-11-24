"""The live voice talks in this backend (PLAN-V28 choice 20): one a person, and at most
`live_voice_max_talks` (10, TBC) at once. There is one backend copy on App Platform, so counting
in memory is the count.

A talk is `ready` from its start until its socket opens (60 seconds at most), `opening` while its
socket's checks run, then `live` while its relay runs. A second start for the same person ends the
first talk (`replaced`). It lives on `app.state.live_voice_talks`; a test puts its own.

Each ready talk keeps, in memory only, the names the start read for it (choice 22): they are never
written to the database.
"""

import asyncio
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final, Protocol

from apps.companies.assistant import CommandLimit
from apps.companies.live_voice.messages import EndReason
from apps.companies.live_voice.meter import Counts

READY_FOR: Final = timedelta(seconds=60)  # a ready talk's socket must open within this
STARTS_PER_MINUTE: Final = 10  # a guard against a page that starts again and again

type Owner = uuid.UUID | None  # the person; None where sign-in is off (one person: the laptop)
NOBODY: Final = object()  # "no person" for `count`, which None can't say


class LiveTalk(Protocol):
    """What the registry needs from a running relay."""

    talk_id: uuid.UUID
    owner: Owner

    def counts(self) -> Counts: ...

    def end(self, reason: EndReason) -> None: ...

    async def finished(self) -> None: ...


@dataclass
class Ready:
    """A talk started but not opened yet."""

    talk_id: uuid.UUID
    owner: Owner
    expires_at: datetime
    names: tuple[str, ...] = field(default=(), repr=False)  # never logged


class Talks:
    def __init__(self, starts_per_minute: int = STARTS_PER_MINUTE) -> None:
        self._ready: dict[uuid.UUID, Ready] = {}
        self._opening: set[uuid.UUID] = set()
        self._live: dict[uuid.UUID, LiveTalk] = {}
        self.start_lock = asyncio.Lock()  # one start at a time: the count and the replace
        self.starts = CommandLimit(per_minute=starts_per_minute)

    # --- Counting ---------------------------------------------------------------------------------

    def _forget_expired(self, now: datetime) -> None:
        for talk_id in [key for key, ready in self._ready.items() if ready.expires_at <= now]:
            del self._ready[talk_id]

    def count(self, now: datetime, *, besides: Owner | object = NOBODY) -> int:
        """Talks ready, opening or live now. `besides`: leave this person's out (their talk is
        about to be replaced). With sign-in off the person is None, so "nobody" is a mark of its
        own."""
        self._forget_expired(now)
        ready = sum(1 for item in self._ready.values() if item.owner != besides)
        live = sum(1 for talk in self._live.values() if talk.owner != besides)
        return ready + live + len(self._opening - self._live.keys())

    def holds(self, talk_id: uuid.UUID) -> bool:
        """A relay in this backend carries this talk now, or its socket is opening."""
        return talk_id in self._live or talk_id in self._opening

    def live(self) -> Iterator[LiveTalk]:
        return iter(list(self._live.values()))

    def live_counts(self, *, besides: uuid.UUID | None = None) -> dict[uuid.UUID, Counts]:
        """Each live talk's counts so far, which its row may not have yet."""
        return {
            talk_id: talk.counts() for talk_id, talk in self._live.items() if talk_id != besides
        }

    # --- Ready and opening talks ------------------------------------------------------------------

    def reserve(self, ready: Ready) -> None:
        self._ready[ready.talk_id] = ready

    def take_ready(self, talk_id: uuid.UUID) -> Ready | None:
        """The ready talk, out of the list (its socket opened). None if it wasn't started here."""
        return self._ready.pop(talk_id, None)

    def begin_open(self, talk_id: uuid.UUID) -> bool:
        """A socket for this talk starts its checks. False when one is opening or open already:
        a talk opens once."""
        if self.holds(talk_id):
            return False
        self._opening.add(talk_id)
        return True

    def end_open(self, talk_id: uuid.UUID) -> None:
        self._opening.discard(talk_id)

    # --- Live talks -------------------------------------------------------------------------------

    def add_live(self, talk: LiveTalk) -> None:
        self._live[talk.talk_id] = talk

    def remove_live(self, talk: LiveTalk) -> None:
        if self._live.get(talk.talk_id) is talk:
            del self._live[talk.talk_id]

    def replace(self, owner: Owner) -> None:
        """Ends this person's talks in this backend, for a new start: the live ones end as
        `replaced` (each relay closes and writes its own row), and the ready ones are forgotten
        (the start ends their rows)."""
        for talk in self.live():
            if talk.owner == owner:
                talk.end("replaced")
        for talk_id in [key for key, ready in self._ready.items() if ready.owner == owner]:
            del self._ready[talk_id]

    async def stop_all(self, reason: EndReason, seconds: float) -> None:
        """Ends every live talk (the backend is stopping) and waits up to `seconds` for each
        relay to close both sides and write its row."""
        talks = list(self.live())
        for talk in talks:
            talk.end(reason)
        if talks:
            await asyncio.wait(
                [asyncio.ensure_future(talk.finished()) for talk in talks], timeout=seconds
            )
