"""The FastAPI app. Swagger is at /docs. All endpoints sit under /api/v1."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute

from core.api import auth as auth_routes
from core.api import health, hubspot, memory, runs, runs_read, searches
from core.api import settings as settings_routes
from core.api.errors import PROBLEM_RESPONSES, add_error_handlers
from core.api.guard import SessionGuard, document_sign_in
from core.api.routes import api_routes
from core.api.security import ProblemCORSMiddleware, add_security_layers
from core.apps import load_apps
from core.config import get_settings
from core.db.engine import get_engine
from core.hubspot import connection as hubspot_connection
from core.logs import setup_logging
from core.runs import lifecycle
from core.runtime import disable_tracing
from core.schedules import runtime as schedules

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start the run engine, and on the way out stop it and close the database pool.

    `lifecycle.shutdown` is safe to call when `startup` failed part way.
    """
    try:
        await lifecycle.startup(app)
        await hubspot_connection.start_up(app)  # a background sync if the last is old; never fails
        await schedules.start_up(app)  # only where this backend holds the run engine's lock
        yield
    finally:
        try:
            await schedules.shut_down(app)
            await hubspot_connection.shut_down(app)
            await lifecycle.shutdown(app)
        finally:
            await get_engine().dispose()


def operation_id(route: APIRoute) -> str:
    """A stable operationId for the website's generated types: the name of the function.

    Two routes can't share a function name across all routers, and `create_app` checks that.
    """
    return route.name


def document_problems(schema: dict[str, Any]) -> None:
    """Gives every 4xx and 5xx response in the OpenAPI file the ProblemDetails body.

    The routers ask for this with `responses=PROBLEM_RESPONSES`. A route that lists its own
    error without a body (like the health check's 503) would otherwise be left out.
    """
    body = {"application/json": {"schema": {"$ref": "#/components/schemas/ProblemDetails"}}}
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if not isinstance(operation, dict):
                continue
            for code, response in operation.get("responses", {}).items():
                if code[:1] in ("4", "5") and "content" not in response:
                    response["content"] = body


class EngineApp(FastAPI):
    def openapi(self) -> dict[str, Any]:
        built_before = self.openapi_schema is not None
        schema = super().openapi()
        if not built_before:
            document_problems(schema)
            document_sign_in(schema)
        return schema


def _check_operation_ids(app: FastAPI) -> None:
    seen: set[str] = set()
    for route in api_routes(app):
        if route.unique_id in seen:
            raise RuntimeError(
                f"Two routes share the operation id {route.unique_id!r}. "
                "Rename one of the functions."
            )
        seen.add(route.unique_id)


def create_app() -> FastAPI:
    disable_tracing()  # first: prompts and answers must never reach LangSmith
    setup_logging()
    settings = get_settings()
    specs = load_apps(settings.apps)
    for spec in specs:
        spec.check_rules()  # the backend won't start if a rules file is wrong

    # On a server the Swagger pages are not served: they would show the whole API to anyone who
    # asks. `engine openapi` still writes the contract file for the website.
    pages = not settings.server_mode
    app = EngineApp(
        title="Contour engine",
        version="0.1.0",
        summary="The research engine for the Lead Finder. All endpoints sit under /api/v1.",
        lifespan=lifespan,
        generate_unique_id_function=operation_id,
        docs_url="/docs" if pages else None,
        redoc_url="/redoc" if pages else None,
        openapi_url="/openapi.json" if pages else None,
    )
    app.state.apps = specs
    # The guard is added first, so it is inside the CORS layer (a 401 still carries its headers)
    # and inside the origin guard and the host check, which refuse before it looks at a cookie.
    app.add_middleware(SessionGuard)
    app.add_middleware(
        ProblemCORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    add_security_layers(app, settings)  # after CORS, so the host check and origin guard are outside
    add_error_handlers(app)

    api = APIRouter(prefix=API_PREFIX, responses=PROBLEM_RESPONSES)
    api.include_router(health.router)
    api.include_router(auth_routes.router)
    api.include_router(memory.router)
    api.include_router(hubspot.router)
    api.include_router(searches.router)
    api.include_router(runs_read.router)  # before runs: the estimate and summary paths come first
    api.include_router(runs.router)
    api.include_router(settings_routes.router)
    for spec in specs:
        api.include_router(spec.router, prefix=spec.route_prefix, tags=[spec.title])
    app.include_router(api)
    _check_operation_ids(app)
    return app
