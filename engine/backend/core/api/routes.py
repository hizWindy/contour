"""A flat list of every API route of an app, for checks and gates.

Newer FastAPI keeps an included router as one lazy entry in `app.routes`, so a plain loop over
`app.routes` sees no endpoints at all. `api_routes` asks FastAPI for the real routes (with
their full paths) and falls back to the plain loop for a version that copies them.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute

from core.api.stubs import is_stub


@dataclass(frozen=True)
class RouteInfo:
    path: str  # the full path, like /api/v1/runs/{run_id}
    methods: frozenset[str]  # without HEAD
    name: str  # the function name
    unique_id: str  # the operation id
    endpoint: Callable[..., Any]

    @property
    def is_stub(self) -> bool:
        return is_stub(self.endpoint)

    @property
    def labels(self) -> list[str]:
        """One "METHOD path" text for each method."""
        return [f"{method} {self.path}" for method in sorted(self.methods)]


def api_routes(app: FastAPI) -> list[RouteInfo]:
    """Every API route (not docs or static routes) with its full path, in match order."""
    try:
        from fastapi.routing import iter_route_contexts
    except ImportError:  # an older FastAPI copies included routes into app.routes
        return [_info(route) for route in app.routes if isinstance(route, APIRoute)]
    found: list[RouteInfo] = []
    for context in iter_route_contexts(app.routes):
        if isinstance(context.original_route, APIRoute):
            found.append(_info(context))
    return found


def _info(route: Any) -> RouteInfo:
    return RouteInfo(
        path=route.path,
        methods=frozenset(set(route.methods) - {"HEAD"}),
        name=route.name,
        unique_id=route.unique_id,
        endpoint=route.endpoint,
    )


class RoutePaths:
    """The full path of the route a request matched, as written in the code (like
    `/api/v1/runs/{run_id}`), for counting and logging. Never the real path, which can hold a
    company name.

    The matched route is in the request's scope once the router has run. FastAPI keeps an
    included router nested, so the route knows only its own part of the path
    (`/health/details`); its full path comes from `api_routes`, by its endpoint function (the
    same object in both), looked up once. None when no route matched (an unknown path, or a
    request refused before routing).
    """

    def __init__(self) -> None:
        self._paths: dict[object, str] | None = None

    def of(self, scope: Mapping[str, Any]) -> str | None:
        route = scope.get("route")
        path = getattr(route, "path", None)
        if not isinstance(path, str):
            return None
        if self._paths is None:
            app = scope.get("app")
            self._paths = (
                {info.endpoint: info.path for info in api_routes(app)} if app is not None else {}
            )
        return self._paths.get(getattr(route, "endpoint", None), path)
