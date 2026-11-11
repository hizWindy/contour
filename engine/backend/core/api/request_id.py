"""A request id for every request, and one log line when it is answered (PLAN-V15 T1-2).

**The id.** Every request gets a short code, like `7F3K92QD`: 8 characters from an alphabet
with no look-alikes (no 0 and O, no 1, I and L), so a person can read it out on the phone. It
goes back in the `X-Request-ID` header and in every error body (`request_id`), and onto every log
line written while the request runs. So "send this code to an admin" leads straight to the lines.

An id the edge sends (App Platform may add its own `X-Request-ID`) is kept in the request's log
line as `edge_request_id`, when it is safe: up to 64 letters, digits and dashes. It isn't used
as the code, because it can be 36 characters long, too long to read out.

**The log line.** One `request_done` line per request: the method, the route as written in the
code (like `/api/v1/companies/{key}`, never the real path, which can hold a company name), the
status and the ms until the answer started. A stream (the run events) counts until it starts,
like the Health tab's traffic. These lines are what `scripts/log_stats.py` reads for p95.

**Where it sits.** Outside everything, even Starlette's own error layer (`EngineApp` wraps its
whole stack in it), so a 500 still carries the header and its body the id. It never fails a
request: if writing the line goes wrong, the answer is the same.
"""

import logging
import re
import secrets
import time
from contextvars import ContextVar
from typing import Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# This module imports nothing else of the app's at load time: `core.api.errors` imports it, and
# `core.api.routes` imports `errors` (through `stubs`). The route lookup is imported when used.

log = logging.getLogger("core.api.request")

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ID_LENGTH = 8
HEADER = "X-Request-ID"
_SAFE_EDGE_ID = re.compile(r"[A-Za-z0-9-]{1,64}")
NO_ROUTE = "(no route)"

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def new_request_id() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(ID_LENGTH))


def current_request_id() -> str | None:
    """The id of the request being answered now, or None outside a request."""
    return _request_id.get()


_factory_installed = False


def install_log_ids() -> None:
    """Every log record made during a request gets `request_id`, whoever logs it. Done with the
    record factory (not a handler filter), so the tests' own log capture sees it too. Safe to
    call twice."""
    global _factory_installed
    if _factory_installed:
        return
    make = logging.getLogRecordFactory()

    def factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = make(*args, **kwargs)
        request_id = _request_id.get()
        if request_id is not None and not hasattr(record, "request_id"):
            record.request_id = request_id
        return record

    logging.setLogRecordFactory(factory)
    _factory_installed = True


def _edge_id(scope: Scope) -> str | None:
    for name, value in scope.get("headers") or ():
        if name.lower() == b"x-request-id":
            text = value.decode("latin-1")
            return text if _SAFE_EDGE_ID.fullmatch(text) else None
    return None


class RequestIdMiddleware:
    """Pure ASGI, so a stream passes through untouched."""

    def __init__(self, app: ASGIApp) -> None:
        from core.api.routes import RoutePaths

        self.app = app
        self._paths = RoutePaths()
        self._failed_once = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = new_request_id()
        token = _request_id.set(request_id)
        started = time.perf_counter()
        answer: dict[str, Any] = {}

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start" and "status" not in answer:
                answer["status"] = int(message["status"])
                answer["ms"] = (time.perf_counter() - started) * 1000
                MutableHeaders(scope=message).append(HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            self._log(scope, answer, started)
            _request_id.reset(token)

    def _log(self, scope: Scope, answer: dict[str, Any], started: float) -> None:
        try:
            status = answer.get("status")
            ms = answer.get("ms", (time.perf_counter() - started) * 1000)
            extra: dict[str, Any] = {
                "method": str(scope.get("method", "GET")),
                "route": self._paths.of(scope) or NO_ROUTE,
                # None: no answer was started (the backend stopping, or a crash with no 500)
                "status": status,
                "ms": round(ms, 1),
            }
            edge = _edge_id(scope)
            if edge is not None:
                extra["edge_request_id"] = edge
            log.info("request_done", extra=extra)
        except Exception:
            if not self._failed_once:
                self._failed_once = True
                log.warning("request_log_failed", exc_info=True)
