"""Shared FastAPI dependencies. Tests swap these with app.dependency_overrides."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.errors import Problem
from core.claude.client import Claude, ClaudeUnavailable, configure_claude, get_claude
from core.config import Settings
from core.db.engine import get_session
from core.memory.embedder import Embedder, get_embedder
from core.prefs.service import effective_settings
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


async def settings_dependency(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Settings:
    """The settings in use for this request: .env with the saved overrides on top, read fresh
    every time and never cached, so a change on the Settings page applies to the next request.

    It reads through the request's own session (the same `get_session`, so a test that swaps
    the session swaps this too) and ends the transaction it started, so no connection is held
    while the route waits on Claude. A database that can't be reached is NOT answered with the
    .env settings: the saved caps may be lower than .env, so the request fails instead. The
    shared Claude is given the same settings (model, effort, how many requests at once).
    """
    started = not session.in_transaction()
    try:
        settings = await effective_settings(session)
    finally:
        if started:
            await session.rollback()  # a read only: this ends the transaction
    configure_claude(settings)
    return settings


SessionDep = Annotated[AsyncSession, Depends(get_session)]
EmbedderDep = Annotated[Embedder, Depends(get_embedder)]
ClaudeDep = Annotated[Claude, Depends(claude_dependency)]
RunManagerDep = Annotated[RunManager, Depends(run_manager_dependency)]
SettingsDep = Annotated[Settings, Depends(settings_dependency)]
