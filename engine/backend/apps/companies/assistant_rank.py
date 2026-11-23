"""Which of several matches is likely (PLAN-V25 T1-1, choices 1 to 4), by code on our HubSpot
copy: no Claude request.

Each match gets its signals, and they put it in order, strongest first (choice 2, TBC):

1. **On screen** and **a learned name** are settled before the ranking (assistant_find.py).
2. **A meeting** with the rep today or tomorrow (Melbourne).
3. **Yours:** the rep owns the company in HubSpot.
4. **Called** by the rep in the last 30 days.
5. **An open deal.**
6. Then HubSpot's last contacted date, newest first, and then how close the name is (the order
   the matches came in).

From the order comes the level (choice 1):

- **sure:** the card uses it at once, with Change and Undo. Here: one match, or the only match
  that is the rep's own (with nothing stronger on another). On screen and a learned name are sure
  too, before any ranking.
- **likely:** one suggestion with its reason. The top match has a signal no other match has.
- **unsure:** up to 3 choices, plus Search.

Each match carries one reason, its strongest signal in plain words ("You meet them at 2 pm.",
choice 3), and one detail that tells it apart from the others: the city, else the owner, else
the last call (choice 4).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant_schemas import AssistantChoice, AssistantPersonHit, Level
from apps.companies.deals import CLOSED_STAGES
from apps.companies.meeting_store import MeetingSource, cancelled
from apps.companies.notes import MELBOURNE
from apps.companies.schemas import CompanyHit
from core.hubspot.models import HubSpotCall, HubSpotCompany, HubSpotContact, HubSpotDeal

CHOICES_SHOWN: Final = 3  # at most 3 choices, plus Search (choice 4)
CALLED_DAYS: Final = 30  # "called by the rep in the last 30 days" (choice 2)
MEETING_DAYS: Final = 2  # today and tomorrow

# The signals that can make a match likely, strongest first. Their place is their strength.
MEETING: Final = 0
MINE: Final = 1
CALLED: Final = 2
OPEN_DEAL: Final = 3
NO_SIGNAL: Final = 9


# --- Who asks ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Asker:
    """Who asks and when: the rep's HubSpot owner (None: sign-in off, or not linked) and now."""

    owner_id: str | None
    now: datetime
    today: date  # Melbourne's
    meetings: MeetingSource | None = None  # None: meetings aren't read


# --- The words -----------------------------------------------------------------------------------

ON_SCREEN = "On screen."
LEARNED = "Picked for these words before."
MINE_WORDS = "Yours."
OPEN_DEAL_WORDS = "Open deal."


def clock(moment: datetime) -> str:
    """'2 pm', or '2:30 pm', in Melbourne time."""
    local = moment.astimezone(MELBOURNE)
    hour = local.hour % 12 or 12
    half = "am" if local.hour < 12 else "pm"
    return f"{hour} {half}" if local.minute == 0 else f"{hour}:{local.minute:02d} {half}"


def meeting_words(starts_at: datetime, today: date) -> str:
    """'You meet them at 2 pm.', or 'You meet them tomorrow at 2 pm.'"""
    day = starts_at.astimezone(MELBOURNE).date()
    when = "" if day == today else "tomorrow "
    return f"You meet them {when}at {clock(starts_at)}."


def day_said(day: date, today: date) -> str:
    """'today', 'yesterday', 'on Tuesday' (in the last week) or 'on 3 Nov'."""
    if day == today:
        return "today"
    if day == today - timedelta(days=1):
        return "yesterday"
    if today - day < timedelta(days=7):
        return f"on {day:%A}"
    return f"on {day.day} {day:%b}"


def called_words(called_at: datetime, today: date, *, whom: str = "them") -> str:
    """'You called them on Tuesday.'"""
    return f"You called {whom} {day_said(called_at.astimezone(MELBOURNE).date(), today)}."


def last_call_words(called_at: datetime | None, today: date) -> str:
    """A choice's detail when the city and the owner don't tell it apart."""
    if called_at is None:
        return "No calls yet"
    day = called_at.astimezone(MELBOURNE).date()
    return f"Last call {day.day} {day:%b}" + ("" if day.year == today.year else f" {day.year}")


# --- One company's signals -----------------------------------------------------------------------


@dataclass
class Signals:
    meeting_at: datetime | None = None  # the rep's next meeting with them, today or tomorrow
    mine: bool = False
    called_at: datetime | None = None  # the rep's last call to them, in the last 30 days
    open_deal: bool = False
    last_contacted: date | None = None
    owner: str | None = None
    last_call: datetime | None = None  # anyone's

    def strongest(self) -> int:
        if self.meeting_at is not None:
            return MEETING
        if self.mine:
            return MINE
        if self.called_at is not None:
            return CALLED
        if self.open_deal:
            return OPEN_DEAL
        return NO_SIGNAL

    def has(self, signal: int) -> bool:
        return {
            MEETING: self.meeting_at is not None,
            MINE: self.mine,
            CALLED: self.called_at is not None,
            OPEN_DEAL: self.open_deal,
        }.get(signal, False)

    def reason(self, today: date) -> str | None:
        signal = self.strongest()
        if signal == MEETING and self.meeting_at is not None:
            return meeting_words(self.meeting_at, today)
        if signal == MINE:
            return MINE_WORDS
        if signal == CALLED and self.called_at is not None:
            return called_words(self.called_at, today)
        if signal == OPEN_DEAL:
            return OPEN_DEAL_WORDS
        return None

    def order(self) -> tuple[bool, bool, bool, bool, int]:
        """The sort key, strongest first: the four signals, then last contacted, newest first."""
        contacted = -self.last_contacted.toordinal() if self.last_contacted is not None else 0
        return (
            self.meeting_at is None,
            not self.mine,
            self.called_at is None,
            not self.open_deal,
            contacted,
        )


async def meetings_soon(asker: Asker, session: AsyncSession) -> dict[str, datetime]:
    """Each company the rep meets today or tomorrow, with the first such meeting's start."""
    if asker.owner_id is None or asker.meetings is None:
        return {}
    found = await asker.meetings.upcoming(session, owner_id=asker.owner_id, days=MEETING_DAYS)
    days = {asker.today, asker.today + timedelta(days=1)}
    soon: dict[str, datetime] = {}
    for meeting in found:
        if not meeting.company_id or cancelled(meeting):
            continue
        if meeting.starts_at.astimezone(MELBOURNE).date() not in days:
            continue
        first = soon.get(meeting.company_id)
        if first is None or meeting.starts_at < first:
            soon[meeting.company_id] = meeting.starts_at
    return soon


async def signals_of(
    session: AsyncSession, keys: Sequence[str], asker: Asker
) -> dict[str, Signals]:
    """The signals of these HubSpot companies, read from our copy in four small queries."""
    wanted = list(dict.fromkeys(key for key in keys if not key.startswith("lead:")))
    found: dict[str, Signals] = {key: Signals() for key in keys}
    if not wanted:
        return found
    rows = await session.execute(
        select(
            HubSpotCompany.hubspot_id,
            HubSpotCompany.owner_id,
            HubSpotCompany.owner,
            HubSpotCompany.last_contacted,
        ).where(HubSpotCompany.hubspot_id.in_(wanted))
    )
    for key, owner_id, owner, contacted in rows.all():
        found[key].mine = asker.owner_id is not None and owner_id == asker.owner_id
        found[key].owner = owner
        found[key].last_contacted = contacted
    stage = func.lower(func.coalesce(HubSpotDeal.stage, ""))
    deals = await session.scalars(
        select(HubSpotDeal.hubspot_company_id)
        .where(HubSpotDeal.hubspot_company_id.in_(wanted), stage.not_in(sorted(CLOSED_STAGES)))
        .distinct()
    )
    for key in deals:
        found[key].open_deal = True
    calls = await session.execute(
        select(HubSpotCall.hubspot_company_id, func.max(HubSpotCall.called_at))
        .where(HubSpotCall.hubspot_company_id.in_(wanted))
        .group_by(HubSpotCall.hubspot_company_id)
    )
    for company, last in calls.all():
        if company is not None:
            found[company].last_call = last
    if asker.owner_id is not None:
        since = asker.now - timedelta(days=CALLED_DAYS)
        mine = await session.execute(
            select(HubSpotCall.hubspot_company_id, func.max(HubSpotCall.called_at))
            .where(
                HubSpotCall.hubspot_company_id.in_(wanted),
                HubSpotCall.owner_id == asker.owner_id,
                HubSpotCall.called_at >= since,
            )
            .group_by(HubSpotCall.hubspot_company_id)
        )
        for company, last in mine.all():
            if company is not None:
                found[company].called_at = last
    for key, starts_at in (await meetings_soon(asker, session)).items():
        if key in found:
            found[key].meeting_at = starts_at
    return found


# --- The order, the level and the words ----------------------------------------------------------


@dataclass(frozen=True)
class Ranked:
    """Matches in order, best first, each with its reason and detail; the level; and the top
    match's reason, for the card's suggestion."""

    choices: list[AssistantChoice]
    level: Level
    reason: str | None


def details(hits: Sequence[CompanyHit], signals: dict[str, Signals], today: date) -> list[str]:
    """The one detail that tells each match apart: the city, else the owner, else the last
    call (choice 4)."""
    cities = [hit.city or "" for hit in hits]
    if len({city.casefold() for city in cities}) == len(hits) and all(cities):
        return cities
    owners = [signals[hit.key].owner or "" for hit in hits]
    if len({owner.casefold() for owner in owners}) == len(hits) and all(owners):
        return [f"Owner: {owner}" for owner in owners]
    if any(cities) and len({city.casefold() for city in cities}) > 1:
        return [city or "No city" for city in cities]
    return [last_call_words(signals[hit.key].last_call, today) for hit in hits]


def level_of(ordered: Sequence[Signals]) -> Level:
    """One match is sure. Among several, the top one's strongest signal decides: none, or shared
    with another, is unsure; the only one of the rep's own is sure; any other is likely."""
    if len(ordered) == 1:
        return "sure"
    top = ordered[0].strongest()
    if top == NO_SIGNAL or any(other.has(top) for other in ordered[1:]):
        return "unsure"
    return "sure" if top == MINE else "likely"


async def rank_companies(session: AsyncSession, hits: Sequence[CompanyHit], asker: Asker) -> Ranked:
    """These matches (in the order of how close their name is), ranked by choice 2's signals."""
    signals = await signals_of(session, [hit.key for hit in hits], asker)
    places = sorted(range(len(hits)), key=lambda place: (signals[hits[place].key].order(), place))
    ordered = [hits[place] for place in places][:CHOICES_SHOWN]
    their = [signals[hit.key] for hit in ordered]
    told_apart = details(ordered, signals, asker.today) if len(ordered) > 1 else [""] * len(ordered)
    choices = [
        AssistantChoice(
            **hit.model_dump(),
            reason=one.reason(asker.today),
            detail=detail or None,
        )
        for hit, one, detail in zip(ordered, their, told_apart, strict=True)
    ]
    level = level_of(their) if their else "unsure"
    return Ranked(choices=choices, level=level, reason=choices[0].reason if choices else None)


def plain_choices(hits: Sequence[CompanyHit]) -> list[AssistantChoice]:
    """Matches as choices with no reason or detail: kept in the order given."""
    return [
        AssistantChoice(**hit.model_dump(), reason=None, detail=None)
        for hit in hits[:CHOICES_SHOWN]
    ]


# --- People (PLAN-V25 T2-1, choices 8 to 10) -----------------------------------------------------

PEOPLE_POOL: Final = 25  # the most people a name is ranked among


@dataclass
class PersonSignals:
    mine: bool = False  # their company is the rep's own
    called_at: datetime | None = None  # the rep's last call with them, in the last 30 days
    last_activity: datetime | None = None

    def order(self) -> tuple[bool, bool, float]:
        active = -self.last_activity.timestamp() if self.last_activity is not None else 0.0
        return (not self.mine, self.called_at is None, active)

    def strongest(self) -> int:
        if self.mine:
            return MINE
        if self.called_at is not None:
            return CALLED
        return NO_SIGNAL

    def has(self, signal: int) -> bool:
        return {MINE: self.mine, CALLED: self.called_at is not None}.get(signal, False)


def person_reason(one: PersonSignals, today: date) -> str | None:
    """'You called them on Tuesday.' or 'Yours.' (their company is the rep's)."""
    if one.called_at is not None:
        return called_words(one.called_at, today)
    if one.mine:
        return MINE_WORDS
    return None


async def people_signals(
    session: AsyncSession, people: Sequence[AssistantPersonHit], asker: Asker
) -> dict[str, PersonSignals]:
    found = {person.id: PersonSignals() for person in people}
    ids = list(found)
    if not ids:
        return found
    rows = await session.execute(
        select(HubSpotContact.hubspot_id, HubSpotContact.last_activity, HubSpotCompany.owner_id)
        .join(HubSpotCompany, HubSpotCompany.hubspot_id == HubSpotContact.hubspot_company_id)
        .where(HubSpotContact.hubspot_id.in_(ids))
    )
    for person_id, last_activity, owner_id in rows.all():
        found[person_id].last_activity = last_activity
        found[person_id].mine = asker.owner_id is not None and owner_id == asker.owner_id
    if asker.owner_id is not None:
        since = asker.now - timedelta(days=CALLED_DAYS)
        calls = await session.execute(
            select(HubSpotCall.hubspot_contact_id, func.max(HubSpotCall.called_at))
            .where(
                HubSpotCall.hubspot_contact_id.in_(ids),
                HubSpotCall.owner_id == asker.owner_id,
                HubSpotCall.called_at >= since,
            )
            .group_by(HubSpotCall.hubspot_contact_id)
        )
        for contact, last in calls.all():
            if contact is not None:
                found[contact].called_at = last
    return found


@dataclass(frozen=True)
class RankedPeople:
    choices: list[AssistantPersonHit]
    level: Level
    reason: str | None


async def rank_people(
    session: AsyncSession, people: Sequence[AssistantPersonHit], asker: Asker
) -> RankedPeople:
    """People with the name said, at any company the rep can open: the rep's own companies
    first, then those the rep called in the last 30 days, then the most recently active (choice
    9). Each tells itself apart by its company."""
    signals = await people_signals(session, people, asker)
    places = sorted(range(len(people)), key=lambda p: (signals[people[p].id].order(), p))
    ordered = [people[place] for place in places][:CHOICES_SHOWN]
    their = [signals[person.id] for person in ordered]
    choices = [
        person.model_copy(update={"reason": person_reason(one, asker.today)})
        for person, one in zip(ordered, their, strict=True)
    ]
    if len(their) == 1:
        level: Level = "likely"  # found without its company: the card asks once
    elif not their:
        level = "unsure"
    else:
        top = their[0].strongest()
        shared = any(other.has(top) for other in their[1:])
        level = "unsure" if top == NO_SIGNAL or shared else "likely"
    return RankedPeople(choices=choices, level=level, reason=choices[0].reason if choices else None)
