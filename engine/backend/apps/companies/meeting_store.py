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
  the date in words (Melbourne time). So "sample 26 nov", "thu" and "26/11" all work.
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


class RepOf(Protocol):
    async def __call__(self, session: AsyncSession, owner_id: str) -> tuple[str, str] | None: ...


async def no_rep(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
    """Until M5: the link from a person's account to their HubSpot owner is Track 1's (the
    owner id on `core.users`), and it isn't in this branch yet. So no owner has a rep here."""
    return None


@dataclass(frozen=True)
class MeetingSource:
    """Core's meeting reads, the rep's HubSpot owner, and the rep for an owner (their name and
    address: who gets "your pre-read is ready", and who is ticked when it is sent), as Meetings
    uses them. A test gives made-up ones. It lives on `app.state.meeting_source`."""

    upcoming: Window = hubspot_meetings.upcoming
    past: Window = hubspot_meetings.past
    for_company: ForCompany = hubspot_meetings.for_company
    get: GetOne = hubspot_meetings.get
    status: Status = hubspot_meetings.status
    owner_of: OwnerOf = activities.owner_of
    rep_of_owner: RepOf = no_rep


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
    typed: MeetingFormState | None = None  # a typed meeting's own pre-read


async def items_of(session: AsyncSession, rows: Sequence[Row]) -> list[MeetingItem]:
    ids = [row.meeting.id for row in rows if row.typed is None]
    forms = await forms_of(session, ids)
    noted = await with_notes(session, ids)
    return [
        MeetingItem(
            meeting=row.meeting,
            company_name=row.company_name,
            group=row.group,
            form=row.typed or forms.get(row.meeting.id),
            notes_logged=row.typed is None and row.meeting.id in noted,
            typed=row.typed is not None,
        )
        for row in rows
    ]


@dataclass(frozen=True)
class Entry:
    """One meeting a list may show: from HubSpot, or typed in for "New pre-read"."""

    meeting: Meeting
    company_name: str
    typed: MeetingFormState | None = None


async def typed_meetings(
    session: AsyncSession, auth: AuthContext | None, *, upcoming: bool, now: datetime
) -> list[Entry]:
    """My own pre-reads for meetings typed in ("New pre-read"), in the same window as the list:
    the next 7 days, or the last 30, by when the meeting starts. With sign-in off: the ones
    nobody signed in made. Each is shown as a meeting with no HubSpot id."""
    window = (
        (now, now + timedelta(days=UPCOMING_DAYS))
        if upcoming
        else (now - timedelta(days=PAST_DAYS), now)
    )
    maker = (
        MeetingForm.made_by == auth.user.id if auth is not None else MeetingForm.made_by.is_(None)
    )
    forms = await session.scalars(
        select(MeetingForm).where(
            MeetingForm.meeting_id.is_(None),
            maker,
            MeetingForm.starts_at >= window[0],
            MeetingForm.starts_at < window[1],
        )
    )
    return [
        Entry(
            meeting=Meeting(
                id="",
                company_id=form.company_key,
                title=form.title,
                starts_at=form.starts_at,
                ends_at=form.ends_at,
                where=form.where,  # the table's check keeps it to the list
            ),
            company_name=form.company_name,
            typed=MeetingFormState(id=form.id, status=form.status),
        )
        for form in forms
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
    past (newest first). Mine, or the team's with mine first. My own typed pre-reads join them,
    even while HubSpot's meetings aren't read."""
    status = await source.status(session)
    upcoming = when == "upcoming"
    owner = await my_owner(session, auth, source) if status.state == "ready" else None
    sentence: str | None = None
    entries: list[Entry] = []
    if status.state != "ready":
        sentence = status.sentence or NOT_READY
    elif mine and auth is not None and owner is None:
        sentence = NOT_LINKED
    else:
        read = source.upcoming if upcoming else source.past
        found = await read(
            session,
            owner_id=owner if mine else None,
            days=UPCOMING_DAYS if upcoming else PAST_DAYS,
        )
        entries += [Entry(meeting, name) for meeting, name in await client_meetings(session, found)]
    entries += await typed_meetings(session, auth, upcoming=upcoming, now=now)
    words = search_words(q)
    entries = [entry for entry in entries if matches(entry.meeting, entry.company_name, words)]

    def order(entry: Entry) -> tuple[bool, float]:
        theirs = (  # mine first: a typed one is always mine
            not mine
            and owner is not None
            and entry.typed is None
            and entry.meeting.owner_id != owner
        )
        moment = entry.meeting.starts_at.timestamp()
        return theirs, (moment if upcoming else -moment)

    entries.sort(key=order)
    rows = [
        Row(
            entry.meeting,
            entry.company_name,
            group_of(entry.meeting.starts_at, now) if upcoming else None,
            entry.typed,
        )
        for entry in entries[offset : offset + limit]
    ]
    return MeetingPage(
        items=await items_of(session, rows),
        total=len(entries),
        meetings_state=status.state,
        sentence=sentence,
    )


async def summary(
    session: AsyncSession, auth: AuthContext | None, *, source: MeetingSource, now: datetime
) -> MeetingSummary:
    """For Home: my upcoming meetings (the next 7 days) that need a pre-read (none, or one that
    failed), and those whose draft waits for me, my typed ones too. A cancelled meeting needs
    none."""
    states: list[str | None] = []
    if (await source.status(session)).state == "ready":
        owner = await my_owner(session, auth, source)
        if auth is None or owner is not None:
            found = await client_meetings(
                session, await source.upcoming(session, owner_id=owner, days=UPCOMING_DAYS)
            )
            meetings = [meeting for meeting, _ in found if not cancelled(meeting)]
            forms = await forms_of(session, [meeting.id for meeting in meetings])
            states += [forms[m.id].status if m.id in forms else None for m in meetings]
    typed = await typed_meetings(session, auth, upcoming=True, now=now)
    states += [entry.typed.status for entry in typed if entry.typed is not None]
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
