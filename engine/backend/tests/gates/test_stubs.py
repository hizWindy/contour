"""Gate: no route is left as a stub. It fails, listing them, until the last one is built."""

import pytest

from core.api.app import create_app
from core.api.routes import api_routes

pytestmark = pytest.mark.stubs


def test_no_route_still_answers_501_not_built_yet() -> None:
    routes = api_routes(create_app())
    assert len(routes) > 30  # the list is not empty by mistake
    left = sorted(label for route in routes if route.is_stub for label in route.labels)
    assert not left, f"{len(left)} routes are still stubs:\n" + "\n".join(left)
