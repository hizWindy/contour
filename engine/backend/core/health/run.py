"""Runs the checks at the same time, each with its own time limit (PLAN-V13 T1-2).

A check is an async function that returns a `Finding`. `run_checks` times each one, stops one that
is still going after `TIMEOUT_SECONDS`, and turns a check that crashed into a problem with a fixed
sentence (the error itself goes to the log, never to the page).
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from core.auth.clock import utcnow

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5.0

State = Literal["ok", "problem", "off"]
SystemId = Literal[
    "database", "claude", "hubspot", "signalhire", "email", "runs", "schedules", "api"
]

CHECK_FAILED = "The check itself failed."
SEE_THE_LOG = "The details are in the backend log."
TOO_SLOW_NEXT = "Check again in a minute. If it stays slow, read the backend log."


@dataclass(frozen=True)
class Finding:
    """What one check found. `data` is extra detail for the page (the schedules, the API)."""

    state: State
    sentence: str
    next_step: str | None = None
    data: Any = None


@dataclass(frozen=True)
class Check:
    id: SystemId
    name: str  # what the page shows, like "Signal Hire"
    run: Callable[[], Awaitable[Finding]]


@dataclass(frozen=True)
class Result:
    id: SystemId
    name: str
    finding: Finding
    took_ms: int
    checked_at: datetime


def too_slow(seconds: float) -> Finding:
    return Finding("problem", f"No answer in {seconds:g} seconds.", TOO_SLOW_NEXT)


async def _one(check: Check, limit_seconds: float, clock: Callable[[], datetime]) -> Result:
    checked_at = clock()
    started = time.perf_counter()
    try:
        async with asyncio.timeout(limit_seconds):
            finding = await check.run()
    except TimeoutError:
        finding = too_slow(limit_seconds)
    except Exception:
        log.exception("health_check_failed", extra={"check": check.id})
        finding = Finding("problem", CHECK_FAILED, SEE_THE_LOG)
    took_ms = round((time.perf_counter() - started) * 1000)
    return Result(check.id, check.name, finding, took_ms, checked_at)


async def run_checks(
    checks: Sequence[Check],
    *,
    limit_seconds: float = TIMEOUT_SECONDS,
    clock: Callable[[], datetime] = utcnow,
) -> list[Result]:
    """Every check at once, in the order given. Never raises for a check's own failure."""
    return list(await asyncio.gather(*(_one(check, limit_seconds, clock) for check in checks)))
