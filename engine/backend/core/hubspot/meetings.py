"""Meetings from HubSpot (PLAN-V17 T1-8), always read from our copy (`core.hubspot_meetings`).

**What is kept:** the meetings from `DAYS_BACK` (90) days back to `DAYS_AHEAD` (60) days ahead,
both TBC, as `Meeting` has them. The people on a meeting are HubSpot ids only: its contacts, its
owner and the other Contour owners on it. `FIELDS` never asks for `hs_all_attendee_emails` or
`hs_meeting_body` (addresses, and the text the client sees). An email or a phone number in the
title, the location or the notes is blanked before it is saved. Log lines carry ids and counts.

**How our copy is kept up to date:**
- **The daily read** (`copy_meetings`, in the sync's "people" phase, after accounts are matched
  to owners): every meeting that starts in the window, found with a search on
  `hs_meeting_start_time`, then their companies and people with `linked`. It replaces our copy,
  so a meeting deleted in HubSpot goes from it. It runs even while people wait for the contacts
  scope. It never fails the sync: a missing permission is one sentence naming it (`WAITING`),
  anything else a plain warning, and the copy from before stays.
- **A refresh** (`refresh`, started in the background by `connection.refresh_meetings_soon` when
  someone opens Meetings or Home): the meetings changed since the last good read started (less
  `OVERLAP`, as search lags), at most once every `REFRESH_EVERY` (15 minutes) after any read
  that asked HubSpot, one at a time. One that moved out of the window is removed. A search never
  shows a deleted meeting, so only the daily read removes one. Before the first good read, a
  refresh reads the whole window instead.
- **Sync on Meetings** (`MeetingsRefresher.sync_now`, PLAN-V18 T1-5): a full read of the window
  now, in the background, as the daily read does. It skips the 15-minute rule and the minute
  between asks, but keeps one read at a time (`reading`: while any read runs in this backend,
  it answers `running`) and asks HubSpot nothing within `SYNC_FRESH` (a minute) of a good read
  that is the newest (`fresh`). A refresh skips itself while another read runs.
- **Each read is a row** in `core.hubspot_meeting_reads`, so the 15-minute rule and `status`
  hold across restarts. Saves take turns (`MEETINGS_LOCK`), and no database connection is held
  while HubSpot answers.

**The reads** (`upcoming`, `past`, `for_company`, `get`, `status`) only read our copy. `status`
also says when the newest good read finished (`checked_at`), whether a read runs now
(`syncing`), and how the newest read ended (`last_read`).
"""

import asyncio
import contextlib
import logging
import re
import time
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import (
    BindParameter,
    ColumnElement,
    all_,
    any_,
    bindparam,
    delete,
    func,
    literal,
    or_,
    select,
    tuple_,
)
from sqlalchemy.dialects.postgresql import ARRAY, insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.types import String

from core.config import get_settings
from core.hubspot.client import (
    SEARCH_PAGE_SIZE,
    SEARCH_RESULTS_CAP,
    Association,
    Filter,
    HubSpot,
    HubSpotError,
    HubSpotMissingScope,
    HubSpotObject,
)
from core.hubspot.models import HubSpotMeeting, HubSpotMeetingRead
from core.hubspot.people import plain

log = logging.getLogger(__name__)

MeetingWhere = Literal["online", "in_person", "unknown"]
MeetingsState = Literal["ready", "waiting", "off"]
ReadKind = Literal["full", "changes"]
ReadState = Literal["done", "waiting", "failed"]
SyncState = Literal["started", "running", "fresh"]
Clock = Callable[[], datetime]

DAYS_BACK = 90  # the window our copy keeps (TBC)
DAYS_AHEAD = 60  # (TBC)
REFRESH_EVERY = timedelta(minutes=15)  # a refresh asks HubSpot at most this often
OVERLAP = timedelta(minutes=10)  # a refresh reads a little before the last read, as search lags
ASK_EVERY = 60.0  # seconds: one backend starts a refresh check at most this often
SYNC_FRESH = timedelta(minutes=1)  # Sync asks HubSpot nothing this soon after a good read
KEEP_READS = timedelta(days=30)  # read rows older than this go (the newest good one stays)
MEETINGS_LOCK = 7_244_413  # a Postgres advisory lock key: one save of our copy at a time
LIST_CAP = 5_000  # the most meetings `upcoming` and `past` return
COMPANY_CAP = 200  # the most meetings `for_company` returns
SAVE_CHUNK = 500  # meetings in one INSERT
MOST_PEOPLE = 100  # the most contact or owner ids kept on one meeting
TITLE_CHARS = 300
LOCATION_CHARS = 500
OUTCOME_CHARS = 32
NOTES_CHARS = 4_000

START = "hs_meeting_start_time"
MODIFIED = "hs_lastmodifieddate"
# The fields read, by HubSpot's names (PLAN-V17 T1-2 read them from HubSpot). Never
# hs_all_attendee_emails (addresses) or hs_meeting_body (the client's own text).
FIELDS = (
    "hs_meeting_title",
    START,
    "hs_meeting_end_time",
    "hs_meeting_location",
    "hs_meeting_location_type",
    "hs_meeting_external_url",
    "hs_meeting_outcome",
    "hs_internal_meeting_notes",
    "hubspot_owner_id",
    "hs_attendee_owner_ids",
    MODIFIED,
)

# --- The words (PLAN-V15 "Words for errors": no setting, file or command) -----------------------

NOT_READ_YET = "Meetings from HubSpot aren't read yet."
WAITING = "Waiting for HubSpot access to meetings (crm.objects.meetings.read)."
NO_HUBSPOT = "HubSpot isn't connected, so meetings can't be read from it."
MEETINGS_FAILED = "Meetings weren't copied this time. The ones copied before stay."
NO_PEOPLE_LINKS = (
    "Meetings were copied without who is on them: waiting for HubSpot access to contacts "
    "(crm.objects.contacts.read)."
)
TOO_MANY_TITLE = "Too many meetings at one time"
TOO_MANY_DETAIL = "HubSpot has more meetings starting at one moment than its search can list."
UNTITLED = "Untitled meeting"
EMAIL_GONE = "[email left out]"
PHONE_GONE = "[number left out]"


class Meeting(BaseModel):
    id: str = Field(description="The meeting in HubSpot")
    company_id: str | None = Field(
        None, description="The first company it is linked to, as HubSpot lists them"
    )
    contact_ids: list[str] = Field(
        default_factory=list, description="HubSpot's contacts on it, by id. Never an address"
    )
    owner_id: str | None = Field(None, description="Its HubSpot owner's id")
    title: str = Field(description="HubSpot's title, or 'Untitled meeting'")
    starts_at: datetime
    ends_at: datetime | None = None
    where: MeetingWhere = Field(
        "unknown",
        description=(
            "online: a video call (Teams, Meet or Zoom). in_person: an address. unknown: "
            "anything else, a phone call included"
        ),
    )
    location: str | None = Field(
        None, description="Where, as HubSpot has it, with emails and phone numbers left out"
    )
    outcome: str | None = Field(
        None,
        description=(
            "HubSpot's value as it comes: SCHEDULED, COMPLETED, RESCHEDULED, NO_SHOW or CANCELED"
        ),
    )
    notes: str | None = Field(
        None,
        description=(
            "HubSpot's internal notes as plain text, with emails and phone numbers left out, or "
            "none"
        ),
    )
    hubspot_url: str | None = None
    attendee_owner_ids: list[str] = Field(
        default_factory=list,
        description="The other Contour people on it, by HubSpot owner id (the owner left out)",
    )
    more_companies: bool = Field(
        False, description="It is linked to more than one company: company_id is the first"
    )


class MeetingsStatus(BaseModel):
    state: MeetingsState
    sentence: str | None = Field(None, description="One plain sentence when not ready")
    checked_at: datetime | None = Field(
        None, description="When the newest good read of HubSpot's meetings finished, or none"
    )
    syncing: bool = Field(False, description="A read of HubSpot's meetings runs in this backend")
    last_read: ReadState | None = Field(
        None, description="How the newest read ended: done, waiting (a permission) or failed"
    )


@dataclass(frozen=True)
class SyncAnswer:
    """What Sync on Meetings did: `started`, `running` (a read was going already) or `fresh` (a
    good read finished under `SYNC_FRESH` ago), and when the newest good read finished."""

    state: SyncState
    checked_at: datetime | None


def utc_now() -> datetime:
    return datetime.now(UTC)


# --- Pure code: a HubSpot meeting as we keep it ---------------------------------------------------

EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
# A run of 8 or more digits with the marks people put in phone numbers, on one line: "0412 345
# 678", "+61 8 9000 0000", "(08) 9000-0000", "04 12 34 56 78". Kept: a date ("2026-11-20 10",
# "20.11.2026"), and times ("10.30 - 11.30").
PHONE = re.compile(r"(?<![\w])\+?\(?\d[\d \t().-]{6,}\d(?![\w])")
DATE = re.compile(r"(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?:[ T]\d{1,2})?")
TIMES = re.compile(r"\d{1,2}[.:]\d{2}(?:\s*(?:-|to)\s*\d{1,2}[.:]\d{2})*")
DIGITS = re.compile(r"\d+")
LINK = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
# The link of a video call itself, by its host: its meeting number isn't a phone number. Any other
# link is read like the rest ("wa.me/61400000000" loses its number).
VIDEO_LINK = re.compile(
    r"(?:https?://)?(?:[\w-]+\.)*(?:teams\.microsoft\.com|teams\.live\.com|meet\.google\.com"
    r"|zoom\.us|zoom\.com)(?=[/:?#]|$)",
    re.IGNORECASE,
)
VIDEO = re.compile(
    r"teams\.microsoft\.com|teams\.live\.com|\bteams\b|meet\.google\.com|\bgoogle meet\b"
    r"|zoom\.us|\bzoom\b",
    re.IGNORECASE,
)
WORD = re.compile(r"[a-z]+")
# Words that don't name a place: how to call, placeholders, and video words that aren't Teams,
# Meet or Zoom.
NOT_A_PLACE = frozenset(
    {
        "a",
        "at",
        "call",
        "conference",
        "dial",
        "ext",
        "in",
        "link",
        "mob",
        "mobile",
        "n",
        "na",
        "none",
        "on",
        "online",
        "ph",
        "phone",
        "tba",
        "tbc",
        "tbd",
        "tel",
        "telephone",
        "unknown",
        "via",
        "video",
        "virtual",
        "webex",
    }
)


def _phone_like(match: re.Match[str]) -> str:
    found = match.group(0)
    shape = found.strip()
    if sum(map(len, DIGITS.findall(found))) < 8 or DATE.fullmatch(shape) or TIMES.fullmatch(shape):
        return found
    return PHONE_GONE


def without_contact_details(text: str) -> str:
    """`text` with every email address and phone number blanked. A Teams, Google Meet or Zoom
    link keeps its digits (its meeting number isn't a phone number). Any other link is read like
    the rest of the text. Never an email."""
    text = EMAIL.sub(EMAIL_GONE, text)
    parts: list[str] = []
    last = 0
    for link in LINK.finditer(text):
        if not VIDEO_LINK.match(link.group(0)):
            continue
        parts += [PHONE.sub(_phone_like, text[last : link.start()]), link.group(0)]
        last = link.end()
    parts.append(PHONE.sub(_phone_like, text[last:]))
    return "".join(parts)


def _line(value: str | None, limit: int) -> str | None:
    """One line of text as we keep it: contact details blanked, spaces tidied, cut to `limit`."""
    if not value:
        return None
    cleaned = " ".join(without_contact_details(value).split())
    return cleaned[:limit].rstrip() or None


def notes_text(body: str | None) -> str | None:
    """HubSpot's internal notes (HTML) as plain text, contact details blanked, cut to
    `NOTES_CHARS`. None when empty."""
    text = plain(body)
    if text is None:
        return None
    text = without_contact_details(text)
    if len(text) > NOTES_CHARS:
        text = f"{text[: NOTES_CHARS - 3].rstrip()}..."
    return text


def names_a_place(location: str | None) -> bool:
    """Whether a location names a place: it holds no phone number ("Call Jo on 0412 345 678" is
    a phone call), and a word is left once links, email addresses, numbers and words like
    "call", "online" or "TBC" are taken out."""
    rest = LINK.sub(" ", EMAIL.sub(" ", location or ""))
    if PHONE.sub(_phone_like, rest) != rest:
        return False
    return any(word not in NOT_A_PLACE for word in WORD.findall(rest.lower()))


def where_of(
    location_type: str | None, location: str | None, external_url: str | None = None
) -> MeetingWhere:
    """online: HubSpot's type is VCE (a video call), or the location or the link names Teams,
    Meet or Zoom. in_person: the type is ADDRESS, or the location names a place. Otherwise
    unknown, a phone call (PHONE) included."""
    kind = (location_type or "").strip().upper()
    if kind == "VCE" or any(VIDEO.search(text or "") for text in (location, external_url)):
        return "online"
    if kind == "ADDRESS":
        return "in_person"
    if kind != "PHONE" and names_a_place(location):
        return "in_person"
    return "unknown"


def _id(value: str | None) -> str | None:
    """A HubSpot id: digits only, or None."""
    text = (value or "").strip()
    return text if text.isascii() and text.isdigit() and len(text) <= 32 else None


def _ids(values: Iterable[str | None], *, leave_out: str | None = None) -> list[str]:
    """HubSpot ids in order, each once, without `leave_out`, at most `MOST_PEOPLE`."""
    found = dict.fromkeys(key for key in map(_id, values) if key and key != leave_out)
    return list(found)[:MOST_PEOPLE]


def attendees(value: str | None, owner_id: str | None) -> list[str]:
    """`hs_attendee_owner_ids` as a list: HubSpot sends several owner ids as one text, split by
    ";". In order, each once, and without the meeting's own owner."""
    return _ids(re.split(r"[;,\s]+", value or ""), leave_out=owner_id)


def _moment(value: str | None) -> datetime | None:
    """HubSpot gives a moment as ISO text or as milliseconds."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        if text.isdigit():
            return datetime.fromtimestamp(int(text) / 1000, tz=UTC)
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def meeting_of(
    record: HubSpotObject,
    companies: Sequence[Association] = (),
    contacts: Sequence[Association] = (),
) -> Meeting | None:
    """One HubSpot meeting as we keep it, with its links. None without a start time: it can't be
    placed. The first company, as HubSpot lists them, is the meeting's (`more_companies` says
    there were others)."""
    starts_at = _moment(record.text(START))
    if starts_at is None:
        return None
    ends_at = _moment(record.text("hs_meeting_end_time"))
    owner_id = _id(record.text("hubspot_owner_id"))
    location = record.text("hs_meeting_location")
    company_ids = _ids(link.id for link in companies)
    outcome = record.text("hs_meeting_outcome")
    return Meeting(
        id=record.id,
        company_id=company_ids[0] if company_ids else None,
        more_companies=len(company_ids) > 1,
        contact_ids=_ids(link.id for link in contacts),
        owner_id=owner_id,
        attendee_owner_ids=attendees(record.text("hs_attendee_owner_ids"), owner_id),
        title=_line(record.text("hs_meeting_title"), TITLE_CHARS) or UNTITLED,
        starts_at=starts_at,
        ends_at=ends_at if ends_at is not None and ends_at >= starts_at else None,
        where=where_of(
            record.text("hs_meeting_location_type"),
            location,
            record.text("hs_meeting_external_url"),
        ),
        location=_line(location, LOCATION_CHARS),
        outcome=outcome[:OUTCOME_CHARS] if outcome else None,
        notes=notes_text(record.text("hs_internal_meeting_notes")),
        hubspot_url=record.url,
    )


def window(now: datetime) -> tuple[datetime, datetime]:
    """The meetings our copy keeps start in [start, end)."""
    return now - timedelta(days=DAYS_BACK), now + timedelta(days=DAYS_AHEAD)


# --- The reads: our copy only -------------------------------------------------------------------


def _out(row: HubSpotMeeting) -> Meeting:
    return Meeting.model_validate(
        {
            "id": row.hubspot_id,
            "company_id": row.hubspot_company_id,
            "contact_ids": list(row.contact_ids or []),
            "owner_id": row.owner_id,
            "title": row.title,
            "starts_at": row.starts_at,
            "ends_at": row.ends_at,
            "where": row.where,  # the table's check keeps it to the list
            "location": row.location,
            "outcome": row.outcome,
            "notes": row.notes,
            "hubspot_url": row.hubspot_url,
            "attendee_owner_ids": list(row.attendee_owner_ids or []),
            "more_companies": row.more_companies,
        }
    )


def _theirs(owner_id: str) -> ColumnElement[bool]:
    """The meetings an owner owns or is on."""
    return or_(
        HubSpotMeeting.owner_id == owner_id,
        literal(owner_id, String()) == any_(HubSpotMeeting.attendee_owner_ids),
    )


def _days(days: int) -> timedelta:
    return timedelta(days=max(0, min(days, 3_660)))


async def upcoming(
    session: AsyncSession, *, owner_id: str | None, days: int, now: datetime | None = None
) -> list[Meeting]:
    """The meetings that start in the next `days` days (from now, up to but not at the end),
    soonest first. With `owner_id`, only those that owner owns or is on; None: the team's."""
    moment = now or utc_now()
    query = select(HubSpotMeeting).where(
        HubSpotMeeting.starts_at >= moment, HubSpotMeeting.starts_at < moment + _days(days)
    )
    if owner_id is not None:
        query = query.where(_theirs(owner_id))
    rows = await session.scalars(
        query.order_by(HubSpotMeeting.starts_at, HubSpotMeeting.hubspot_id).limit(LIST_CAP)
    )
    return [_out(row) for row in rows]


async def past(
    session: AsyncSession, *, owner_id: str | None, days: int, now: datetime | None = None
) -> list[Meeting]:
    """The meetings that started in the last `days` days, newest first. With `owner_id`, only
    those that owner owns or is on; None: the team's."""
    moment = now or utc_now()
    query = select(HubSpotMeeting).where(
        HubSpotMeeting.starts_at >= moment - _days(days), HubSpotMeeting.starts_at < moment
    )
    if owner_id is not None:
        query = query.where(_theirs(owner_id))
    rows = await session.scalars(
        query.order_by(HubSpotMeeting.starts_at.desc(), HubSpotMeeting.hubspot_id).limit(LIST_CAP)
    )
    return [_out(row) for row in rows]


async def for_company(session: AsyncSession, company_id: str) -> list[Meeting]:
    """One company's meetings (the ones it is the first company of), newest first, at most
    `COMPANY_CAP`."""
    rows = await session.scalars(
        select(HubSpotMeeting)
        .where(HubSpotMeeting.hubspot_company_id == company_id)
        .order_by(HubSpotMeeting.starts_at.desc(), HubSpotMeeting.hubspot_id)
        .limit(COMPANY_CAP)
    )
    return [_out(row) for row in rows]


async def get(session: AsyncSession, meeting_id: str) -> Meeting | None:
    """One meeting, or None."""
    row = await session.scalar(
        select(HubSpotMeeting).where(HubSpotMeeting.hubspot_id == meeting_id)
    )
    return _out(row) if row is not None else None


async def _newest(session: AsyncSession, states: Collection[str]) -> HubSpotMeetingRead | None:
    return await session.scalar(
        select(HubSpotMeetingRead)
        .where(HubSpotMeetingRead.state.in_(states))
        .order_by(HubSpotMeetingRead.started_at.desc(), HubSpotMeetingRead.id.desc())
        .limit(1)
    )


def _key_set() -> bool:
    secret = get_settings().hubspot_service_key
    return secret is not None and bool(secret.get_secret_value().strip())


async def status(session: AsyncSession) -> MeetingsStatus:
    """ready once a read has worked: our copy is there, even if a later read failed. Before
    that: waiting, with the missing permission named, when the newest read hit one; off when no
    HubSpot key is set (nothing can read them); otherwise waiting, `NOT_READ_YET`. Each also
    says when the newest good read finished, whether a read runs now, and how the newest read
    ended (PLAN-V18 T1-5)."""
    good = await _newest(session, ("done",))
    newest = await _newest(session, ("done", "waiting", "failed"))
    more: dict[str, Any] = {
        "checked_at": good.finished_at if good is not None else None,
        "syncing": reading(),
        "last_read": newest.state if newest is not None else None,
    }
    if good is not None:
        return MeetingsStatus(state="ready", **more)
    if newest is not None and newest.state == "waiting":
        return MeetingsStatus(state="waiting", sentence=newest.sentence or WAITING, **more)
    if not _key_set():
        return MeetingsStatus(state="off", sentence=NO_HUBSPOT, **more)
    return MeetingsStatus(state="waiting", sentence=NOT_READ_YET, **more)


# --- Reading HubSpot (no database connection is held here) --------------------------------------


@dataclass
class _Found:
    """What one read found: the meetings in the window with when each last changed in HubSpot,
    the ids read that start outside it (or have no start), and any warnings."""

    meetings: list[tuple[Meeting, datetime | None]] = field(default_factory=list)
    outside: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class _TooManyChanges(Exception):
    """More changed than HubSpot's search can page through: the whole window is read instead."""


def _ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


async def _in_window(hubspot: HubSpot, start: datetime, end: datetime) -> list[HubSpotObject]:
    """Every meeting that starts in [start, end), soonest first. HubSpot's search stops at
    `SEARCH_RESULTS_CAP` results, so past that it searches again from the latest start it read
    (a meeting read twice is kept once)."""
    found: dict[str, HubSpotObject] = {}
    low, high = _ms(start), _ms(end)
    while True:
        filters = (Filter(START, "GTE", str(low)), Filter(START, "LT", str(high)))
        after: str | None = None
        read, latest = 0, low
        while True:
            page = await hubspot.search_objects(
                "meetings",
                filters=filters,
                properties=FIELDS,
                sort_by=START,
                after=after,
                limit=SEARCH_PAGE_SIZE,
            )
            for record in page.results:
                found[record.id] = record
                moment = _moment(record.text(START))
                if moment is not None:
                    latest = max(latest, _ms(moment))
            read += len(page.results)
            if page.after is None or not page.results:
                return list(found.values())
            if read + len(page.results) > SEARCH_RESULTS_CAP:
                break  # the next page is past what the search can list
            after = page.after
        if latest <= low:
            raise HubSpotError(TOO_MANY_TITLE, TOO_MANY_DETAIL)
        low = latest


async def _changed(hubspot: HubSpot, since: datetime) -> list[HubSpotObject]:
    """The meetings changed in HubSpot at or after `since`, wherever they start. Raises
    `_TooManyChanges` when there are more than HubSpot's search can page through."""
    filters = (Filter(MODIFIED, "GTE", str(_ms(since))),)
    found: dict[str, HubSpotObject] = {}
    after: str | None = None
    while True:
        page = await hubspot.search_objects(
            "meetings",
            filters=filters,
            properties=FIELDS,
            sort_by=MODIFIED,
            after=after,
            limit=SEARCH_PAGE_SIZE,
        )
        if page.total is not None and page.total > SEARCH_RESULTS_CAP:
            raise _TooManyChanges
        for record in page.results:
            found[record.id] = record
        if page.after is None or not page.results:
            return list(found.values())
        after = page.after


async def _links(
    hubspot: HubSpot, ids: Sequence[str], found: _Found
) -> tuple[Mapping[str, Sequence[Association]], Mapping[str, Sequence[Association]]]:
    """Each meeting's companies and people. Without access to contacts the meetings are kept
    without their people, with a warning. Any other refusal is a failed read: only the meetings
    search's own missing permission means "waiting for meetings"."""
    if not ids:
        return {}, {}
    try:
        companies = await hubspot.linked("meetings", "companies", ids)
    except HubSpotMissingScope as error:
        raise HubSpotError(error.title, error.detail) from error
    try:
        contacts = await hubspot.linked("meetings", "contacts", ids)
    except HubSpotMissingScope:
        found.warnings.append(NO_PEOPLE_LINKS)
        contacts = {}
    return companies, contacts


async def _read_hubspot(
    hubspot: HubSpot, kind: ReadKind, *, now: datetime, since: datetime | None
) -> _Found:
    """What one read finds in HubSpot. Raises `HubSpotMissingScope` when the key can't search
    meetings, `_TooManyChanges`, and `HubSpotError` for any other refusal."""
    start, end = window(now)
    if kind == "full":
        records = await _in_window(hubspot, start, end)
    else:
        if since is None:
            raise ValueError("a changes read needs the time to read changes from")
        records = await _changed(hubspot, since)
    found = _Found()
    inside: list[HubSpotObject] = []
    for record in records:
        moment = _moment(record.text(START))
        if moment is not None and start <= moment < end:
            inside.append(record)
        else:
            found.outside.append(record.id)
    companies, contacts = await _links(hubspot, [record.id for record in inside], found)
    for record in inside:
        meeting = meeting_of(record, companies.get(record.id, ()), contacts.get(record.id, ()))
        if meeting is not None:
            updated = record.updated_at or _moment(record.text(MODIFIED))
            found.meetings.append((meeting, updated))
    return found


# --- Saving our copy ----------------------------------------------------------------------------

# The columns a change is looked for in: a meeting HubSpot sent again unchanged isn't counted.
COMPARED = (
    "hubspot_company_id",
    "more_companies",
    "contact_ids",
    "owner_id",
    "attendee_owner_ids",
    "title",
    "starts_at",
    "ends_at",
    "where",
    "location",
    "outcome",
    "notes",
    "hubspot_url",
    "hubspot_updated_at",
)


def _values(meeting: Meeting, updated_at: datetime | None) -> dict[str, Any]:
    return {
        "hubspot_id": meeting.id,
        "hubspot_company_id": meeting.company_id,
        "more_companies": meeting.more_companies,
        "contact_ids": meeting.contact_ids,
        "owner_id": meeting.owner_id,
        "attendee_owner_ids": meeting.attendee_owner_ids,
        "title": meeting.title,
        "starts_at": meeting.starts_at,
        "ends_at": meeting.ends_at,
        "where": meeting.where,
        "location": meeting.location,
        "outcome": meeting.outcome,
        "notes": meeting.notes,
        "hubspot_url": meeting.hubspot_url,
        "hubspot_updated_at": updated_at,
    }


def _id_array(name: str, ids: Collection[str]) -> BindParameter[Any]:
    """A list of ids sent as ONE Postgres array, however many there are."""
    text_array: Any = ARRAY(String())  # SQLAlchemy's stubs type ARRAY by its item, not the list
    return bindparam(name, value=list(ids), type_=text_array)


async def _upsert(
    session: AsyncSession, meetings: Sequence[tuple[Meeting, datetime | None]]
) -> int:
    """Adds or updates meetings in our copy. Returns how many were new or changed."""
    table = HubSpotMeeting.__table__
    changed = 0
    for begin in range(0, len(meetings), SAVE_CHUNK):
        chunk = [
            _values(meeting, updated) for meeting, updated in meetings[begin : begin + SAVE_CHUNK]
        ]
        adding = insert(HubSpotMeeting).values(chunk)
        theirs = adding.excluded
        statement = adding.on_conflict_do_update(
            index_elements=[table.c.hubspot_id],
            set_={name: theirs[name] for name in COMPARED} | {"imported_at": func.now()},
            # Only a real change is written and counted: HubSpot sends unchanged ones again.
            where=tuple_(*(table.c[name] for name in COMPARED)).is_distinct_from(
                tuple_(*(theirs[name] for name in COMPARED))
            ),
        ).returning(table.c.hubspot_id)
        changed += len((await session.execute(statement)).all())
    return changed


async def _remove(
    session: AsyncSession, *, keep: Collection[str] | None, drop: Collection[str]
) -> int:
    """Removes meetings from our copy: every one not in `keep` (a full read), or those in
    `drop`. Returns how many went."""
    if keep is not None:
        condition = HubSpotMeeting.hubspot_id != all_(_id_array("keep", keep))
    elif drop:
        condition = HubSpotMeeting.hubspot_id == any_(_id_array("drop", drop))
    else:
        return 0
    result = await session.execute(
        delete(HubSpotMeeting).where(condition).returning(HubSpotMeeting.hubspot_id)
    )
    return len(result.all())


@dataclass(frozen=True)
class _Outcome:
    state: ReadState
    sentence: str | None = None
    changed: int = 0
    warnings: tuple[str, ...] = ()


async def _add_read(
    session: AsyncSession,
    kind: ReadKind,
    outcome: _Outcome,
    *,
    started: datetime,
    finished: datetime,
) -> None:
    """Saves the read's row in the session's transaction, and drops rows older than
    `KEEP_READS`, except the newest good one (it says our copy is there). The caller commits."""
    session.add(
        HubSpotMeetingRead(
            kind=kind,
            state=outcome.state,
            sentence=outcome.sentence,
            changed=outcome.changed,
            started_at=started,
            finished_at=finished,
        )
    )
    await session.flush()
    newest_good = (
        select(HubSpotMeetingRead.id)
        .where(HubSpotMeetingRead.state == "done")
        .order_by(HubSpotMeetingRead.started_at.desc(), HubSpotMeetingRead.id.desc())
        .limit(1)
        .scalar_subquery()
    )
    await session.execute(
        delete(HubSpotMeetingRead).where(
            HubSpotMeetingRead.started_at < finished - KEEP_READS,
            HubSpotMeetingRead.id.is_distinct_from(newest_good),
        )
    )


async def _note(
    sessions: async_sessionmaker[AsyncSession],
    kind: ReadKind,
    outcome: _Outcome,
    *,
    started: datetime,
    clock: Clock,
) -> None:
    """Saves a read that saved nothing. A failure here only costs the row: it is logged."""
    try:
        async with sessions() as session:
            await _add_read(session, kind, outcome, started=started, finished=clock())
            await session.commit()
    except Exception as error:
        log.warning("hubspot_meetings_read_not_noted", extra={"error": type(error).__name__})


async def _save(
    sessions: async_sessionmaker[AsyncSession],
    found: _Found,
    kind: ReadKind,
    *,
    started: datetime,
    clock: Clock,
) -> _Outcome:
    """Saves what a read found, and its row, in one transaction, taking turns with any other
    save. A full read replaces our copy; a changes read adds and updates, and removes the ones
    now outside the window."""
    async with sessions() as session:
        await session.execute(select(func.pg_advisory_xact_lock(MEETINGS_LOCK)))
        changed = await _upsert(session, found.meetings)
        if kind == "full":
            kept = [meeting.id for meeting, _ in found.meetings]
            changed += await _remove(session, keep=kept, drop=())
        else:
            changed += await _remove(session, keep=None, drop=found.outside)
        warnings = tuple(found.warnings)
        outcome = _Outcome("done", warnings[0] if warnings else None, changed, warnings)
        await _add_read(session, kind, outcome, started=started, finished=clock())
        await session.commit()
    return outcome


# The reads of HubSpot's meetings running in this backend (and Syncs about to start one), so
# `reading` can say one runs. One backend runs for a database, so this is all of them.
_running: set[object] = set()


def reading() -> bool:
    """True while a read of HubSpot's meetings runs in this backend: the daily one, a refresh, or
    a Sync (from the moment it is started)."""
    return bool(_running)


async def _read(
    sessions: async_sessionmaker[AsyncSession],
    hubspot: HubSpot,
    kind: ReadKind,
    *,
    since: datetime | None,
    clock: Clock,
) -> _Outcome:
    """One read, from HubSpot to our copy, and its row. Never raises, except for a cancel. While
    it runs, `reading` says so."""
    token = object()
    _running.add(token)
    try:
        return await _read_once(sessions, hubspot, kind, since=since, clock=clock)
    finally:
        _running.discard(token)


async def _read_once(
    sessions: async_sessionmaker[AsyncSession],
    hubspot: HubSpot,
    kind: ReadKind,
    *,
    since: datetime | None,
    clock: Clock,
) -> _Outcome:
    started = clock()
    try:
        try:
            found = await _read_hubspot(hubspot, kind, now=started, since=since)
        except _TooManyChanges:
            kind = "full"
            found = await _read_hubspot(hubspot, kind, now=started, since=None)
    except HubSpotMissingScope:
        outcome = _Outcome("waiting", WAITING, warnings=(WAITING,))
    except HubSpotError as error:
        log.warning("hubspot_meetings_not_read", extra={"kind": kind, "reason": error.title})
        line = f"Meetings weren't copied: {error.title}."
        outcome = _Outcome("failed", line, warnings=(line,))
    except Exception as error:
        # The kind of error only: its text could quote a meeting.
        log.warning(
            "hubspot_meetings_not_read", extra={"kind": kind, "error": type(error).__name__}
        )
        outcome = _Outcome("failed", MEETINGS_FAILED, warnings=(MEETINGS_FAILED,))
    else:
        try:
            outcome = await _save(sessions, found, kind, started=started, clock=clock)
        except Exception as error:
            log.warning(
                "hubspot_meetings_not_saved", extra={"kind": kind, "error": type(error).__name__}
            )
            outcome = _Outcome("failed", MEETINGS_FAILED, warnings=(MEETINGS_FAILED,))
        else:
            log.info(
                "hubspot_meetings_read",
                extra={
                    "kind": kind,
                    "meetings": len(found.meetings),
                    "changed": outcome.changed,
                    "warnings": len(outcome.warnings),
                },
            )
            return outcome
    await _note(sessions, kind, outcome, started=started, clock=clock)
    return outcome


# --- The daily read, and a refresh ----------------------------------------------------------------


async def copy_meetings(
    sessions: async_sessionmaker[AsyncSession], hubspot: HubSpot, *, clock: Clock = utc_now
) -> list[str]:
    """The daily read, in the sync's "people" phase: every meeting in the window, and our copy
    replaced. Returns the warnings for the sync row: none when it worked. It never fails the
    sync: only a cancel goes on up from here."""
    return list((await _read(sessions, hubspot, "full", since=None, clock=clock)).warnings)


_refreshing = asyncio.Lock()  # never waited on: a second refresh while one runs returns 0


async def refresh(
    sessions: async_sessionmaker[AsyncSession], hubspot: HubSpot, *, clock: Clock = utc_now
) -> int:
    """Reads the meetings changed in HubSpot since the last good read started (less `OVERLAP`),
    and says how many changed in our copy. With no good read yet, the whole window is read.

    At most once every `REFRESH_EVERY`: within that time of the last read that asked HubSpot
    (the daily one, a Sync or a refresh, whatever its result) it returns 0 without asking
    HubSpot. While another refresh, or any other read, runs in this backend, it returns 0 at
    once. `clock` is for tests."""
    if _refreshing.locked() or reading():
        return 0
    async with _refreshing:
        now = clock()
        async with sessions() as session:
            asked = await _newest(session, ("done", "waiting", "failed"))
            good = await _newest(session, ("done",))
        if asked is not None and now - asked.started_at < REFRESH_EVERY:
            return 0
        if good is None:
            outcome = await _read(sessions, hubspot, "full", since=None, clock=clock)
        else:
            since = good.started_at - OVERLAP
            outcome = await _read(sessions, hubspot, "changes", since=since, clock=clock)
        return outcome.changed


class MeetingsRefresher:
    """Runs `refresh` in the background for one backend (`connection.refresh_meetings_soon`):
    one at a time, a check at most every `ASK_EVERY` seconds, and stopped when the backend stops.
    The 15-minute rule itself is `refresh`'s, in the database. It also runs Sync on Meetings
    (`sync_now`, PLAN-V18 T1-5). `hubspot` makes a client (None when there is no key), which is
    closed after each read. `clock` and `monotonic` are for tests."""

    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        hubspot: Callable[[], HubSpot | None],
        clock: Clock = utc_now,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._sessions = sessions
        self._hubspot = hubspot
        self._clock = clock
        self._monotonic = monotonic
        self._task: asyncio.Task[None] | None = None
        self._sync: asyncio.Task[None] | None = None
        self._asked_at: float | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def syncing(self) -> bool:
        """A Sync this refresher started is still running."""
        return self._sync is not None and not self._sync.done()

    async def sync_now(self) -> SyncAnswer:
        """Sync on Meetings: a full read of the window now, in the background, answered at once.
        `running` while any read runs in this backend (nothing new starts), `fresh` when the
        newest read is a good one that finished under `SYNC_FRESH` ago (HubSpot isn't asked),
        else `started`. Raises `LookupError` when there is no HubSpot key."""
        async with self._sessions() as session:
            good = await _newest(session, ("done",))
            newest = await _newest(session, ("done", "waiting", "failed"))
        checked_at = good.finished_at if good is not None else None
        # No await from here to the task's start, so two presses at once start one read.
        if reading() or self.syncing:
            return SyncAnswer("running", checked_at)
        if (
            good is not None
            and newest is not None
            and newest.id == good.id
            and self._clock() - good.finished_at < SYNC_FRESH
        ):
            return SyncAnswer("fresh", checked_at)
        client = self._hubspot()
        if client is None:
            raise LookupError("no HubSpot key")
        token = object()
        _running.add(token)  # `reading` says so from now, before the task first runs
        task = asyncio.create_task(self._run_sync(client), name="hubspot-meetings-sync")
        task.add_done_callback(lambda _: _running.discard(token))
        self._sync = task
        return SyncAnswer("started", checked_at)

    async def _run_sync(self, client: HubSpot) -> None:
        began = time.monotonic()
        try:
            outcome = await _read(self._sessions, client, "full", since=None, clock=self._clock)
            # Counts and times only: never a meeting's title.
            log.info(
                "hubspot_meetings_synced",
                extra={
                    "state": outcome.state,
                    "changed": outcome.changed,
                    "seconds": round(time.monotonic() - began, 1),
                },
            )
        except Exception as error:
            log.warning("hubspot_meetings_sync_failed", extra={"error": type(error).__name__})
        finally:
            with contextlib.suppress(Exception):
                await client.aclose()

    def soon(self) -> bool:
        """Starts a refresh in the background and answers at once. True when one started; False
        while one runs, or within `ASK_EVERY` seconds of the last start. Needs a running event
        loop (a request has one)."""
        if self.running:
            return False
        moment = self._monotonic()
        if self._asked_at is not None and moment - self._asked_at < ASK_EVERY:
            return False
        self._asked_at = moment
        self._task = asyncio.create_task(self._run(), name="hubspot-meetings-refresh")
        return True

    async def _run(self) -> None:
        client: HubSpot | None = None
        try:
            client = self._hubspot()
            if client is not None:
                changed = await refresh(self._sessions, client, clock=self._clock)
                log.info("hubspot_meetings_refreshed", extra={"changed": changed})
        except Exception as error:
            log.warning("hubspot_meetings_refresh_failed", extra={"error": type(error).__name__})
        finally:
            if client is not None:
                with contextlib.suppress(Exception):
                    await client.aclose()

    async def wait(self) -> None:
        """Waits for the running refresh and Sync, if any, to end (for tests and the command
        line)."""
        tasks = {task for task in (self._task, self._sync) if task is not None}
        if tasks:
            await asyncio.wait(tasks)

    async def stop(self) -> None:
        """Stops a running refresh and Sync: a save that had started is rolled back."""
        tasks = [task for task in (self._task, self._sync) if task is not None]
        self._task = self._sync = None
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
