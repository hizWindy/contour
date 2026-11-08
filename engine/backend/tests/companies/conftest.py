"""Fixtures for the Companies tests."""

from typing import Any

import pytest

from tests.core.auth_world import World, build_world


@pytest.fixture
def world(session_factory: Any) -> World:
    return build_world(session_factory)
