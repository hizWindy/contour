"""How long HubSpot matching blocks the backend's event loop (PLAN-V15 T1-4).

Runs 20 company matches at once on the database in `engine/.env` (a track's copy, with the
whole HubSpot copy: about 14,000 companies), while a ticker wakes every 10 ms. When the loop
is blocked, the ticker wakes late. It prints the worst and the p95 lateness, and how long the
matches took.

    uv run --no-sync python ../scripts/lag_check.py
    uv run --no-sync python ../scripts/lag_check.py --matches 40

Free and read only: no Claude, no HubSpot, no writes. Run it from `engine/backend`.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
import time

TICK_SECONDS = 0.01


async def ticker(lags: list[float], stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        start = loop.time()
        await asyncio.sleep(TICK_SECONDS)
        # Windows' timer can wake a sleep a little early: that is no lag, so it counts as 0.
        lags.append(max(0.0, (loop.time() - start - TICK_SECONDS) * 1000))


async def check(matches: int) -> int:
    from sqlalchemy import func, select

    from core.db.engine import get_engine, get_sessionmaker
    from core.hubspot.matching import match_company
    from core.hubspot.models import HubSpotCompany

    sessions = get_sessionmaker()
    try:
        async with sessions() as session:
            count = await session.scalar(select(func.count()).select_from(HubSpotCompany))
            names = list(
                await session.scalars(
                    select(HubSpotCompany.name)
                    .where(HubSpotCompany.name.is_not(None))
                    .order_by(HubSpotCompany.hubspot_id)
                    .limit(matches)
                )
            )
        if not count:
            print("This database has no HubSpot copy. Use a track's copy.", file=sys.stderr)
            return 1
        # Misspelled names, so the fuzzy part runs (an exact name would stop early).
        wanted = [f"{name} Pty Group Holdings" for name in names]

        async def one(name: str) -> None:
            async with sessions() as session:
                await match_company(session, name, city="Melbourne")

        lags: list[float] = []
        stop = asyncio.Event()
        ticking = asyncio.create_task(ticker(lags, stop))
        started = time.perf_counter()
        await asyncio.gather(*(one(name) for name in wanted))
        took = time.perf_counter() - started
        stop.set()
        await ticking
    finally:
        await get_engine().dispose()
    ordered = sorted(lags) or [0.0]
    p95 = ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]
    print(f"{len(wanted)} matches on {count} companies took {took:.1f} s")
    print(f"Event-loop lateness: worst {ordered[-1]:.0f} ms, p95 {p95:.0f} ms")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--matches", type=int, default=20)
    args = parser.parse_args(argv)
    from core.runtime import loop_factory

    return asyncio.run(check(args.matches), loop_factory=loop_factory())


if __name__ == "__main__":
    raise SystemExit(main())
