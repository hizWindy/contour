"""A small load test: pretend users ask the common pages at once (PLAN-V15 T1-7).

    uv run --no-sync python ../scripts/load.py --base http://127.0.0.1:8031
    uv run --no-sync python ../scripts/load.py --base http://127.0.0.1:8031 --users 10 --seconds 120

Each user asks the pages in turn, as fast as the answers come, until the time is up. Then it
prints the same table as `log_stats.py`: p50, p95 and p99 per page, and the server errors.

**Targets (TBC):** p95 under 300 ms for the read pages, no 5xx, and no `loop_lag` line in the
backend's log while it runs.

It only reads (GET). It runs against this computer only (`localhost`, `127.0.0.1`), unless
`--allow-remote` is given, which needs Al-khair's word: a load test on the live site slows it
for everyone. Sign-in must be off on the backend it tests (the track backends have it off).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from log_stats import format_stats, summarize

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
# The pages a salesperson and an Admin open most (each is one or more reads).
PAGES = (
    "/api/v1/auth/me",
    "/api/v1/health",
    "/api/v1/companies?limit=50",
    "/api/v1/companies/facets",
    "/api/v1/lead-finder/leads?limit=50",
    "/api/v1/lead-finder/leads/facets",
    "/api/v1/runs?limit=20",
    "/api/v1/hubspot/syncs?limit=10",
)


def is_local(base: str) -> bool:
    return (urlsplit(base).hostname or "") in LOCAL_HOSTS


async def one_user(
    client: httpx.AsyncClient, pages: tuple[str, ...], until: float, start_at: int
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    turn = start_at
    while time.monotonic() < until:
        page = pages[turn % len(pages)]
        turn += 1
        started = time.perf_counter()
        try:
            answer = await client.get(page)
            status: int | None = answer.status_code
        except httpx.HTTPError:
            status = 599  # no answer at all counts as a server error
        records.append(
            {
                "message": "request_done",
                "time": datetime.now(UTC).isoformat(),
                "method": "GET",
                "route": page.split("?")[0],
                "status": status,
                "ms": (time.perf_counter() - started) * 1000,
            }
        )
    return records


async def load(
    base: str,
    users: int,
    seconds: float,
    pages: tuple[str, ...],
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    """Every request's record. `transport` is for the tests (an app in memory)."""
    until = time.monotonic() + seconds
    limits = httpx.Limits(max_connections=users, max_keepalive_connections=users)
    async with httpx.AsyncClient(
        base_url=base, timeout=30.0, limits=limits, transport=transport
    ) as client:
        found = await asyncio.gather(
            *(one_user(client, pages, until, start_at=user) for user in range(users))
        )
    return [record for records in found for record in records]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default="http://127.0.0.1:8031", help="the backend's address")
    parser.add_argument("--users", type=int, default=10)
    parser.add_argument("--seconds", type=float, default=120.0)
    parser.add_argument("--allow-remote", action="store_true", help="only on Al-khair's word")
    args = parser.parse_args(argv)
    if not is_local(args.base) and not args.allow_remote:
        print(
            f"{args.base} isn't this computer. A load test there slows it for everyone, so it "
            "needs --allow-remote (on Al-khair's word).",
            file=sys.stderr,
        )
        return 1
    if args.users < 1 or args.seconds <= 0:
        print("--users must be 1 or more, and --seconds more than 0.", file=sys.stderr)
        return 1
    print(f"{args.users} users for {args.seconds:.0f} s against {args.base} ...")
    records = asyncio.run(load(args.base, args.users, args.seconds, PAGES))
    stats = summarize(records)
    print(format_stats(stats))
    print(f"Requests a second: {len(records) / args.seconds:.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
