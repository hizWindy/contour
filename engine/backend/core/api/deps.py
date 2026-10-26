"""Shared FastAPI dependencies. Tests swap these with app.dependency_overrides."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.errors import Problem
from core.claude.client import Claude, ClaudeUnavailable, get_claude
from core.config import Settings, get_settings
from core.db.engine import get_session
from core.memory.embedder import Embedder, get_embedder
from core.runs.manager import RunManager


def claude_dependency() -> Claude:
    """The Claude client. A missing or bad key is a plain 503, not a crash.

    Other modules import this same function object, so `dependency_overrides` set on it
    reaches every route that uses `ClaudeDep`.
    """
    try:
        return get_claude()
    except ClaudeUnavailable as error:
        raise Problem(503, error.title, error.detail) from error


def run_manager_dependency(request: Request) -> RunManager:
    """The run manager, which the app's start-up code puts in `app.state.run_manager`."""
    manager: RunManager | None = getattr(request.app.state, "run_manager", None)
    if manager is None:
        raise Problem(
            503,
            "Runs aren't ready",
            "The run engine hasn't started. Check the backend log.",
            code="runs_not_ready",
        )
    return manager


def settings_dependency() -> Settings:
    """The settings in use. For now this is .env only; package B2 adds the saved overrides."""
    return get_settings()


SessionDep = Annotated[AsyncSession, Depends(get_session)]
EmbedderDep = Annotated[Embedder, Depends(get_embedder)]
ClaudeDep = Annotated[Claude, Depends(claude_dependency)]
RunManagerDep = Annotated[RunManager, Depends(run_manager_dependency)]
SettingsDep = Annotated[Settings, Depends(settings_dependency)]
