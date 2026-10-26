"""The guard: a test that needs the database or the memory model must say so.

Without it, one forgotten marker would make the fast suite slow, or need Docker.
The guard has two parts: it checks the fixtures a test asks for, and it refuses every database
connection that an unmarked test starts by another road (an app route, an engine, Alembic).
"""

from types import SimpleNamespace
from typing import cast

import psycopg
import pytest
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine

from core.config import get_settings
from tests.conftest import (
    INTEGRATION_FIXTURES,
    NOT_INTEGRATION,
    REAL_CONNECTIONS,
    check_integration_marker,
    put_back_the_real_connections,
)

pytest_plugins = ["pytester"]

NO_CONNECTION = f"{NOT_INTEGRATION}: it opens a database connection"
NOWHERE = "host=127.0.0.1 port=1 dbname=nothing connect_timeout=1"  # never reached


def fake_item(*fixtures: str, integration: bool = False) -> pytest.Item:
    marker = object() if integration else None
    return cast(
        pytest.Item,
        SimpleNamespace(
            get_closest_marker=lambda name: marker if name == "integration" else None,
            fixturenames=["request", *fixtures],
        ),
    )


def run_inner(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch, source: str
) -> pytest.RunResult:
    """Runs `source` as a test file in a pytest of its own, with the guard switched on."""
    put_back_the_real_connections(monkeypatch)  # the inner run sets its own
    pytester.makeini(
        "[pytest]\nasyncio_mode = auto\nasyncio_default_fixture_loop_scope = function\n"
        "markers =\n    integration: needs the database\n"
    )
    pytester.makeconftest('pytest_plugins = ["tests.conftest"]\n')
    pytester.makepyfile(source)
    return pytester.runpytest_inprocess("-p", "no:cacheprovider")


# --- The fixture check ------------------------------------------------------------------------


@pytest.mark.parametrize("fixture", sorted(INTEGRATION_FIXTURES))
def test_a_database_fixture_without_the_marker_fails(fixture: str) -> None:
    with pytest.raises(pytest.fail.Exception, match=NOT_INTEGRATION):
        check_integration_marker(fake_item("app", fixture))


@pytest.mark.parametrize("fixture", sorted(INTEGRATION_FIXTURES))
def test_a_marked_test_may_use_the_database(fixture: str) -> None:
    check_integration_marker(fake_item(fixture, integration=True))


def test_a_test_with_no_database_fixture_needs_no_marker() -> None:
    check_integration_marker(fake_item("app", "tmp_path", "live_server"))


def test_the_guard_works_in_a_real_pytest_run(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = run_inner(
        pytester,
        monkeypatch,
        """
        from pathlib import Path

        import pytest

        from core.memory.embedder import Embedder


        def test_plain_test_is_left_alone():
            pass


        def test_database_without_marker(session):
            raise AssertionError("must not run")


        def test_embedder_fixture_without_marker(embedder):
            raise AssertionError("must not run")


        def test_loading_the_embedder_without_marker():
            Embedder("any-model", Path(".")).passages(["hello"])


        @pytest.mark.integration
        def test_marker_lifts_the_embedder_guard():
            assert Embedder._load.__name__ == "_load"  # not the refusal. Nothing is loaded.
        """,
    )
    result.assert_outcomes(passed=2, failed=1, errors=2)
    result.stdout.fnmatch_lines(["*mark this test integration: it uses *session*"])
    result.stdout.fnmatch_lines(["*mark this test integration: it uses embedder*"])
    result.stdout.fnmatch_lines(["*mark this test integration: it loads the embedder*"])


def test_a_fake_that_a_test_file_defines_itself_is_not_the_database(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = run_inner(
        pytester,
        monkeypatch,
        """
        import pytest


        class FakeSession:
            pass


        @pytest.fixture
        def session():
            return FakeSession()


        @pytest.fixture
        def engine():
            return "not an engine"


        @pytest.fixture
        def checkpointer(embedder):  # the fake itself asks for the real memory model
            return "not a saver"


        def test_a_fake_session_and_engine_need_no_marker(session, engine):
            assert isinstance(session, FakeSession)
            assert engine == "not an engine"


        def test_a_fake_that_uses_a_real_fixture_still_needs_the_marker(checkpointer):
            raise AssertionError("must not run")
        """,
    )
    result.assert_outcomes(passed=1, errors=1)
    result.stdout.fnmatch_lines(["*mark this test integration: it uses embedder*"])
    result.stdout.no_fnmatch_line("*it uses *session*")
    result.stdout.no_fnmatch_line("*it uses *engine*")


# --- The connection check ---------------------------------------------------------------------


def test_the_real_connect_functions_are_what_the_guard_replaces() -> None:
    names = {
        f"{getattr(target, '__name__', target)}.{name}" for target, name, _ in REAL_CONNECTIONS
    }
    assert names == {"psycopg.connect", "Connection.connect", "AsyncConnection.connect"}
    for target, name, _ in REAL_CONNECTIONS:
        assert getattr(target, name).__name__ == "_refuse_to_connect"  # in force, in this test


@pytest.mark.parametrize("connect", ["connect", "Connection.connect"])
def test_a_fast_test_cannot_open_a_sync_psycopg_connection(connect: str) -> None:
    function = psycopg.connect if connect == "connect" else psycopg.Connection.connect
    with pytest.raises(pytest.fail.Exception, match=NO_CONNECTION):
        function(NOWHERE)


async def test_a_fast_test_cannot_open_an_async_psycopg_connection() -> None:
    with pytest.raises(pytest.fail.Exception, match=NO_CONNECTION):
        await psycopg.AsyncConnection.connect(NOWHERE)


async def test_a_fast_test_cannot_connect_through_an_async_engine() -> None:
    engine = create_async_engine(get_settings().database_url())
    try:
        with pytest.raises(pytest.fail.Exception, match=NO_CONNECTION):
            async with engine.connect():
                pass
    finally:
        await engine.dispose()


def test_a_fast_test_cannot_connect_through_a_sync_engine() -> None:
    """The road Alembic takes."""
    engine = create_engine(get_settings().database_url())
    try:
        with pytest.raises(pytest.fail.Exception, match=NO_CONNECTION), engine.connect():
            pass
    finally:
        engine.dispose()


def test_a_fast_test_cannot_reach_the_database_through_the_app(
    pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The gap this closes: no database fixture, yet the app's own engine reaches the database."""
    result = run_inner(
        pytester,
        monkeypatch,
        """
        import httpx
        import psycopg
        import pytest

        from core.api.app import create_app
        from tests.conftest import REAL_CONNECTIONS


        async def get(path):
            transport = httpx.ASGITransport(app=create_app())
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.get(path)


        async def test_health_without_marker():
            await get("/api/v1/health")  # the route catches Exception. The refusal is not one.


        async def test_a_list_route_without_marker():
            await get("/api/v1/searches")


        async def test_a_route_that_needs_no_database_is_left_alone():
            assert (await get("/api/v1/lead-finder/rules")).status_code == 200


        @pytest.mark.integration
        def test_marker_lifts_the_connection_guard():
            for target, name, _ in REAL_CONNECTIONS:
                assert getattr(target, name).__name__ == "connect"  # not the refusal
        """,
    )
    result.assert_outcomes(passed=2, failed=2)
    result.stdout.fnmatch_lines(["*mark this test integration: it opens a database connection*"])
