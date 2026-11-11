"""The guard: where sign-in is required, a request needs a session before anything else runs.
PLAN-V6 B4, security rule 5.

It is plain ASGI middleware, like the host check and the origin guard in `security.py`, so it
answers from the headers alone:

- **No body is read** for a request that is refused. An anonymous 1 GB upload to the HubSpot import
  route is turned away at its headers, not saved to disk first.
- **Nothing is learned.** A path that doesn't exist answers 401 too, like one that does, so a
  person without a session can't map the routes. A route with a bad body and no session gets 401,
  not the 422 that would say what the body should hold.
- **Deny by default.** Only what `PUBLIC` lists (and the Swagger pages, which hold no data and
  only exist where the app has them) is open. A route a project adds later is covered with no
  change here. The sign-in settings can't be reached from a request, so there is nothing to talk
  it into leaving a route open.

The live run events (SSE) are checked as the stream opens, like any other request: the browser
sends the cookie with it. A stream that is already open when its session ends keeps going until it
closes (TBC: a check on the stream itself).

Where sign-in is off (`AUTH_REQUIRED=false`, the laptop's default) the guard does nothing.

The check leaves its answer in `request.state.auth` (`core.api.signin` reads it there), so a
request looks its session up once.
"""

from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from core.api.errors import problem
from core.api.signin import auth_settings_dependency, sign_in_needed
from core.auth import cookies, sessions
from core.auth.clock import utcnow
from core.auth.sessions import AuthContext, Gone, Limits
from core.config import Settings
from core.db.engine import get_sessionmaker

API_PREFIX = "/api/v1"
# The only operations that need no session: the health check (the container's own check calls it)
# and the sign-in itself.
PUBLIC = frozenset(
    {
        ("GET", f"{API_PREFIX}/health"),
        ("HEAD", f"{API_PREFIX}/health"),
        ("POST", f"{API_PREFIX}/auth/login"),
    }
)
DATABASE_DOWN = (
    "Contour can't reach its database",
    "Try again in a minute. If it keeps happening, tell an admin.",
)


def sign_in_settings(app: FastAPI) -> Settings:
    """The sign-in settings, the way a route gets them (so a test sets them in one place)."""
    provider = app.dependency_overrides.get(auth_settings_dependency, auth_settings_dependency)
    settings: Settings = provider()
    return settings


def _docs_paths(app: FastAPI) -> frozenset[str]:
    """The Swagger pages, if this app has them. They hold no data."""
    found = (app.docs_url, app.redoc_url, app.openapi_url, app.swagger_ui_oauth2_redirect_url)
    return frozenset(path for path in found if path)


def is_public(scope: Scope, app: FastAPI) -> bool:
    method, path = scope.get("method", "GET"), scope["path"]
    return (method, path) in PUBLIC or (method == "GET" and path in _docs_paths(app))


class SessionGuard:
    """Refuses a request that has no session, where sign-in is required."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        app: FastAPI = scope["app"]
        settings = sign_in_settings(app)
        if not settings.auth_required or is_public(scope, app):
            await self.app(scope, receive, send)
            return

        token = cookies.read_token(
            Headers(scope=scope).get("cookie"), secure=settings.session_cookie_secure
        )
        gone: Gone | None = None
        if token:
            try:
                found = await self._look_up(app, settings, token)
            except (SQLAlchemyError, OSError, TimeoutError):
                await self._refuse(scope, receive, send, 503, *DATABASE_DOWN)
                return
            if isinstance(found, AuthContext):
                scope.setdefault("state", {})["auth"] = found
                await self.app(scope, receive, send)
                return
            gone = found
        refusal = sign_in_needed(gone, settings)
        await self._refuse(
            scope,
            receive,
            send,
            refusal.status,
            refusal.title,
            refusal.detail,
            code=refusal.code,
            headers=refusal.headers,
            **refusal.extra,
        )

    @staticmethod
    async def _look_up(app: FastAPI, settings: Settings, token: str) -> AuthContext | Gone:
        clock = getattr(app.state, "clock", None) or utcnow
        factory = getattr(app.state, "session_factory", None) or get_sessionmaker()
        async with factory() as db:
            found = await sessions.resolve(
                db, token, now=clock(), limits=Limits.from_settings(settings)
            )
            await db.commit()  # keeps "last seen"
        return found

    @staticmethod
    async def _refuse(
        scope: Scope,
        receive: Receive,
        send: Send,
        status: int,
        title: str,
        detail: str | None,
        *,
        code: str | None = None,
        headers: Mapping[str, str] | None = None,
        **extra: Any,
    ) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})  # refused before it opens
            return
        response = problem(status, title, detail, headers=headers, code=code, **extra)
        await response(scope, receive, send)  # it only sends: the request's body is never read


def document_sign_in(schema: dict[str, Any]) -> None:
    """Marks, in the OpenAPI file, which operations need the session cookie, and drops the 401 the
    router gave the ones that don't (the health check never answers one)."""
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["sessionCookie"] = {
        "type": "apiKey",
        "in": "cookie",
        "name": "contour_session",
        "description": (
            "The session cookie that `POST /auth/login` sets. The browser sends it by itself. "
            "Over HTTPS its name is `__Host-contour_session`."
        ),
    }
    for path, item in schema.get("paths", {}).items():
        for method, operation in item.items():
            if not isinstance(operation, dict):
                continue
            if (method.upper(), path) in PUBLIC:
                if path.endswith("/health"):
                    operation.get("responses", {}).pop("401", None)
                continue
            operation["security"] = [{"sessionCookie": []}]
