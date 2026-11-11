"""How fast and how healthy the backend was, from its log (PLAN-V15 T1-7).

Reads a backend log (the live one from `live_log.py`, or a local one) and prints, for each
route: how many requests, p50, p95 and p99 (the times that half, 95% and 99% of requests were
answered within), and how many failed. Then the totals, and the event-loop lag warnings.

    uv run --no-sync python ../scripts/log_stats.py live.log
    uv run --no-sync python ../scripts/log_stats.py live.log --json

It reads the `request_done` lines (PLAN-V15 T1-2). An older log has only uvicorn's access lines,
which have no times: those are counted by status only, so the error rate still shows.

A line may start with App Platform's prefix (`backend 2026-11-11T16:11:43Z {...}`) or be the
JSON alone. Lines that aren't JSON are skipped.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_ACCESS_STATUS = re.compile(r'" (\d{3})')
_ACCESS_ROUTE = re.compile(r'"(\w+) ([^ ?"]+)')


def percentile(values: list[float], share: float) -> float:
    """The nearest-rank percentile: the smallest value with at least `share` of the values at
    or below it. 0 for no values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(share * len(ordered)))
    return ordered[rank - 1]


def parse_line(line: str) -> dict[str, Any] | None:
    start = line.find("{")
    if start < 0:
        return None
    try:
        record = json.loads(line[start:])
    except ValueError:
        return None
    return record if isinstance(record, dict) else None


@dataclass
class RouteStats:
    method: str
    route: str
    requests: int = 0
    errors: int = 0  # 500 and above, except 503
    unavailable: int = 0  # 503: on purpose, like a deploy
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    p99_ms: float = 0.0
    slowest_ms: float = 0.0


@dataclass
class Stats:
    routes: list[RouteStats] = field(default_factory=list)
    requests: int = 0
    timed: int = 0  # requests with a time (request_done lines)
    errors: int = 0
    unavailable: int = 0
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    p99_ms: float = 0.0
    loop_lags: int = 0
    worst_lag_ms: float = 0.0
    first: str | None = None
    last: str | None = None

    @property
    def error_rate(self) -> float:
        return self.errors / self.requests if self.requests else 0.0


def summarize(records: Iterable[dict[str, Any]]) -> Stats:
    """The numbers from parsed log records. Also takes the records `load.py` makes, which have
    the same fields as a `request_done` line."""
    times: dict[tuple[str, str], list[float]] = defaultdict(list)
    counts: dict[tuple[str, str], RouteStats] = {}
    all_times: list[float] = []
    stats = Stats()
    for record in records:
        when = record.get("time")
        if isinstance(when, str):
            stats.first = stats.first or when
            stats.last = when
        message = record.get("message")
        if message == "loop_lag":
            stats.loop_lags += 1
            stats.worst_lag_ms = max(stats.worst_lag_ms, float(record.get("lag_ms") or 0))
            continue
        if message == "request_done":
            method, route = str(record.get("method", "?")), str(record.get("route", "?"))
            status, ms = record.get("status"), record.get("ms")
        elif record.get("logger") == "uvicorn.access" and isinstance(message, str):
            found_status, found_route = (
                _ACCESS_STATUS.search(message),
                _ACCESS_ROUTE.search(message),
            )
            if not found_status or not found_route:
                continue
            method, route = found_route.group(1), found_route.group(2)
            route = re.sub(r"/[0-9a-f-]{8,}|/\d+", "/{id}", route)  # no real ids in the table
            status, ms = int(found_status.group(1)), None
        else:
            continue
        key = (method, route)
        item = counts.setdefault(key, RouteStats(method, route))
        item.requests += 1
        stats.requests += 1
        if isinstance(status, int):
            if status == 503:
                item.unavailable += 1
                stats.unavailable += 1
            elif status >= 500:
                item.errors += 1
                stats.errors += 1
        if isinstance(ms, int | float):
            times[key].append(float(ms))
            all_times.append(float(ms))
    for key, item in counts.items():
        values = times.get(key, [])
        item.p50_ms = percentile(values, 0.50)
        item.p95_ms = percentile(values, 0.95)
        item.p99_ms = percentile(values, 0.99)
        item.slowest_ms = max(values, default=0.0)
    stats.routes = sorted(counts.values(), key=lambda item: (-item.p95_ms, -item.requests))
    stats.timed = len(all_times)
    stats.p50_ms = percentile(all_times, 0.50)
    stats.p95_ms = percentile(all_times, 0.95)
    stats.p99_ms = percentile(all_times, 0.99)
    return stats


def read_log(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8", errors="replace") as handle:
        return [record for line in handle if (record := parse_line(line)) is not None]


def format_stats(stats: Stats) -> str:
    lines = [
        f"{'Route':<52} {'Count':>6} {'p50':>7} {'p95':>7} {'p99':>7} {'5xx':>5} {'503':>5}",
    ]
    for item in stats.routes:
        name = f"{item.method} {item.route}"
        if len(name) > 52:
            name = name[:49] + "..."
        lines.append(
            f"{name:<52} {item.requests:>6} {item.p50_ms:>7.0f} {item.p95_ms:>7.0f} "
            f"{item.p99_ms:>7.0f} {item.errors:>5} {item.unavailable:>5}"
        )
    lines.append("")
    span = f" from {stats.first} to {stats.last}" if stats.first else ""
    lines.append(f"Requests: {stats.requests}{span}")
    if stats.timed:
        lines.append(
            f"Times (ms): p50 {stats.p50_ms:.0f}, p95 {stats.p95_ms:.0f}, p99 {stats.p99_ms:.0f}"
            f" ({stats.timed} timed)"
        )
    else:
        lines.append("Times: none in this log (it has no request_done lines)")
    lines.append(
        f"Server errors (5xx, not 503): {stats.errors} ({stats.error_rate:.2%}). "
        f"Not ready (503): {stats.unavailable}."
    )
    lines.append(
        f"Event-loop lag warnings: {stats.loop_lags}"
        + (f", worst {stats.worst_lag_ms:.0f} ms" if stats.loop_lags else "")
    )
    return "\n".join(lines)


def to_json(stats: Stats) -> str:
    body = asdict(stats)
    body["error_rate"] = stats.error_rate
    return json.dumps(body, indent=2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("log", type=Path, help="the log file")
    parser.add_argument("--json", action="store_true", help="print JSON instead of a table")
    args = parser.parse_args(argv)
    if not args.log.is_file():
        print(f"No such file: {args.log}", file=sys.stderr)
        return 1
    stats = summarize(read_log(args.log))
    print(to_json(stats) if args.json else format_stats(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
