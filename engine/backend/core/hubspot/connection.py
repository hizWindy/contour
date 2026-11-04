"""How the backend gets a HubSpot client and the sync runner, in one place, so tests and the fake
backend can swap them (`app.state.hubspot_provider`, `app.state.hubspot_syncs`).

The status the Admin page shows (`connection_status`) joins the key, the connection check (kept
for `CHECK_FRESH_SECONDS`, so opening the page doesn't call HubSpot every time), each project's
needs, the syncs and our copy's counts.
"""

import time
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings, get_settings
from core.hubspot.check import ConnectionCheck, check_connection
from core.hubspot.client import HubSpot, get_hubspot
from core.hubspot.needs import ProjectReadiness, readiness
from core.hubspot.service import HubSpotSummary, summary
from core.hubspot.sync import SyncOut, SyncRunner, last_good, recent_syncs, running_sync

if TYPE_CHECKING:
    from core.apps import AppSpec

CHECK_FRESH_SECONDS = 600


def hubspot_provider(app: FastAPI) -> Any:
    """The function that makes a client: the app's own (the fake backend sets one), or the real
    one from settings."""
    return getattr(app.state, "hubspot_provider", None) or get_hubspot


def sync_runner(app: FastAPI) -> SyncRunner:
    """The app's one sync runner, made on first use. Tests may put their own in
    `app.state.hubspot_syncs`."""
    runner: SyncRunner | None = getattr(app.state, "hubspot_syncs", None)
    if runner is None:
        from core.db.engine import get_sessionmaker
        from core.memory.embedder import get_embedder

        runner = SyncRunner(
            sessions=get_sessionmaker(),
            hubspot=lambda: hubspot_provider(app)(),
            embedder=get_embedder,
            settings=get_settings,
        )
        app.state.hubspot_syncs = runner
    return runner


async def start_up(app: FastAPI) -> None:
    """At backend start: a background sync when the last good one is old. Never raises."""
    await sync_runner(app).start_if_due()


async def shut_down(app: FastAPI) -> None:
    """At backend stop: a running sync is stopped and marked interrupted."""
    runner: SyncRunner | None = getattr(app.state, "hubspot_syncs", None)
    if runner is not None:
        await runner.stop()


@asynccontextmanager
async def open_hubspot(app: FastAPI) -> AsyncIterator[HubSpot | None]:
    """A client for one request, closed after. None when no key is set."""
    client: HubSpot | None = hubspot_provider(app)()
    try:
        yield client
    finally:
        if client is not None:
            await client.aclose()


class HubSpotStatus(BaseModel):
    key_set: bool = Field(description="Whether HUBSPOT_SERVICE_KEY is set. The key is never sent")
    api_version: str = Field(description="HubSpot's API version in use, like 2026-09")
    write_enabled: bool = Field(description="HUBSPOT_WRITE_ENABLED: whether writing is switched on")
    check: ConnectionCheck
    projects: list[ProjectReadiness]
    running_sync: SyncOut | None = Field(description="The sync running now, if one is")
    last_good_sync: SyncOut | None = Field(description="The newest sync that finished well")
    recent_syncs: list[SyncOut] = Field(description="The newest syncs, newest first")
    copy_counts: HubSpotSummary = Field(description="What our copy of HubSpot holds now")


async def connection_check(app: FastAPI, *, refresh: bool) -> ConnectionCheck:
    cached: tuple[ConnectionCheck, float] | None = getattr(app.state, "hubspot_check", None)
    if cached and not refresh and time.monotonic() - cached[1] < CHECK_FRESH_SECONDS:
        return cached[0]
    async with open_hubspot(app) as client:
        found = await check_connection(client)
    app.state.hubspot_check = (found, time.monotonic())
    return found


def written_hook(app: FastAPI, project: str) -> Any:
    """The project's own step after one of its writes is done, or None."""
    for spec in getattr(app.state, "apps", []):
        if spec.name == project:
            return spec.hubspot_written
    return None


def project_readiness(
    specs: Sequence["AppSpec"], check: ConnectionCheck, settings: Settings
) -> list[ProjectReadiness]:
    return [
        readiness(
            spec.name,
            spec.title,
            spec.hubspot_needs,
            check,
            write_enabled=settings.hubspot_write_enabled,
        )
        for spec in specs
        if spec.hubspot_needs is not None
    ]


async def connection_status(
    app: FastAPI, session: AsyncSession, *, refresh: bool = False
) -> HubSpotStatus:
    settings = get_settings()
    check = await connection_check(app, refresh=refresh)
    now = await running_sync(session)
    good = await last_good(session)
    status = HubSpotStatus(
        key_set=check.key_set,
        api_version=settings.hubspot_api_version,
        write_enabled=settings.hubspot_write_enabled,
        check=check,
        projects=project_readiness(getattr(app.state, "apps", []), check, settings),
        running_sync=SyncOut.model_validate(now) if now else None,
        last_good_sync=SyncOut.model_validate(good) if good else None,
        recent_syncs=await recent_syncs(session, limit=10),
        copy_counts=await summary(session),
    )
    await session.rollback()  # reads only: ends the transaction
    return status
