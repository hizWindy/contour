"""Security of the HTTP layer. The engine is a local tool, so it protects itself from web pages.

Three layers, added by `add_security_layers`:
- **Host check:** only `localhost` and `127.0.0.1` are accepted as the host name. This stops
  DNS rebinding (a web page that points its own name at this computer). It is the outermost
  layer, so it answers first, even before the CORS layer answers a preflight, and its refusal
  is the same `application/problem+json` as every other error (code `host_not_allowed`).
- **Origin guard:** a browser adds an `Origin` header to every cross-site POST, PUT, PATCH and
  DELETE. If it is there and it isn't one of ours (or it is `null`), the request is refused
  before its body is read. This stops a web page from using the engine through the person's
  browser, even with forms that skip CORS checks. No `Origin` means curl, the command line or
  a test, which is allowed.
- **Security headers** on every response, including errors.

They are plain ASGI middleware (not BaseHTTPMiddleware), so streaming responses like the live
run feed are not buffered.

`ProblemCORSMiddleware` is the CORS layer, which `create_app` registers itself. A browser asks
permission before a cross-site call (a preflight). Starlette refuses a foreign origin in plain
text. This class refuses in the same `application/problem+json` as every other error.
"""

import re

from fastapi import FastAPI
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from core.api.errors import problem
from core.config import API_HOSTS, Settings

# The same two names `api_host` may be (one list, in core.config), so a host the settings accept
# is a host the check accepts.
TRUSTED_HOSTS = list(API_HOSTS)
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


# A Host header is a name (or an IPv6 address in brackets), then maybe a port. Anything else
# (a space, a second value, a path) is not a host name at all.
_HOST_HEADER = re.compile(r"(?P<name>[a-z0-9.\-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?")


def allowed_origins(settings: Settings) -> frozenset[str]:
    """The website's origins from settings, plus the API's own (Swagger runs there)."""
    own = {f"http://127.0.0.1:{settings.api_port}", f"http://localhost:{settings.api_port}"}
    return frozenset({origin.lower() for origin in settings.cors_origins} | own)


class OriginGuard:
    """Refuses a POST, PUT, PATCH or DELETE from an origin that isn't ours."""

    def __init__(self, app: ASGIApp, allowed: frozenset[str]) -> None:
        self.app = app
        self.allowed = allowed

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS:
            origins = Headers(scope=scope).getlist("origin")
            # The answer comes from the headers alone, so the body is never read.
            # "null" (a sandboxed page, or a redirect from another site) is never allowed.
            if origins and (len(origins) > 1 or origins[0].strip().lower() not in self.allowed):
                response = problem(
                    403,
                    "Request blocked",
                    "This request came from a web page the engine doesn't trust.",
                    code="origin_not_allowed",
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


class ProblemCORSMiddleware(CORSMiddleware):
    """Starlette's CORS check, with the engine's own error answer for a refused preflight.

    Starlette answers a preflight it refuses with plain text ("Disallowed CORS origin"). This
    one answers `application/problem+json` with status 400 and code `origin_not_allowed` when
    the origin is the problem (or `cors_not_allowed` when only the method or the headers are).
    It never repeats the origin it refused. An answer to an allowed preflight is unchanged, and
    the headers Starlette sets (`Vary`, and the rest) are kept on the refusal.
    """

    def preflight_response(self, request_headers: Headers) -> Response:
        response = super().preflight_response(request_headers)
        if response.status_code < 400:
            return response
        if self.is_allowed_origin(origin=request_headers["origin"]):
            refused = problem(
                400,
                "Request blocked",
                "This web page may not make this kind of request to the engine.",
                code="cors_not_allowed",
            )
        else:
            refused = problem(
                400,
                "Request blocked",
                "This request came from a web page the engine doesn't trust.",
                code="origin_not_allowed",
            )
        for name, value in response.headers.items():
            if name.lower() not in ("content-type", "content-length"):
                refused.headers[name] = value
        return refused


class HostGuard(TrustedHostMiddleware):
    """Starlette's trusted-host check, with the engine's own error answer.

    Starlette answers a bad host with plain text. This one answers `application/problem+json`
    with code `host_not_allowed`, like every other error. It never redirects (a redirect
    to another host name is of no use to a local tool), and it never repeats the host it
    refused.
    """

    def _host_is_allowed(self, headers: Headers) -> bool:
        values = headers.getlist("host")
        if len(values) != 1:  # none, or two (a second one can hide behind the first)
            return False
        found = _HOST_HEADER.fullmatch(values[0].strip().lower())
        if found is None:
            return False
        name = found.group("name")
        return any(
            name == pattern or (pattern.startswith("*") and name.endswith(pattern[1:]))
            for pattern in self.allowed_hosts
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.allow_any or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        if self._host_is_allowed(Headers(scope=scope)):
            await self.app(scope, receive, send)
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})  # refused before it opens
        else:
            response = problem(
                400,
                "Request blocked",
                "The engine only answers to localhost or 127.0.0.1.",
                code="host_not_allowed",
            )
            await response(scope, receive, send)


class SecurityHeaders:
    """Sets the security headers on every response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)


def add_security_layers(app: FastAPI, settings: Settings) -> None:
    """Adds the host check, the origin guard and the security headers to the app."""
    if getattr(app.state, "security_layers", False):
        return
    app.state.security_layers = True
    app.add_middleware(OriginGuard, allowed=allowed_origins(settings))

    # The host check and the headers wrap the finished stack, not the middleware list. Then
    # the host check is the outermost layer however the other layers were added (a CORS layer
    # added later would otherwise answer a preflight before it), and the headers reach even
    # the answer to an error that nothing handled, which Starlette gives from outside every
    # middleware.
    build_stack = app.build_middleware_stack

    def build_with_layers() -> ASGIApp:
        return SecurityHeaders(HostGuard(build_stack(), allowed_hosts=TRUSTED_HOSTS))

    app.build_middleware_stack = build_with_layers  # type: ignore[method-assign]
