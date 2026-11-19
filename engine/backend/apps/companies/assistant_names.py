"""The mic's hint list (PLAN-V23 T1-1, choice 1): the names this person is most likely to say,
for the speech service's hints and for fixing a misheard name on every page. The route is in
api_assistant.py.

**Most likely first,** at most `name_hints_max` (50, TBC after S1), each name once:
1. the company on screen, its people, its open deals' client names and its next meeting's
   people;
2. my meetings today and tomorrow (their companies and people), and my tasks due (their
   companies, as Today last read them);
3. the companies I called in the last 30 days (my call notes and my calls in HubSpot), the most
   recent first, then the companies I own;
4. my teammates (those with a Contour account first);
5. the companies the mic gets wrong (they have learned names), then the fixed words: fitout,
   test fit, pre-read and follow up.

A company is said without Pty Ltd and the like ("Sample Logistics"). A name with an email address
or a phone number in it is left out.

**Free and quick:** it reads our copy, Today's kept tasks and the learned names, and never asks
HubSpot. Each list is kept for 5 minutes for each person and company on screen, in memory, at
most 500 lists (the oldest go first), so it starts again when the backend restarts. Another rep's
companies stay out unless I called them. Log lines hold counts only.
"""

import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import learned_store
from apps.companies.assistant import person_key
from apps.companies.assistant_find import ahead, company_hit
from apps.companies.assistant_schemas import AssistantName, AssistantNames, NameKind
from apps.companies.deals import stage_kind
from apps.companies.facts import scrub
from apps.companies.meeting_store import (
    MeetingSource,
    cancelled,
    company_names,
    list_team,
    my_owner,
)
from apps.companies.notes import MELBOURNE
from apps.companies.store import people_of
from apps.companies.tables import CallNote
from apps.companies.today import TaskCopy
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads
from core.config import Settings
from core.hubspot.matching import LEGAL_WORDS, deal_lead
from core.hubspot.meetings import Meeting
from core.hubspot.models import HubSpotCall, HubSpotCompany, HubSpotContact, HubSpotDeal
from core.hubspot.profiles import PLACEHOLDER_NAME

log = logging.getLogger(__name__)

KEEP_FOR: Final = timedelta(minutes=5)  # a list is kept this long (choice 1)
CACHE_MAX: Final = 500  # the most lists kept at once, for every person and page
SCREEN_PEOPLE: Final = 10  # the screen company's people, the most recently in touch first
MEETING_PEOPLE: Final = 5  # the people on one meeting
MEETING_DAYS_READ: Final = 3  # read ahead, then only today and tomorrow (Melbourne) are kept
CALLED_DAYS: Final = 30  # the companies I called in this many days
CALLED_MAX: Final = 25
OWNED_MAX: Final = 25
LEARNED_MAX: Final = 20
NAME_CHARS: Final = 120  # a longer name is no use as a hint
FIXED_WORDS: Final = ("fitout", "test fit", "pre-read", "follow up")
EDGES: Final = " ,.;:-"


# --- The names, as said --------------------------------------------------------------------------


def spoken(name: str) -> str:
    """A company's name as a rep says it: without Pty Ltd, Limited and the like at its end.
    "Sample Logistics Pty. Ltd." is "Sample Logistics". A name of only those words stays."""
    words = name.split()
    while words and words[-1].casefold().strip(".,()") in LEGAL_WORDS:
        words.pop()
    said = " ".join(words).strip(EDGES)
    return said or " ".join(name.split())


@dataclass
class Picker:
    """The list as it grows: each name once (any case), at most `most`."""

    most: int
    names: list[AssistantName] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)

    @property
    def full(self) -> bool:
        return len(self.names) >= self.most

    def add(self, text: str | None, kind: NameKind, company_key: str | None = None) -> None:
        if self.full or not text:
            return
        said = spoken(text) if kind == "company" else " ".join(text.split())
        if not said or len(said) > NAME_CHARS or scrub(said) != said:
            return  # no contact details in a hint
        if said.casefold() in self.seen:
            return
        self.seen.add(said.casefold())
        self.names.append(AssistantName(text=said, kind=kind, company_key=company_key))


# --- Kept for 5 minutes --------------------------------------------------------------------------

type HintKey = tuple[str, str]  # (the person, the company on screen or "")


class HintCache:
    """Each person's hint list for each company on screen, kept for 5 minutes, in memory and
    bounded: at most `most` lists, the oldest dropped first. It lives on `app.state.name_hints`;
    a test puts its own."""

    def __init__(self, keep_for: timedelta = KEEP_FOR, most: int = CACHE_MAX) -> None:
        self.keep_for = keep_for
        self.most = most
        self._kept: dict[HintKey, tuple[datetime, AssistantNames]] = {}

    def get(self, key: HintKey, now: datetime) -> AssistantNames | None:
        found = self._kept.get(key)
        if found is None:
            return None
        made, names = found
        if not made <= now < made + self.keep_for:
            del self._kept[key]
            return None
        return names

    def put(self, key: HintKey, names: AssistantNames, now: datetime) -> None:
        self._kept.pop(key, None)  # a list made again goes to the back
        self._kept[key] = (now, names)
        while len(self._kept) > self.most:
            del self._kept[next(iter(self._kept))]

    def __len__(self) -> int:
        return len(self._kept)


# --- Reading our copy ----------------------------------------------------------------------------


async def contact_names(session: AsyncSession, ids: Sequence[str]) -> list[str]:
    """These HubSpot contacts' names, in this order."""
    wanted = list(dict.fromkeys(ids))
    if not wanted:
        return []
    rows = await session.execute(
        select(HubSpotContact.hubspot_id, HubSpotContact.name).where(
            HubSpotContact.hubspot_id.in_(wanted)
        )
    )
    found = {key: name for key, name in rows.all()}
    return [found[key] for key in wanted if key in found]


async def open_deal_clients(session: AsyncSession, company_key: str) -> list[str]:
    """The client names at the start of the company's open deals' names ("Sample Logistics -
    Perth - New Office" gives Sample Logistics)."""
    rows = await session.execute(
        select(HubSpotDeal.name, HubSpotDeal.stage)
        .where(HubSpotDeal.hubspot_company_id == company_key)
        .order_by(HubSpotDeal.close_date.desc().nulls_last(), HubSpotDeal.hubspot_deal_id)
    )
    return [deal_lead(name) for name, stage in rows.all() if stage_kind(stage) == "open"]


def melbourne_day(moment: datetime) -> date:
    return moment.astimezone(MELBOURNE).date()


async def screen_names(
    session: AsyncSession,
    picker: Picker,
    company_key: str,
    *,
    leads: Sequence[CompanyLeads],
    source: MeetingSource,
    now: datetime,
) -> None:
    """1. The company on screen, its people, its open deals' clients and its next meeting's
    people."""
    hit = await company_hit(session, company_key, leads)
    if hit is None:
        return
    picker.add(hit.name, "company", hit.key)
    if hit.source != "hubspot":
        return
    for person in (await people_of(session, hit.key))[:SCREEN_PEOPLE]:
        picker.add(person.name, "person", hit.key)
    for client in await open_deal_clients(session, hit.key):
        picker.add(client, "company", hit.key)
    if (await source.status(session)).state != "ready":
        return
    coming = ahead(await source.for_company(session, hit.key), now)
    if coming:
        for name in await contact_names(session, coming[0].contact_ids[:MEETING_PEOPLE]):
            picker.add(name, "person", hit.key)


async def day_names(
    session: AsyncSession,
    picker: Picker,
    me: str,
    *,
    source: MeetingSource,
    copy: TaskCopy,
    now: datetime,
) -> None:
    """2. My meetings today and tomorrow, and my tasks due as Today last read them (no HubSpot
    request)."""
    meetings: list[Meeting] = []
    if (await source.status(session)).state == "ready":
        today = melbourne_day(now)
        days = {today, today + timedelta(days=1)}
        read = [
            *await source.past(session, owner_id=me, days=1),
            *await source.upcoming(session, owner_id=me, days=MEETING_DAYS_READ),
        ]
        meetings = sorted(
            (m for m in read if not cancelled(m) and melbourne_day(m.starts_at) in days),
            key=lambda meeting: meeting.starts_at,
        )
    tasks = sorted(copy.held(me), key=lambda task: task.due_at)
    names = await company_names(
        session, [*(m.company_id for m in meetings), *(t.company_id for t in tasks)]
    )
    for meeting in meetings:
        if meeting.company_id in names:
            picker.add(names[meeting.company_id], "company", meeting.company_id)
            for name in await contact_names(session, meeting.contact_ids[:MEETING_PEOPLE]):
                picker.add(name, "person", meeting.company_id)
    for task in tasks:
        if task.company_id is not None and task.company_id in names:
            picker.add(names[task.company_id], "company", task.company_id)


async def called_companies(
    session: AsyncSession,
    *,
    auth: AuthContext | None,
    me: str | None,
    leads: Sequence[CompanyLeads],
    since: datetime,
) -> list[tuple[str, str]]:
    """The companies I called since then, the most recent call first: (key, name). From my call
    notes (a Lead Finder company only with its tick) and my calls in HubSpot."""
    called: dict[str, tuple[datetime, str | None]] = {}
    if auth is not None:
        notes = await session.execute(
            select(
                CallNote.company_key, func.max(CallNote.called_at), func.max(CallNote.company_name)
            )
            .where(CallNote.made_by == auth.user.id, CallNote.called_at >= since)
            .group_by(CallNote.company_key)
            .order_by(func.max(CallNote.called_at).desc())
            .limit(CALLED_MAX)
        )
        for key, when, name in notes.all():
            if key.startswith("lead:") and not leads:
                continue  # a Lead Finder company, for someone without its tick now
            called[key] = (when, name if key.startswith("lead:") else None)
    if me is not None:
        calls = await session.execute(
            select(HubSpotCall.hubspot_company_id, func.max(HubSpotCall.called_at))
            .where(
                HubSpotCall.owner_id == me,
                HubSpotCall.called_at >= since,
                HubSpotCall.hubspot_company_id.is_not(None),
            )
            .group_by(HubSpotCall.hubspot_company_id)
            .order_by(func.max(HubSpotCall.called_at).desc())
            .limit(CALLED_MAX)
        )
        for company_id, latest in calls.all():
            if company_id is None or latest is None:
                continue
            known = called.get(company_id)
            if known is None or known[0] < latest:
                called[company_id] = (latest, None)
    ordered = sorted(called.items(), key=lambda item: item[1][0], reverse=True)[:CALLED_MAX]
    names = await company_names(session, (key for key, _ in ordered))
    found: list[tuple[str, str]] = []
    for key, (_, lead_name) in ordered:
        shown = lead_name if key.startswith("lead:") else names.get(key)
        if shown:
            found.append((key, shown))
    return found


async def owned_companies(session: AsyncSession, me: str) -> list[tuple[str, str]]:
    """The companies I own in HubSpot, the most recent activity first: (key, name)."""
    rows = await session.execute(
        select(HubSpotCompany.hubspot_id, HubSpotCompany.name)
        .where(
            HubSpotCompany.owner_id == me,
            func.lower(func.btrim(HubSpotCompany.name)) != PLACEHOLDER_NAME,
        )
        .order_by(
            HubSpotCompany.last_activity.desc().nulls_last(),
            HubSpotCompany.name,
            HubSpotCompany.hubspot_id,
        )
        .limit(OWNED_MAX)
    )
    return [(key, name) for key, name in rows.all()]


async def team_names(session: AsyncSession, picker: Picker, auth: AuthContext | None) -> None:
    """4. My teammates, those with a Contour account first. Not me."""
    try:
        team = await list_team(session, auth)
    except Problem:  # the team list couldn't be read: the rest still goes
        await session.rollback()
        return
    for member in sorted(team, key=lambda member: not member.has_account):
        if not member.is_me:
            picker.add(member.name, "teammate")


async def learned_names(
    session: AsyncSession, picker: Picker, leads: Sequence[CompanyLeads]
) -> None:
    """5. The companies the mic gets wrong: they have learned names, the most taught first."""
    for key in await learned_store.taught_companies(session, LEARNED_MAX):
        if picker.full:
            return
        hit = await company_hit(session, key, leads)
        if hit is not None:
            picker.add(hit.name, "company", hit.key)


def add_all(picker: Picker, found: Iterable[tuple[str, str]]) -> None:
    for key, name in found:
        picker.add(name, "company", key)


# --- The list ------------------------------------------------------------------------------------


async def hint_list(
    session: AsyncSession,
    *,
    auth: AuthContext | None,
    settings: Settings,
    company_key: str | None,
    leads: Sequence[CompanyLeads],
    source: MeetingSource,
    copy: TaskCopy,
    hints: HintCache,
    now: datetime,
) -> AssistantNames:
    """This person's hint list for the company on screen: kept, or made now from our copy."""
    screen = (company_key or "").strip()
    key: HintKey = (person_key(auth), screen)
    kept = hints.get(key, now)
    if kept is not None:
        return kept
    picker = Picker(most=settings.name_hints_max)
    if screen:
        await screen_names(session, picker, screen, leads=leads, source=source, now=now)
    me = await my_owner(session, auth, source)
    if me is not None and not picker.full:
        await day_names(session, picker, me, source=source, copy=copy, now=now)
    if not picker.full:
        since = now - timedelta(days=CALLED_DAYS)
        add_all(picker, await called_companies(session, auth=auth, me=me, leads=leads, since=since))
    if me is not None and not picker.full:
        add_all(picker, await owned_companies(session, me))
    if not picker.full:
        await team_names(session, picker, auth)
    if not picker.full:
        await learned_names(session, picker, leads)
    for word in FIXED_WORDS:
        picker.add(word, "word")
    if session.in_transaction():
        await session.rollback()  # it only read
    names = AssistantNames(names=picker.names)
    hints.put(key, names, now)
    log.info("assistant_names", extra={"names": len(names.names), "screen": bool(screen)})
    return names
