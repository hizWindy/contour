"""The API's traffic over the last hour, counted in memory (PLAN-V13 T1-2).

For each endpoint (its method and its path as written in the code, like
`GET /api/v1/runs/{run_id}`), the requests, the answers that failed and the slowest time. No
database: the counts live in this process and start again when the backend restarts.

**What is counted.** Requests under `/api/` that reached an endpoint. A request no route matched
(a 404 for an unknown path) or one refused before routing (no session, a bad host) has no endpoint,
so it isn't counted. Each answer goes in one of three groups:
- `errors`: 500 and above, except 503, and a request that crashed before it answered. These are
  faults: something in the code or in a service it called went wrong.
- `unavailable`: 503. The backend said on purpose that a part of it isn't ready or can't be
  reached right now, like the run engine while a new backend takes over after a deploy, or a
  database that is down. Not a fault of the request; the Health tab's other rows say which part.
- `refused`: 400 to 499 (a person without the right, a form that isn't valid). Not faults.

A request that was cancelled before it answered (the backend stopping) isn't counted.

**The time** is how long the backend took to start its answer. A stream (the run events) would
otherwise count as slow for as long as someone watched it.

**It never gets in the way:** counting can't fail a request or change its answer. If counting
itself goes wrong, the request goes on untouched and the backend log says so once.

**Memory stays small:** one bucket a minute for each endpoint, and buckets older than an hour are
dropped. The endpoints are the code's own, so their number is fixed.
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)

WINDOW_MINUTES = 60
API_PREFIX = "/api/"
MAX_ENDPOINTS = 500  # a guard: the code has far fewer
UNAVAILABLE = 503


@dataclass
class _Bucket:
    minute: int
    requests: int = 0
    errors: int = 0
    unavailable: int = 0
    refused: int = 0
    total_ms: float = 0.0
    slowest_ms: float = 0.0
    last_error_at: float | None = None
    last_error_status: int | None = None
    first_unavailable_at: float | None = None
    last_unavailable_at: float | None = None


@dataclass(frozen=True)
class EndpointTraffic:
    method: str
    path: str
    requests: int
    errors: int
    refused: int
    average_ms: int
    slowest_ms: int
    unavailable: int = 0
    last_error_at: float | None = None  # a time.time() moment
    last_error_status: int | None = None
    first_unavailable_at: float | None = None
    last_unavailable_at: float | None = None


@dataclass(frozen=True)
class Traffic:
    """The last hour, or less when the backend started less than an hour ago."""

    since: float  # a time.time() moment
    taken: float  # when this snapshot was taken, the same way
    requests: int
    errors: int
    endpoints: list[EndpointTraffic] = field(default_factory=list)
    unavailable: int = 0
    first_unavailable_at: float | None = None
    last_unavailable_at: float | None = None


def _latest(values: list[float | None]) -> float | None:
    found = [value for value in values if value is not None]
    return max(found) if found else None


def _earliest(values: list[float | None]) -> float | None:
    found = [value for value in values if value is not None]
    return min(found) if found else None


class ApiTraffic:
    """The counter. `clock` gives seconds (time.time), for the tests."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._started = clock()
        self._buckets: dict[tuple[str, str], list[_Bucket]] = {}

    def record(self, method: str, path: str, status: int, ms: float) -> None:
        key = (method, path)
        if key not in self._buckets and len(self._buckets) >= MAX_ENDPOINTS:
            return
        now = self._clock()
        minute = int(now // 60)
        buckets = self._buckets.setdefault(key, [])
        if not buckets or buckets[-1].minute != minute:
            buckets.append(_Bucket(minute))
            self._drop_old(buckets, minute)
        bucket = buckets[-1]
        bucket.requests += 1
        if status == UNAVAILABLE:
            bucket.unavailable += 1
            if bucket.first_unavailable_at is None:
                bucket.first_unavailable_at = now
            bucket.last_unavailable_at = now
        elif status >= 500:
            bucket.errors += 1
            bucket.last_error_at = now
            bucket.last_error_status = status
        elif status >= 400:
            bucket.refused += 1
        bucket.total_ms += ms
        bucket.slowest_ms = max(bucket.slowest_ms, ms)

    @staticmethod
    def _drop_old(buckets: list[_Bucket], minute: int) -> None:
        oldest = minute - WINDOW_MINUTES + 1
        while buckets and buckets[0].minute < oldest:
            buckets.pop(0)

    def snapshot(self) -> Traffic:
        """The last hour: each endpoint with requests. Failed ones first, then the ones that
        answered "not ready", then the slowest."""
        now = self._clock()
        minute = int(now // 60)
        endpoints: list[EndpointTraffic] = []
        for (method, path), buckets in self._buckets.items():
            self._drop_old(buckets, minute)
            requests = sum(bucket.requests for bucket in buckets)
            if requests == 0:
                continue
            total = sum(bucket.total_ms for bucket in buckets)
            failed = [bucket for bucket in buckets if bucket.last_error_at is not None]
            endpoints.append(
                EndpointTraffic(
                    method=method,
                    path=path,
                    requests=requests,
                    errors=sum(bucket.errors for bucket in buckets),
                    refused=sum(bucket.refused for bucket in buckets),
                    average_ms=round(total / requests),
                    slowest_ms=round(max(bucket.slowest_ms for bucket in buckets)),
                    unavailable=sum(bucket.unavailable for bucket in buckets),
                    last_error_at=failed[-1].last_error_at if failed else None,
                    last_error_status=failed[-1].last_error_status if failed else None,
                    first_unavailable_at=_earliest(
                        [bucket.first_unavailable_at for bucket in buckets]
                    ),
                    last_unavailable_at=_latest([bucket.last_unavailable_at for bucket in buckets]),
                )
            )
        endpoints.sort(
            key=lambda item: (
                -item.errors,
                -item.unavailable,
                -item.slowest_ms,
                item.path,
                item.method,
            )
        )
        window_start = (minute - WINDOW_MINUTES + 1) * 60
        return Traffic(
            since=max(self._started, window_start),
            taken=now,
            requests=sum(item.requests for item in endpoints),
            errors=sum(item.errors for item in endpoints),
            endpoints=endpoints,
            unavailable=sum(item.unavailable for item in endpoints),
            first_unavailable_at=_earliest([item.first_unavailable_at for item in endpoints]),
            last_unavailable_at=_latest([item.last_unavailable_at for item in endpoints]),
        )


class TrafficMiddleware:
    """Counts each API request into `traffic` once its answer has started (pure ASGI, so a
    stream passes through untouched).

    The matched route is in the scope, but FastAPI keeps an included router nested, so the route
    knows only its own part of the path (`/health/details`). Its full path comes from
    `api_routes`, by its endpoint function (the same object in both), looked up once.

    Counting never raises: a request is answered the same with or without it.
    """

    def __init__(self, app: ASGIApp, traffic: ApiTraffic) -> None:
        from core.api.routes import RoutePaths

        self.app = app
        self.traffic = traffic
        self._paths = RoutePaths()
        self._failed_once = False

    def _count(self, scope: Scope, answer: dict[str, Any], crashed: bool, started: float) -> None:
        try:
            path = self._paths.of(scope)
            if path is None:
                return
            status = answer.get("status")
            if status is None:
                if not crashed:
                    return  # cancelled before it answered: the backend is stopping
                status = 500  # it crashed before it answered
            ms = answer.get("ms", (time.perf_counter() - started) * 1000)
            self.traffic.record(str(scope.get("method", "GET")), path, status, ms)
        except Exception:
            if not self._failed_once:
                self._failed_once = True
                log.warning("api_traffic_count_failed", exc_info=True)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not str(scope.get("path", "")).startswith(API_PREFIX):
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        answer: dict[str, Any] = {}

        async def send_and_note(message: Message) -> None:
            if message["type"] == "http.response.start" and "status" not in answer:
                answer["status"] = int(message["status"])
                answer["ms"] = (time.perf_counter() - started) * 1000
            await send(message)

        crashed = False
        try:
            await self.app(scope, receive, send_and_note)
        except Exception:
            crashed = True
            raise
        finally:
            self._count(scope, answer, crashed, started)
