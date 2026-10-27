"""Fixtures for Lead Finder runs on the test database, with a FakeClaude.

- `make_lf_manager(claude, *, settings=None, source=None)`: a `RunManager` with the Lead Finder's
  run kinds, the given FakeClaude, the real memory model and an in-memory checkpoint store (or the
  `source` given, to share one store between two managers, as after a restart). Settings default to
  `lf_settings()`: no .env, the design's defaults. Every manager is shut down after the test.
- `run_day`: pins the day a run starts on, so the sample dates stay inside the last 30 days.

These use the database, so a test that asks for them is marked `integration`.
"""

from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.runs import RUN_KINDS
from apps.lead_finder.steps import graph
from core.config import Settings
from core.memory.embedder import Embedder
from core.runs.manager import RunManager
from tests.core.conftest import MemorySource
from tests.lead_finder.samples import FakeClaude

APP = "lead_finder"
RUN_DAY = "2026-10-26"

type MakeLeadFinderManager = Callable[..., RunManager]


def lf_settings(**values: Any) -> Settings:
    """The design's defaults, with no .env file (so a developer's own values never leak in)."""
    return Settings(_env_file=None, **values)


@pytest.fixture
def run_day(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(graph, "run_day", lambda: RUN_DAY)
    return RUN_DAY


@pytest.fixture
async def make_lf_manager(
    session_factory: async_sessionmaker[AsyncSession], embedder: Embedder, run_day: str
) -> AsyncIterator[MakeLeadFinderManager]:
    made: list[RunManager] = []

    def make(
        claude: FakeClaude,
        *,
        settings: Settings | None = None,
        source: MemorySource | None = None,
        **overrides: Any,
    ) -> RunManager:
        chosen = settings or lf_settings()

        async def settings_provider() -> Settings:
            return chosen

        parts: dict[str, Any] = {
            "session_factory": session_factory,
            "embedder": embedder,
            "claude_provider": lambda: claude,
            "checkpointer_source": source or MemorySource(),
            "settings_provider": settings_provider,
            "kinds": {(APP, kind.mode): kind for kind in RUN_KINDS},
            "progress_interval": 0.05,
        }
        parts.update(overrides)
        manager = RunManager(**parts)
        made.append(manager)
        return manager

    try:
        yield make
    finally:
        for manager in reversed(made):
            await manager.shutdown()
