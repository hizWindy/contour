"""The FastAPI app. Swagger is at /docs. All endpoints sit under /api/v1."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.api import health, hubspot, memory
from core.api.errors import add_error_handlers
from core.apps import load_apps
from core.config import get_settings
from core.db.engine import get_engine
from core.logs import setup_logging

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await get_engine().dispose()


def create_app() -> FastAPI:
    setup_logging()
    settings = get_settings()
    specs = load_apps(settings.apps)
    for spec in specs:
        spec.check_rules()  # the backend won't start if a rules file is wrong

    app = FastAPI(
        title="Contour engine",
        version="0.1.0",
        summary="The research engine for the Lead Finder. All endpoints sit under /api/v1.",
        lifespan=lifespan,
    )
    app.state.apps = specs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    add_error_handlers(app)

    api = APIRouter(prefix=API_PREFIX)
    api.include_router(health.router)
    api.include_router(memory.router)
    api.include_router(hubspot.router)
    for spec in specs:
        api.include_router(spec.router, prefix=spec.route_prefix, tags=[spec.title])
    app.include_router(api)
    return app
