"""The tools for Admin's Sources tab (PLAN-V16 T2-8, the contract part 4). Admins only.

- `GET /sources`: each tool: connected, switched on, signed in, the last good read, pages today of
  the day's limit, records in our copy, a pause, and the last problem in one plain sentence.
- `POST /sources/{id}/check`: a free sign-in check. It opens one page (two, with a sign-in).
- `POST /sources/{id}/resume`: lifts a 24-hour pause.

The switch itself is a setting (`property_daily_enabled`, on the Settings page). Arealytics is
listed, but isn't connected: its site refused automated access (15 Nov), so it has no switch, no
check and no resume. No answer ever holds a login, a page or a raw error.
"""

import contextlib
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Path
from pydantic import BaseModel, Field

from core.api.deps import SessionDep
from core.api.errors import Problem
from core.api.models import OutModel
from core.api.signin import AdminDep
from core.browser.reader import SourceStopped
from core.browser.worker import BrowserError
from core.prefs.service import effective_settings
from core.sources import store
from core.sources.service import availability, get_sources
from core.sources.types import SOURCE_NAMES, SourceId

router = APIRouter(prefix="/sources", tags=["sources"])

# The last problem, for a person (core.source_reads.outcome -> words). Never a raw error.
PROBLEM_WORDS: dict[str, str] = {
    "captcha": "The site asked for a person-check, so reading stopped for 24 hours.",
    "lockout": (
        "The site said the account is locked or in use somewhere else, so reading stopped for "
        "24 hours."
    ),
    "forbidden": "The site refused a page, so reading stopped for 24 hours.",
    "rate_limited": "The site asked us to slow down, so reading stopped for 24 hours.",
    "signin_failed": "The sign-in didn't work. Check the username and password.",
    "signin_twice": (
        "The site asked for a sign-in again right after one, so reading stopped for 24 hours."
    ),
    "signin_page": "The site asked for a sign-in.",
    "timeout": "A page took too long to load.",
    "error": "A page didn't load.",
}
AREALYTICS_PROBLEM = "Arealytics refused automated access. It waits on an API or written approval."
NOT_CONNECTED_TITLE = "Arealytics isn't connected"
NOT_CONNECTED_DETAIL = "It refused automated access, so there is nothing to check or resume."
NOT_READY_TITLE = "Property Daily isn't ready"


class ToolOut(OutModel):
    id: SourceId
    name: str = Field(examples=["Property Daily"])
    connected: bool = Field(description="False: there is no connector (Arealytics)")
    on: bool = Field(description="Its switch, on the Settings page")
    signed_in: bool | None = Field(
        description="Signed in now. None: not checked since the backend started"
    )
    last_read_at: datetime | None = Field(description="The last page read without a problem")
    pages_today: int = Field(description="Pages read today (a Melbourne day)")
    pages_limit: int = Field(description="The most pages a day")
    records: int = Field(description="Facts in our copy")
    paused_until: datetime | None = Field(description="Paused after a block until then")
    last_problem: str | None = Field(
        description="The last problem, in one plain sentence. None when there was none",
        examples=["The site asked us to slow down, so reading stopped for 24 hours."],
    )


class ToolList(BaseModel):
    items: list[ToolOut]


async def _source_out(session: SessionDep, source: SourceId) -> ToolOut:
    settings = await effective_settings(session)
    if source == "arealytics":
        return ToolOut(
            id=source,
            name=SOURCE_NAMES[source],
            connected=False,
            on=False,
            signed_in=None,
            last_read_at=None,
            pages_today=0,
            pages_limit=0,
            records=0,
            paused_until=None,
            last_problem=AREALYTICS_PROBLEM,
        )
    state = await store.get_state(session, source)
    paused = state.paused_until if state and state.paused_until else None
    if paused is not None and paused <= datetime.now(UTC):
        paused = None
    problem = state.last_problem if state else None
    return ToolOut(
        id=source,
        name=SOURCE_NAMES[source],
        connected=True,
        on=settings.property_daily_enabled,
        signed_in=get_sources().signed_in,
        last_read_at=await store.last_good_read(session, source),
        pages_today=await get_sources().pages_today(session, source),
        pages_limit=settings.source_pages_per_day,
        records=await store.count_records(session, source),
        paused_until=paused,
        last_problem=PROBLEM_WORDS.get(problem) if problem else None,
    )


SourcePath = Annotated[SourceId, Path(description="property_daily or arealytics")]


@router.get(
    "",
    response_model=ToolList,
    summary="The tools and how each is doing",
    description="Property Daily, and Arealytics (listed, but not connected). Admins only.",
)
async def list_sources(session: SessionDep, admin: AdminDep) -> ToolList:
    return ToolList(items=[await _source_out(session, source) for source in SOURCE_NAMES])


@router.post(
    "/{source_id}/check",
    response_model=ToolOut,
    summary="Check the sign-in now",
    description=(
        "Opens the tool's home page, and signs in if it asks: one or two pages, free. A problem "
        "fills `last_problem`; a block pauses the tool for 24 hours. A tool that is off, has no "
        "login, is paused or isn't connected answers 409 with the reason."
    ),
    responses={409: {"description": "The tool isn't ready to check"}},
)
async def check_source(source_id: SourcePath, session: SessionDep, admin: AdminDep) -> ToolOut:
    if source_id == "arealytics":
        raise Problem(409, NOT_CONNECTED_TITLE, NOT_CONNECTED_DETAIL, code="not_connected")
    settings = await effective_settings(session)
    found = (await availability(session, settings))[source_id]
    if not found.ready:
        raise Problem(409, NOT_READY_TITLE, found.sentence or "", code="source_not_ready")
    with contextlib.suppress(SourceStopped, BrowserError):  # the ledger has the problem
        await get_sources().check(settings)
    await session.commit()  # end the read so the answer sees what the check wrote
    return await _source_out(session, source_id)


@router.post(
    "/{source_id}/resume",
    response_model=ToolOut,
    summary="Lift a pause",
    description="Reading may go on now, before the 24 hours are up. Admins only.",
    responses={409: {"description": "Arealytics isn't connected"}},
)
async def resume_source(source_id: SourcePath, session: SessionDep, admin: AdminDep) -> ToolOut:
    if source_id == "arealytics":
        raise Problem(409, NOT_CONNECTED_TITLE, NOT_CONNECTED_DETAIL, code="not_connected")
    await store.resume(session, source_id)
    await session.commit()
    return await _source_out(session, source_id)
