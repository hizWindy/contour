"""The Meetings routes (PLAN-V17 T2-11, the contract's part 3), under /api/v1/companies.

Behind the Companies tick, like every Companies route. Each answers 409 `meeting_forms_off` while
meetings and pre-reads are switched off. A rep sees their own meetings, or the team's. The fixed
paths come before `/meetings/{meeting_id}`, and the whole router before `/{key}`. The service is
meeting_store.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request

from apps.companies import meeting_store
from apps.companies.meeting_store import MeetingSource
from apps.companies.schemas import MeetingDetail, MeetingPage, MeetingSummary, MeetingWhen
from core.api.access import SignedInDep
from core.api.deps import SessionDep, SettingsDep
from core.api.models import OFFSET_MAX, SafeText
from core.api.signin import NowDep
from core.config import Settings

router = APIRouter()
PAGE_SIZE = 50


def meeting_source(request: Request) -> MeetingSource:
    """The app's meeting reads, made on first use. A test puts its own in app.state."""
    source: MeetingSource | None = getattr(request.app.state, "meeting_source", None)
    if source is None:
        source = MeetingSource()
        request.app.state.meeting_source = source
    return source


async def meetings_on(settings: SettingsDep) -> Settings:
    """The settings in use, once meetings are on (409 `meeting_forms_off` while they are off)."""
    if not settings.meeting_forms_enabled:
        raise meeting_store.meeting_forms_off()
    return settings


SourceDep = Annotated[MeetingSource, Depends(meeting_source)]
MeetingsOnDep = Annotated[Settings, Depends(meetings_on)]
MeetingId = Annotated[
    str,
    Path(min_length=1, max_length=32, pattern=r"^[0-9]+$", description="HubSpot's meeting id"),
]


@router.get(
    "/meetings",
    response_model=MeetingPage,
    summary="My meetings",
    description=(
        "A page of client meetings from HubSpot (one with no company is left out; a cancelled "
        "one stays, with its outcome). `when`: `upcoming` (the next 7 days, soonest first, each "
        "with its `group` by the Melbourne date: today, tomorrow, this_week or later) or `past` "
        "(the last 30 days, newest first). `mine` (true by default): my own, as my HubSpot "
        "owner; false: the team's, mine first. `q`: each word must start a word of the "
        "company's name, the title or the date in words, like 'vitera 26 nov', 'thu' or "
        "'26/11'. Each meeting comes with its pre-read's state (`form`) and, once past, whether "
        "notes were logged. While HubSpot's meetings aren't read, the list is empty and "
        "`meetings_state` and `sentence` say why. 409 `meeting_forms_off`."
    ),
)
async def list_meetings(
    session: SessionDep,
    settings: MeetingsOnDep,
    auth: SignedInDep,
    source: SourceDep,
    now: NowDep,
    when: MeetingWhen = "upcoming",
    mine: bool = True,
    q: Annotated[SafeText | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=OFFSET_MAX)] = 0,
) -> MeetingPage:
    return await meeting_store.list_meetings(
        session,
        auth,
        source=source,
        when=when,
        mine=mine,
        q=q,
        limit=limit,
        offset=offset,
        now=now,
    )


@router.get(
    "/meetings/summary",
    response_model=MeetingSummary,
    summary="My meeting counts",
    description=(
        "For Home: my upcoming client meetings (the next 7 days) that need a pre-read (none "
        "yet, or one that failed; a cancelled meeting needs none), and those whose draft waits "
        "for me. Zero while HubSpot's meetings aren't read. 409 `meeting_forms_off`."
    ),
)
async def meeting_summary(
    session: SessionDep, settings: MeetingsOnDep, auth: SignedInDep, source: SourceDep
) -> MeetingSummary:
    return await meeting_store.summary(session, auth, source=source)


@router.get(
    "/meetings/{meeting_id}",
    response_model=MeetingDetail,
    summary="One meeting",
    description=(
        "A client meeting from HubSpot, its company's name, and its pre-read if it has one. "
        "404 `meeting_not_found` when it isn't in our copy or has no company. 409 "
        "`meeting_forms_off`."
    ),
)
async def get_meeting(
    meeting_id: MeetingId, session: SessionDep, settings: MeetingsOnDep, source: SourceDep
) -> MeetingDetail:
    return await meeting_store.meeting_detail(session, meeting_id, source=source)
