"""A small load test for the API (PLAN-V7 A4). Plain Python and httpx, so it adds no package.

    uv run --no-sync python scripts/loadtest.py                      # 20 people, 60 seconds
    uv run --no-sync python scripts/loadtest.py --users 20 --seconds 300 --out scripts/out/base.json
    uv run --no-sync python scripts/loadtest.py --think 0.2,1   # a stress test, far busier

Start the big database first (see tests/e2e/perf_seed.py), then the fake backend on it, on its
own port so it never meets your real backend:

    $env:API_PORT = '8010'; uv run --no-sync python -m tests.e2e.serve --perf

It only ever talks to the address you give (`--base`, default http://127.0.0.1:8010) and only
READS (GET). It refuses port 8000 unless you pass --allow-8000, and it refuses any address that is
not this computer: a load test must never hit a live server (PLAN-V7, "How to work").

Each virtual person keeps opening pages the way a person does: Results with a filter or a sort,
the next pages, the filter counts, the map, a lead card, Runs, Start's choices and Rules. The
mix is in `STEPS`. A person reads the page for 3 to 10 seconds between steps (`--think`), so 20
people ask for about 6 things a second. `--think 0.2,1` is a stress test, to see how much one
backend can take: it shows where it gives up, not how it feels to people. At the end it prints, for
each route, how many answers, how many errors, and p50, p95, p99 and the slowest, in
milliseconds, and writes the same as JSON when `--out` is given.
"""

import argparse
import asyncio
import json
import random
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

API = "/api/v1"
CITIES = ("Melbourne", "Sydney", "Perth", "Adelaide")
RESULTS = ("pass", "director_review", "watch", "drop")
SORTS = ("score", "created_at", "company", "result")
TRIGGERS = ("lease_ending", "merger_or_takeover", "fast_growth", "new_facility")
WORDS = ("Atlas", "Harbour", "Logistics", "Summit", "Health", "Energy")


def results_query(rng: random.Random, page: int = 0) -> dict[str, Any]:
    """The query a person's Results page asks for: a few filters, a sort, one page of 50."""
    query: dict[str, Any] = {
        "limit": 50,
        "offset": page * 50,
        "sort": rng.choice(SORTS),
        "order": rng.choice(("asc", "desc")),
    }
    roll = rng.random()
    if roll < 0.35:
        query["result"] = rng.sample(RESULTS, rng.randint(1, 2))
    if roll < 0.2 or roll > 0.8:
        query["city"] = rng.sample(CITIES, rng.randint(1, 2))
    if 0.3 < roll < 0.5:
        query["min_score"] = rng.choice((50, 60, 70))
    if 0.5 < roll < 0.6:
        query["trigger"] = [rng.choice(TRIGGERS)]
    if 0.6 < roll < 0.7:
        query["q"] = rng.choice(WORDS)
    return query


class Stats:
    """The time of every answer, by route name."""

    def __init__(self) -> None:
        self.times: dict[str, list[float]] = defaultdict(list)
        self.errors: dict[str, int] = defaultdict(int)

    def add(self, name: str, seconds: float, ok: bool) -> None:
        self.times[name].append(seconds * 1000)
        if not ok:
            self.errors[name] += 1

    def report(self) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        for name, values in sorted(self.times.items()):
            ordered = sorted(values)

            def at(share: float, ordered: list[float] = ordered) -> float:
                return ordered[min(len(ordered) - 1, int(len(ordered) * share))]

            out[name] = {
                "n": float(len(ordered)),
                "errors": float(self.errors[name]),
                "p50": round(statistics.median(ordered), 1),
                "p95": round(at(0.95), 1),
                "p99": round(at(0.99), 1),
                "max": round(ordered[-1], 1),
            }
        return out


async def get(
    client: httpx.AsyncClient, stats: Stats, name: str, path: str, params: Any = None
) -> Any:
    """One GET, timed. Returns the JSON, or None when the answer was not a 200."""
    started = time.perf_counter()
    try:
        response = await client.get(API + path, params=params)
        ok = response.status_code == 200
    except httpx.HTTPError:
        stats.add(name, time.perf_counter() - started, False)
        return None
    stats.add(name, time.perf_counter() - started, ok)
    return response.json() if ok else None


async def person(
    client: httpx.AsyncClient,
    stats: Stats,
    rng: random.Random,
    until: float,
    think: tuple[float, float],
) -> None:
    """One virtual person, opening pages until the time is up."""
    lead_ids: list[str] = []
    while time.monotonic() < until:
        step = rng.choices(STEPS, weights=[weight for _, weight in STEPS_WEIGHTS])[0]
        query = results_query(rng)
        if step == "results":
            # The Results page asks for the rows, the filter counts and (on the map view) the pins.
            rows, _, _ = await asyncio.gather(
                get(client, stats, "leads list", "/lead-finder/leads", query),
                get(client, stats, "leads facets", "/lead-finder/leads/facets", query),
                get(client, stats, "leads map", "/lead-finder/leads/map", query)
                if rng.random() < 0.3
                else asyncio.sleep(0),
            )
            if rows:
                lead_ids = [item["id"] for item in rows["items"]] or lead_ids
        elif step == "next_page":
            await get(
                client,
                stats,
                "leads list (deep)",
                "/lead-finder/leads",
                {
                    **query,
                    "offset": rng.randint(1, 150) * 50,
                },
            )
        elif step == "lead" and lead_ids:
            await get(client, stats, "lead card", f"/lead-finder/leads/{rng.choice(lead_ids)}")
        elif step == "runs":
            await asyncio.gather(
                get(client, stats, "runs list", "/runs", {"limit": 50, "app": "lead_finder"}),
                get(client, stats, "runs summary", "/runs/summary"),
            )
        elif step == "start":
            await asyncio.gather(
                get(client, stats, "run options", "/lead-finder/run-options"),
                get(client, stats, "rules", "/lead-finder/rules"),
            )
        elif step == "home":
            await asyncio.gather(
                get(client, stats, "runs list", "/runs", {"limit": 1, "app": "lead_finder"}),
                get(client, stats, "leads facets", "/lead-finder/leads/facets"),
            )
        await asyncio.sleep(rng.uniform(*think))


STEPS_WEIGHTS = (
    ("results", 40),
    ("next_page", 12),
    ("lead", 20),
    ("runs", 10),
    ("start", 6),
    ("home", 12),
)
STEPS = [name for name, _ in STEPS_WEIGHTS]


def check_address(base: str, allow_8000: bool) -> None:
    host = urlparse(base)
    if host.hostname not in ("127.0.0.1", "localhost"):
        raise SystemExit(f"{base} is not this computer. A load test never goes to a live server.")
    if host.port == 8000 and not allow_8000:
        raise SystemExit(
            "Port 8000 is where your real backend runs. Use API_PORT=8010 for the fake."
        )


async def run(
    base: str, users: int, seconds: float, seed: int, think: tuple[float, float]
) -> Stats:
    stats = Stats()
    until = time.monotonic() + seconds
    limits = httpx.Limits(max_connections=users * 4)
    async with httpx.AsyncClient(base_url=base, timeout=60, limits=limits) as client:
        health = await client.get(f"{API}/health")
        health.raise_for_status()
        await asyncio.gather(
            *(person(client, stats, random.Random(seed + n), until, think) for n in range(users))
        )
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load-test the fake backend (PLAN-V7 A4).")
    parser.add_argument("--base", default="http://127.0.0.1:8010")
    parser.add_argument("--users", type=int, default=20)
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--think", default="3,10", help="MIN,MAX seconds between steps (3,10).")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", type=Path, help="Also write the numbers here, as JSON.")
    parser.add_argument("--allow-8000", action="store_true")
    args = parser.parse_args(argv)
    check_address(args.base, args.allow_8000)

    low, high = (float(part) for part in args.think.split(","))
    stats = asyncio.run(run(args.base, args.users, args.seconds, args.seed, (low, high)))
    report = stats.report()
    print(
        f"{args.users} people for {args.seconds:.0f} s, {args.think} s between steps, {args.base}"
    )
    print(f"{'route':22} {'n':>6} {'err':>4} {'p50':>8} {'p95':>8} {'p99':>8} {'max':>8}  (ms)")
    for name, row in report.items():
        print(
            f"{name:22} {row['n']:6.0f} {row['errors']:4.0f} {row['p50']:8.1f} {row['p95']:8.1f}"
            f" {row['p99']:8.1f} {row['max']:8.1f}"
        )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Written to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
