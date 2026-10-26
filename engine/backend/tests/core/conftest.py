"""Fixtures for testing the run engine (`core.runs`) against the real test database.

- `fakes`: a `FakeState` (small settings, and a record of what the fake handlers did).
- `run_kinds`: the registry of tiny fake run kinds (see `tests/core/runs_fakes.py`).
- `make_manager(kinds=None, *, settings=None, **overrides)`: makes a `RunManager` on the test
  database. Anything the manager is built from can be replaced by name (`checkpointer_source`,
  `claude_provider`, `settings_provider`, `acquire_lock`, `release_lock`, `progress_interval`,
  `session_factory`, `embedder`). By default: an in-memory checkpoint source, a Claude provider that
  fails the test if it is asked, a settings provider that returns `fakes.settings` (so a test can
  change the settings between calls), and a fast progress tick. Every manager made is shut down at
  the end of the test, so no run outlives it. Call it twice for two managers on one database (a
  restart).
- `run_manager`: one manager made with `make_manager`.

These fixtures use the database, so a test that asks for them is marked `integration`.
"""

from collections.abc import AsyncIterator, Callable
from typing import Any, NoReturn, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.claude.client import Claude
from core.config import Settings
from core.memory.embedder import Embedder
from core.runs.manager import RunManager
from core.runs.types import KindKey, RunKind
from tests.core.runs_fakes import FakeState, fake_kinds, small_settings

type MakeManager = Callable[..., RunManager]


class NoClaude:
    """The fake handlers never call Claude. If something does, the test fails at once."""

    async def ask(self, **kwargs: Any) -> NoReturn:
        raise AssertionError("This test called Claude. The run engine tests must not.")


class MemorySource:
    """A `CheckpointerSource` on LangGraph's in-memory saver (no database, no pool)."""

    def __init__(self) -> None:
        from core.runtime import disable_tracing

        disable_tracing()  # before LangGraph is imported
        from langgraph.checkpoint.memory import InMemorySaver

        self.saver = InMemorySaver()
        self.gets = 0
        self.closed = False

    async def get(self) -> Any:
        self.gets += 1
        return self.saver

    async def close(self, seconds: float = 5) -> None:
        self.closed = True


@pytest.fixture
def fakes() -> FakeState:
    return FakeState(settings=small_settings())


@pytest.fixture
def run_kinds(fakes: FakeState) -> dict[KindKey, RunKind[Any]]:
    return fake_kinds(fakes)


@pytest.fixture
async def make_manager(
    session_factory: async_sessionmaker[AsyncSession],
    embedder: Embedder,
    fakes: FakeState,
    run_kinds: dict[KindKey, RunKind[Any]],
) -> AsyncIterator[MakeManager]:
    made: list[RunManager] = []

    async def settings_provider() -> Settings:
        return fakes.settings

    def make(
        kinds: dict[KindKey, RunKind[Any]] | None = None,
        *,
        settings: Settings | None = None,
        **overrides: Any,
    ) -> RunManager:
        parts: dict[str, Any] = {
            "session_factory": session_factory,
            "embedder": embedder,
            "claude_provider": lambda: cast(Claude, NoClaude()),
            "checkpointer_source": MemorySource(),
            "settings_provider": settings_provider,
            "kinds": run_kinds if kinds is None else kinds,
            "progress_interval": 0.05,
        }
        if settings is not None:
            fakes.settings = settings
        parts.update(overrides)
        manager = RunManager(**parts)
        made.append(manager)
        return manager

    try:
        yield make
    finally:
        for manager in reversed(made):
            await manager.shutdown()  # stops anything still going, and lets the lock go


@pytest.fixture
async def run_manager(make_manager: MakeManager) -> RunManager:
    return make_manager()
