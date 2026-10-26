"""Security of the HTTP layer. The engine is a local tool, so it protects itself from web pages.

Three layers, added by `add_security_layers`:
- **Host check:** only `localhost` and `127.0.0.1` are accepted as the host name. This stops
  DNS rebinding (a web page that points its own name at this computer).
- **Origin guard:** a browser adds an `Origin` header to every cross-site POST, PUT, PATCH and
  DELETE. If it is there and it isn't one of ours (or it is `null`), the request is refused
  before its body is read. This stops a web page from using the engine through the person's
  browser, even with forms that skip CORS checks. No `Origin` means curl, the command line or
  a test, which is allowed.
- **Security headers** on every response, including errors.

They are plain ASGI middleware (not BaseHTTPMiddleware), so streaming responses like the live
run feed are not buffered.
"""

from fastapi import FastAPI
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from core.api.errors import problem
from core.config import Settings

TRUSTED_HOSTS = ["localhost", "127.0.0.1"]
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


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
    # Added first, so it sits inside the host check: a bad host is refused before anything.
    app.add_middleware(OriginGuard, allowed=allowed_origins(settings))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS, www_redirect=False)

    # An error that nothing handled is answered by Starlette's outermost layer, which sits
    # outside every middleware added above. To put the headers on that answer too, wrap the
    # finished stack.
    build_stack = app.build_middleware_stack

    def build_with_headers() -> ASGIApp:
        return SecurityHeaders(build_stack())

    app.build_middleware_stack = build_with_headers  # type: ignore[method-assign]
