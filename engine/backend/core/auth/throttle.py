"""The limits on guessing a password. PLAN-V6 B4, security rule 2.

**For one login** (an email or a username), counted in a row since the last right password:
- the first 2 wrong tries cost nothing (a typing slip is not an attack);
- each one after that makes the next wait longer: 2 seconds, then 4, 8, 16, 32, and a minute from
  then on;
- the 10th wrong try in a row locks the login for 15 minutes. Every wrong try after the lock ends
  locks it again, so a guesser gets one try every 15 minutes.
A try made during a wait or a lock isn't checked at all, doesn't count, and doesn't make the wait
longer. A right password ends it.

**The same for a login that matches no account.** If only real accounts were slowed and locked,
the lock would say which logins exist. So a login that matches nothing follows the same rules,
kept in memory (`UnknownLogins`) under a hash of what was typed (never the text itself: it may be
a password typed into the wrong box). A real account keeps its count and lock on its row
(`core.users`), so they survive a restart. The difference of a restart wiping the unknown ones is
not something a guesser can use.

**For one IP address:** after 20 wrong tries (any logins) in 15 minutes, that address waits until
the oldest one leaves the window. The tries are counted from the sign-in log, so this holds across
restarts and needs no table of its own.

These are plain functions and small classes: no database except `ip_wait`, no clock of their own.
"""

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import audit
from core.config import Settings

START_WAIT = timedelta(seconds=2)  # the wait after the first try that isn't free; it doubles
MAX_WAIT = timedelta(seconds=60)  # and stops growing here
UNKNOWN_LOGINS_KEPT = 5_000  # the logins that match no account that are remembered at once


@dataclass(frozen=True)
class Rules:
    free_tries: int  # wrong tries in a row that cost nothing
    lock_tries: int  # the wrong try in a row that locks the login
    lock_for: timedelta
    ip_max: int  # wrong tries from one address in the window
    ip_window: timedelta

    @classmethod
    def from_settings(cls, settings: Settings) -> "Rules":
        return cls(
            free_tries=settings.login_free_tries,
            lock_tries=settings.login_lock_tries,
            lock_for=timedelta(minutes=settings.login_lock_minutes),
            ip_max=settings.login_ip_max_failures,
            ip_window=timedelta(minutes=settings.login_ip_window_minutes),
        )


@dataclass(frozen=True)
class Standing:
    """Where one login stands: wrong tries in a row, and when it may try again."""

    failed: int = 0
    blocked_until: datetime | None = None


def wait_for(standing: Standing, now: datetime) -> timedelta | None:
    """How long this login must wait before it is checked again, or None if it may try now."""
    if standing.blocked_until is not None and standing.blocked_until > now:
        return standing.blocked_until - now
    return None


def after_failure(standing: Standing, rules: Rules, now: datetime) -> tuple[Standing, bool]:
    """The standing after one more wrong try, and whether that try locked the login."""
    failed = standing.failed + 1
    if failed >= rules.lock_tries:
        return Standing(failed, now + rules.lock_for), True
    if failed > rules.free_tries:
        wait = min(START_WAIT * 2 ** (failed - rules.free_tries - 1), MAX_WAIT)
        return Standing(failed, now + wait), False
    return Standing(failed, None), False


def after_success() -> Standing:
    return Standing()


class UnknownLogins:
    """What the sign-in remembers about logins that match no account (see the module text).

    The most recently used `capacity` of them are kept, so a flood of made-up logins can't use up
    the memory. It is for one backend (one process): the engine allows one backend per database.
    """

    def __init__(self, capacity: int = UNKNOWN_LOGINS_KEPT) -> None:
        self._capacity = capacity
        self._seen: OrderedDict[str, Standing] = OrderedDict()

    @staticmethod
    def key(identifier: str) -> str:
        """What a login is remembered by: a hash, never the text that was typed."""
        return hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:32]

    def standing(self, identifier: str) -> Standing:
        return self._seen.get(self.key(identifier), Standing())

    def record(self, identifier: str, standing: Standing) -> None:
        key = self.key(identifier)
        self._seen[key] = standing
        self._seen.move_to_end(key)
        while len(self._seen) > self._capacity:
            self._seen.popitem(last=False)

    def __len__(self) -> int:
        return len(self._seen)


async def ip_wait(
    db: AsyncSession, ip: str | None, rules: Rules, now: datetime
) -> timedelta | None:
    """How long this address must wait, or None if it may try. Counted from the sign-in log."""
    stamps = await audit.failures_from(db, ip, now - rules.ip_window)  # newest first
    if len(stamps) < rules.ip_max:
        return None
    # The block ends when the failure that makes the count reach the limit leaves the window.
    lifts = stamps[rules.ip_max - 1] + rules.ip_window
    return max(lifts - now, timedelta(seconds=1))
