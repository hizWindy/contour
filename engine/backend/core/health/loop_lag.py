"""Event-loop lag: how late the backend's one worker wakes up (PLAN-V15 T1-2).

The backend answers every request on one event loop. Heavy work on it (a big fuzzy match, a
large JSON build) makes every other request wait, and nothing else in the log shows that. This
watcher sleeps for `every` seconds again and again. When it wakes more than `warn_ms` late, the
loop was blocked for about that long, and it logs `loop_lag` with `lag_ms`.

`scripts/log_stats.py` counts these lines. More than a few a day means something blocks the
loop and should move to a thread. The 250 ms limit is a first guess (**TBC**).
"""

import asyncio
import contextlib
import logging

from fastapi import FastAPI

log = logging.getLogger(__name__)

EVERY_SECONDS = 1.0
WARN_MS = 250.0


async def watch_loop_lag(*, every: float = EVERY_SECONDS, warn_ms: float = WARN_MS) -> None:
    """Runs until cancelled."""
    loop = asyncio.get_running_loop()
    while True:
        start = loop.time()
        await asyncio.sleep(every)
        lag_ms = (loop.time() - start - every) * 1000
        if lag_ms > warn_ms:
            log.warning("loop_lag", extra={"lag_ms": round(lag_ms)})


def start_watch(app: FastAPI) -> None:
    app.state.loop_lag_watch = asyncio.create_task(watch_loop_lag(), name="loop-lag-watch")


async def stop_watch(app: FastAPI) -> None:
    task: asyncio.Task[None] | None = getattr(app.state, "loop_lag_watch", None)
    if task is None:
        return
    del app.state.loop_lag_watch
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
