"""The API's traffic over the last hour, counted in memory (PLAN-V13 T1-2).

For each endpoint (its method and its path as written in the code, like
`GET /api/v1/runs/{run_id}`), the requests, the errors and the slowest time. No database: the
counts live in this process and start again when the backend restarts.

**What is counted.** Requests under `/api/` that reached an endpoint. A request no route matched
(a 404 for an unknown path) or one refused before routing (no session, a bad host) has no endpoint,
so it isn't counted. `errors` are answers of 500 and above; `refused` are 400 to 499 (a person
without the right, a form that isn't valid), which are not faults of the system.

**The time** is how long the backend took to start its answer. A stream (the run events) would
otherwise count as slow for as long as someone watched it.

**Memory stays small:** one bucket a minute for each endpoint, and buckets older than an hour are
dropped. The endpoints are the code's own, so their number is fixed.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

WINDOW_MINUTES = 60
API_PREFIX = "/api/"
MAX_ENDPOINTS = 500  # a guard: the code has far fewer


@dataclass
class _Bucket:
    minute: int
    requests: int = 0
    errors: int = 0
    refused: int = 0
    total_ms: float = 0.0
    slowest_ms: float = 0.0


@dataclass(frozen=True)
class EndpointTraffic:
    method: str
    path: str
    requests: int
    errors: int
    refused: int
    average_ms: int
    slowest_ms: int


@dataclass(frozen=True)
class Traffic:
    """The last hour, or less when the backend started less than an hour ago."""

    since: float  # a time.time() moment
    taken: float  # when this snapshot was taken, the same way
    requests: int
    errors: int
    endpoints: list[EndpointTraffic] = field(default_factory=list)


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
        minute = int(self._clock() // 60)
        buckets = self._buckets.setdefault(key, [])
        if not buckets or buckets[-1].minute != minute:
            buckets.append(_Bucket(minute))
            self._drop_old(buckets, minute)
        bucket = buckets[-1]
        bucket.requests += 1
        bucket.errors += status >= 500
        bucket.refused += 400 <= status < 500
        bucket.total_ms += ms
        bucket.slowest_ms = max(bucket.slowest_ms, ms)

    @staticmethod
    def _drop_old(buckets: list[_Bucket], minute: int) -> None:
        oldest = minute - WINDOW_MINUTES + 1
        while buckets and buckets[0].minute < oldest:
            buckets.pop(0)

    def snapshot(self) -> Traffic:
        """The last hour: each endpoint with requests, errors first, then the slowest."""
        now = self._clock()
        minute = int(now // 60)
        endpoints: list[EndpointTraffic] = []
        for (method, path), buckets in self._buckets.items():
            self._drop_old(buckets, minute)
            requests = sum(bucket.requests for bucket in buckets)
            if requests == 0:
                continue
            total = sum(bucket.total_ms for bucket in buckets)
            endpoints.append(
                EndpointTraffic(
                    method=method,
                    path=path,
                    requests=requests,
                    errors=sum(bucket.errors for bucket in buckets),
                    refused=sum(bucket.refused for bucket in buckets),
                    average_ms=round(total / requests),
                    slowest_ms=round(max(bucket.slowest_ms for bucket in buckets)),
                )
            )
        endpoints.sort(key=lambda item: (-item.errors, -item.slowest_ms, item.path, item.method))
        window_start = (minute - WINDOW_MINUTES + 1) * 60
        return Traffic(
            since=max(self._started, window_start),
            taken=now,
            requests=sum(item.requests for item in endpoints),
            errors=sum(item.errors for item in endpoints),
            endpoints=endpoints,
        )


class TrafficMiddleware:
    """Counts each API request into `traffic` once its answer has started (pure ASGI, so a
    stream passes through untouched).

    The matched route is in the scope, but FastAPI keeps an included router nested, so the route
    knows only its own part of the path (`/health/details`). Its full path comes from
    `api_routes`, by its endpoint function (the same object in both), looked up once.
    """

    def __init__(self, app: ASGIApp, traffic: ApiTraffic) -> None:
        self.app = app
        self.traffic = traffic
        self._paths: dict[object, str] | None = None

    def _full_path(self, scope: Scope, route: object) -> str | None:
        path = getattr(route, "path", None)
        if not isinstance(path, str):
            return None
        if self._paths is None:
            from core.api.routes import api_routes

            app = scope.get("app")
            self._paths = {info.endpoint: info.path for info in api_routes(app)} if app else {}
        return self._paths.get(getattr(route, "endpoint", None), path)

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

        try:
            await self.app(scope, receive, send_and_note)
        finally:
            path = self._full_path(scope, scope.get("route"))
            if path is not None:
                status = answer.get("status", 500)  # no answer started: the app crashed
                ms = answer.get("ms", (time.perf_counter() - started) * 1000)
                self.traffic.record(str(scope.get("method", "GET")), path, status, ms)
