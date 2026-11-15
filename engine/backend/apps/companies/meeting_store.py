"""The Meetings reads (PLAN-V17 T2-11): a rep's client meetings from HubSpot, each with where its
pre-read is; the counts for Home; one meeting with its pre-read; and a company's meetings. The
routes are in api_meetings.py.

- **From our copy,** through core's meeting reads (`core/hubspot/meetings.py`), injected as a
  `MeetingSource` so tests use made-up meetings. Until Track 1's reads land they find nothing, and
  the status says meetings aren't read yet.
- **Only client meetings:** one with no company, or with a company not in our copy, is left out.
  A cancelled one stays, with its outcome.
- **Mine** is the rep's own, by their HubSpot owner (`owner_of`). With sign-in off nobody is
  signed in, so it is everyone's. The team's list puts the rep's own first.
- **The search** is plain code: each word must start a word of the company's name, the title, or
  the date in words (Melbourne time). So "vitera 26 nov", "thu" and "26/11" all work.
"""

import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.notes import MELBOURNE
from apps.companies.schemas import (
    FormFact,
    FormMeeting,
    FormRecipient,
    FormSummaries,
    FormSummary,
    HubSpotCopy,
    MeetingDetail,
    MeetingFormOut,
    MeetingFormState,
    MeetingGroup,
    MeetingItem,
    MeetingPage,
    MeetingSummary,
    MeetingWhen,
)
from apps.companies.tables import CallNote, MeetingForm
from core.api.errors import Problem
from core.auth.models import User
from core.auth.sessions import AuthContext
from core.config import Settings
from core.hubspot import activities
from core.hubspot import meetings as hubspot_meetings
from core.hubspot.meetings import Meeting, MeetingsStatus
from core.hubspot.models import HubSpotCompany

UPCOMING_DAYS: Final = 7  # Upcoming is the next 7 days
PAST_DAYS: Final = 30  # how far back Past looks (TBC)
COMPANY_MEETINGS: Final = 3  # a company's record shows its next three and its last three
CANCELLED: Final = frozenset({"canceled", "cancelled"})  # HubSpot writes "canceled"

# --- The words (PLAN-V15 "Words for errors") ---------------------------------------------------

NOT_READY = "Meetings from HubSpot aren't ready yet."
NOT_LINKED = (
    "Your account isn't linked to a HubSpot owner yet, so your own meetings can't be picked "
    "out. Show the team's meetings to see them."
)


def meeting_forms_off() -> Problem:
    return Problem(
        409,
        "Meetings are off",
        "Meetings and pre-reads are switched off. An admin can switch them on in Settings.",
        code="meeting_forms_off",
    )


def meeting_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that meeting",
        "It may have moved or gone in HubSpot, or it isn't linked to a client company.",
        code="meeting_not_found",
    )


# --- The seam: core's meeting reads ------------------------------------------------------------


class Window(Protocol):
    async def __call__(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]: ...


class ForCompany(Protocol):
    async def __call__(self, session: AsyncSession, company_id: str) -> list[Meeting]: ...


class GetOne(Protocol):
    async def __call__(self, session: AsyncSession, meeting_id: str) -> Meeting | None: ...


class Status(Protocol):
    async def __call__(self, session: AsyncSession) -> MeetingsStatus: ...


class OwnerOf(Protocol):
    async def __call__(self, session: AsyncSession, user_id: uuid.UUID | None) -> str | None: ...


@dataclass(frozen=True)
class MeetingSource:
    """Core's meeting reads, and the rep's HubSpot owner, as Meetings uses them. A test gives
    made-up meetings. It lives on `app.state.meeting_source`."""

    upcoming: Window = hubspot_meetings.upcoming
    past: Window = hubspot_meetings.past
    for_company: ForCompany = hubspot_meetings.for_company
    get: GetOne = hubspot_meetings.get
    status: Status = hubspot_meetings.status
    owner_of: OwnerOf = activities.owner_of


# --- Groups and the search ------------------------------------------------------------------------

WEEKDAYS: Final = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
MONTHS: Final = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)
WORD: Final = re.compile(r"[\w']+")
EDGES: Final = ".,;:!?()[]\"'"


def group_of(starts_at: datetime, now: datetime) -> MeetingGroup:
    """An upcoming meeting's day, by the Melbourne date. The week ends on Sunday."""
    today = now.astimezone(MELBOURNE).date()
    day = starts_at.astimezone(MELBOURNE).date()
    if day <= today:
        return "today"
    if day == today + timedelta(days=1):
        return "tomorrow"
    sunday = today + timedelta(days=6 - today.weekday())
    return "this_week" if day <= sunday else "later"


def date_words(starts_at: datetime) -> list[str]:
    """The meeting's date as a person might type it, in Melbourne time: thursday, thu, 26, 26/11,
    nov, 2026-11-26 and so on."""
    local = starts_at.astimezone(MELBOURNE)
    weekday, month = WEEKDAYS[local.weekday()], MONTHS[local.month - 1]
    d, m, y = local.day, local.month, local.year
    return [
        weekday,
        weekday[:3],
        str(d),
        f"{d:02d}",
        month,
        month[:3],
        str(y),
        f"{d}/{m}",
        f"{d:02d}/{m:02d}",
        f"{d}/{m}/{y}",
        f"{d:02d}/{m:02d}/{y}",
        local.date().isoformat(),
    ]


def search_words(q: str | None) -> list[str]:
    """The words of a search, in lower case, without the marks around them."""
    found = (part.strip(EDGES).casefold() for part in (q or "").split())
    return [word for word in found if word]


def matches(meeting: Meeting, company_name: str, words: Sequence[str]) -> bool:
    """Every word starts a word of the company's name, the title, or the date in words."""
    if not words:
        return True
    tokens = WORD.findall(f"{company_name} {meeting.title}".casefold())
    tokens += date_words(meeting.starts_at)
    return all(any(token.startswith(word) for token in tokens) for word in words)


def cancelled(meeting: Meeting) -> bool:
    return (meeting.outcome or "").strip().casefold() in CANCELLED


# --- Reading -------------------------------------------------------------------------------------


async def my_owner(
    session: AsyncSession, auth: AuthContext | None, source: MeetingSource
) -> str | None:
    """The signed-in person's HubSpot owner, or None (sign-in off, or not linked yet)."""
    return await source.owner_of(session, auth.user.id) if auth is not None else None


async def company_names(session: AsyncSession, ids: Iterable[str | None]) -> dict[str, str]:
    wanted = {key for key in ids if key}
    if not wanted:
        return {}
    rows = await session.execute(
        select(HubSpotCompany.hubspot_id, HubSpotCompany.name).where(
            HubSpotCompany.hubspot_id.in_(wanted)
        )
    )
    return {key: name for key, name in rows.all()}


async def client_meetings(
    session: AsyncSession, meetings: Iterable[Meeting]
) -> list[tuple[Meeting, str]]:
    """The meetings linked to a company in our copy, each with the company's name."""
    found = [meeting for meeting in meetings if meeting.company_id]
    names = await company_names(session, (meeting.company_id for meeting in found))
    return [
        (meeting, names[meeting.company_id])
        for meeting in found
        if meeting.company_id is not None and meeting.company_id in names
    ]


async def forms_of(
    session: AsyncSession, meeting_ids: Sequence[str]
) -> dict[str, MeetingFormState]:
    if not meeting_ids:
        return {}
    rows = await session.execute(
        select(MeetingForm.meeting_id, MeetingForm.id, MeetingForm.status).where(
            MeetingForm.meeting_id.in_(meeting_ids)
        )
    )
    return {
        meeting_id: MeetingFormState(id=form_id, status=status)
        for meeting_id, form_id, status in rows.all()
        if meeting_id is not None
    }


async def with_notes(session: AsyncSession, meeting_ids: Sequence[str]) -> set[str]:
    """The meetings that have a call note linked to them (Log meeting)."""
    if not meeting_ids:
        return set()
    found = await session.scalars(
        select(CallNote.meeting_id).where(CallNote.meeting_id.in_(meeting_ids)).distinct()
    )
    return {meeting_id for meeting_id in found if meeting_id is not None}


@dataclass(frozen=True)
class Row:
    meeting: Meeting
    company_name: str
    group: MeetingGroup | None


async def items_of(session: AsyncSession, rows: Sequence[Row]) -> list[MeetingItem]:
    ids = [row.meeting.id for row in rows]
    forms = await forms_of(session, ids)
    noted = await with_notes(session, ids)
    return [
        MeetingItem(
            meeting=row.meeting,
            company_name=row.company_name,
            group=row.group,
            form=forms.get(row.meeting.id),
            notes_logged=row.meeting.id in noted,
        )
        for row in rows
    ]


async def list_meetings(
    session: AsyncSession,
    auth: AuthContext | None,
    *,
    source: MeetingSource,
    when: MeetingWhen,
    mine: bool,
    q: str | None,
    limit: int,
    offset: int,
    now: datetime,
) -> MeetingPage:
    """A page of client meetings: upcoming (the next 7 days, soonest first, grouped by day) or
    past (newest first). Mine, or the team's with mine first."""
    status = await source.status(session)
    if status.state != "ready":
        sentence = status.sentence or NOT_READY
        return MeetingPage(items=[], total=0, meetings_state=status.state, sentence=sentence)
    owner = await my_owner(session, auth, source)
    if mine and auth is not None and owner is None:
        return MeetingPage(items=[], total=0, meetings_state="ready", sentence=NOT_LINKED)
    upcoming = when == "upcoming"
    read = source.upcoming if upcoming else source.past
    found = await read(
        session, owner_id=owner if mine else None, days=UPCOMING_DAYS if upcoming else PAST_DAYS
    )
    words = search_words(q)
    pairs = [
        (meeting, name)
        for meeting, name in await client_meetings(session, found)
        if matches(meeting, name, words)
    ]

    def order(pair: tuple[Meeting, str]) -> tuple[bool, float]:
        meeting = pair[0]
        theirs = not mine and owner is not None and meeting.owner_id != owner  # mine first
        moment = meeting.starts_at.timestamp()
        return theirs, (moment if upcoming else -moment)

    pairs.sort(key=order)
    page = pairs[offset : offset + limit]
    rows = [
        Row(meeting, name, group_of(meeting.starts_at, now) if upcoming else None)
        for meeting, name in page
    ]
    return MeetingPage(
        items=await items_of(session, rows),
        total=len(pairs),
        meetings_state="ready",
        sentence=None,
    )


async def summary(
    session: AsyncSession, auth: AuthContext | None, *, source: MeetingSource
) -> MeetingSummary:
    """For Home: my upcoming meetings (the next 7 days) that need a pre-read (none, or one that
    failed), and those whose draft waits for me. A cancelled meeting needs none."""
    nothing = MeetingSummary(need_pre_read=0, draft_ready=0)
    if (await source.status(session)).state != "ready":
        return nothing
    owner = await my_owner(session, auth, source)
    if auth is not None and owner is None:
        return nothing
    found = await client_meetings(
        session, await source.upcoming(session, owner_id=owner, days=UPCOMING_DAYS)
    )
    meetings = [meeting for meeting, _ in found if not cancelled(meeting)]
    forms = await forms_of(session, [meeting.id for meeting in meetings])
    states = [forms[meeting.id].status if meeting.id in forms else None for meeting in meetings]
    return MeetingSummary(
        need_pre_read=sum(state in (None, "failed") for state in states),
        draft_ready=sum(state == "draft" for state in states),
    )


async def meeting_detail(
    session: AsyncSession, meeting_id: str, *, source: MeetingSource
) -> MeetingDetail:
    """One client meeting, with its pre-read if it has one (404 otherwise)."""
    meeting = await source.get(session, meeting_id)
    found = await client_meetings(session, [meeting] if meeting is not None else [])
    if not found:
        raise meeting_not_found()
    meeting, company_name = found[0]
    form = await session.scalar(select(MeetingForm).where(MeetingForm.meeting_id == meeting.id))
    return MeetingDetail(
        meeting=meeting,
        company_name=company_name,
        form=await form_out(session, form) if form is not None else None,
    )


async def company_meetings(
    session: AsyncSession, key: str, *, source: MeetingSource, settings: Settings, now: datetime
) -> list[MeetingItem]:
    """A company's next three meetings, soonest first, then its last three, newest first. Empty
    while meetings are off or not read yet, and for a company not in HubSpot."""
    if not settings.meeting_forms_enabled or key.startswith("lead:"):
        return []
    if (await source.status(session)).state != "ready":
        return []
    names = await company_names(session, [key])
    if key not in names:
        return []
    found = await source.for_company(session, key)
    ahead = sorted((m for m in found if m.starts_at >= now), key=lambda m: m.starts_at)
    behind = sorted((m for m in found if m.starts_at < now), key=lambda m: m.starts_at)
    rows = [Row(m, names[key], group_of(m.starts_at, now)) for m in ahead[:COMPANY_MEETINGS]]
    rows += [Row(m, names[key], None) for m in reversed(behind[-COMPANY_MEETINGS:])]
    return await items_of(session, rows)


# --- A pre-read, as the routes send it ---------------------------------------------------------

EMPTY_SUMMARY: Final = FormSummary(text="", by="ai", sources=[])


def _summary(summaries: dict[str, object], name: str) -> FormSummary:
    found = summaries.get(name)
    return FormSummary.model_validate(found) if isinstance(found, dict) else EMPTY_SUMMARY


async def form_out(session: AsyncSession, form: MeetingForm) -> MeetingFormOut:
    sender = await session.get(User, form.sent_by) if form.sent_by is not None else None
    summaries = form.summaries if isinstance(form.summaries, dict) else {}
    return MeetingFormOut(
        id=form.id,
        meeting=FormMeeting(
            meeting_id=form.meeting_id,
            company_key=form.company_key,
            company_name=form.company_name,
            title=form.title,
            starts_at=form.starts_at,
            ends_at=form.ends_at,
            where=form.where,  # the table's check keeps it to the list
        ),
        status=form.status,
        facts=[FormFact.model_validate(fact) for fact in form.facts if isinstance(fact, dict)],
        summaries=FormSummaries(
            what_they_do=_summary(summaries, "what_they_do"),
            what_we_know=_summary(summaries, "what_we_know"),
            talks_so_far=_summary(summaries, "talks_so_far"),
        ),
        next_step=form.next_step,
        going=form.going,
        sent_to=[FormRecipient.model_validate(to) for to in form.sent_to if isinstance(to, dict)],
        sent_at=form.sent_at,
        sent_by=sender.name if sender is not None else None,
        hubspot_copy=(
            HubSpotCopy(state=form.hubspot_copy, sentence=form.hubspot_copy_sentence)
            if form.hubspot_copy is not None
            else None
        ),
        cost_usd=form.cost_usd,
        error=form.error,
    )
