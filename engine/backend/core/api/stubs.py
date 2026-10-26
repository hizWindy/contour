"""Marks a route as declared but not built yet.

The route keeps its final path, parameters and response model, so the website and Swagger can
use the contract today. The body never runs: the route answers 501 `not_implemented`. A package
that builds the route removes `@stub`. The stub gate test (`tests/gates/test_stubs.py`) lists
every route that still has the mark, and fails until none is left.

Put `@stub` under the route decorator:

    @router.get("/things", response_model=ThingPage)
    @stub
    async def list_things() -> ThingPage:
        raise NotImplementedError
"""

import functools
from collections.abc import Awaitable, Callable
from typing import Any, NoReturn, cast

from core.api.errors import Problem


def stub[F: Callable[..., Awaitable[Any]]](endpoint: F) -> F:
    """Makes the route answer a 501 problem, and sets `endpoint.__stub__ = True`."""

    @functools.wraps(endpoint)  # FastAPI reads the parameters of the original function
    async def not_built(*args: Any, **kwargs: Any) -> NoReturn:
        raise Problem(
            501,
            "Not built yet",
            "This endpoint is part of the plan, but it isn't built yet.",
            code="not_implemented",
        )

    not_built.__stub__ = True  # type: ignore[attr-defined]
    return cast(F, not_built)


def is_stub(endpoint: Callable[..., Any]) -> bool:
    return bool(getattr(endpoint, "__stub__", False))
