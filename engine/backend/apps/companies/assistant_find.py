"""Finding what a command names (PLAN-V22 T1-2), by code, in our HubSpot copy: the company, the
person, the meeting and the teammates, and the days. Claude only gives the words as heard
(assistant_form.py), so a name it or the speech service gets wrong is caught here, and nothing is
guessed. Two matches or more give choices, best first. No match gives none, with the words as
heard.

- **The company:** the one on screen when the words are close to it. Then the team's learned
  names (PLAN-V23 T1-3): the companies taught for these words. Then `match_company` over our copy
  (the cleaned name, a deal's client name, or a name nearly the same by `names_are_close`'s
  rules), with the words also tried run together, since a speech service splits names ("North
  Wind"). Then a word search: names with a word that starts with each word said ("Sample" finds
  Sample Logistics Pty Ltd). Then HubSpot's own search (assistant_live.py), which reads what it
  finds into our copy (`from_hubspot`); found nowhere, the card may offer to add it (`can_add`).
  With no company named, the one on screen (`on_page`). Among several, the one on screen wins.
  The card's own find (PLAN-V24 choice 19, `find_said`) runs the same steps from the learned
  names on, for a company said again, with no Claude request and no company on screen.
- **The person:** among that company's people (`people_of`): the full name (`find_person`, the
  call note sorter's test), else every word said matching a word of their name. A word of 4
  letters or more may be spelled slightly wrong ("Sampel").
- **The meeting:** the one on screen, else the company's meetings in the next 60 days (with no
  company named, my own): on the day said ("Thursday's meeting"), else the next one. A cancelled
  one doesn't count.
- **Teammates:** the team list behind `GET /companies/team`, by name. An email goes only to
  teammates with a Contour account, or to a Contour address typed in full (`only_internal`).
- **Days:** `read_when` in Melbourne time, and `task_day` for a task: never a weekend or the past.
- **A call's note:** what was said after the command words at its start, checked word for word
  (choice 16). The note is always the rep's own text.
"""

import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final

from fastapi import FastAPI
from rapidfuzz import fuzz
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import learned_store
from apps.companies.assistant_live import NOT_SEARCHED, live_search
from apps.companies.assistant_schemas import (
    AssistantCardIn,
    AssistantCompany,
    AssistantCompanyFind,
    AssistantMeeting,
    AssistantMeetingHit,
    AssistantOnPage,
    AssistantPerson,
    AssistantRecipient,
)
from apps.companies.facts import EMAIL, scrub
from apps.companies.meeting_store import (
    MONTHS,
    NOT_READY,
    STILL_WORKS,
    WEEKDAYS,
    MeetingSource,
    cancelled,
    client_meetings,
    forms_of,
    list_team,
    my_owner,
)
from apps.companies.note_dates import WEEKDAYS as WEEKDAY_WORDS
from apps.companies.note_dates import Unreadable, When, next_working_day, read_when, task_day
from apps.companies.note_store import company_named, may_read
from apps.companies.notes import MELBOURNE, find_person
from apps.companies.schemas import (
    MAX_RECIPIENTS,
    CompanyHit,
    CompanyPerson,
    MeetingFormState,
    PrepPerson,
    TeamMember,
)
from apps.companies.store import people_of, valid_key
from apps.companies.tables import CallNote, MeetingForm
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.company_leads import CompanyLeads
from core.config import Settings
from core.email.internal import only_internal
from core.hubspot.matching import core_tokens, match_company, names_are_close
from core.hubspot.meetings import DAYS_AHEAD, Meeting
from core.hubspot.models import HubSpotCompany
from core.hubspot.profiles import PLACEHOLDER_NAME

MAX_CHOICES: Final = 5
CLOSE_MIN: Final = 4  # a word this long or longer may be spelled slightly wrong
CLOSE_SCORE: Final = 80  # how close, 0 to 100 (`fuzz.ratio`): "sampel" and "sample" score 83
SEARCH_WORDS: Final = 6  # the most words of a name the word search uses
MAX_CUT_WORDS: Final = 16  # more command words than this at a note's start: nothing is cut
HEARD_CHARS: Final = 120
ME_WORDS: Final = frozenset({"me", "myself"})
EM_DASH: Final = chr(0x2014)  # the website shows no em dashes (DESIGN.md)
EN_DASH: Final = chr(0x2013)
CURLY: Final = chr(0x2019)  # a typographic apostrophe
POSSESSIVE: Final = re.compile(rf"(?<=\w)['{CURLY}]s\b", re.IGNORECASE)
LETTERS: Final = re.compile(r"[^\W\d_]+")
EDGES: Final = " .,;:!?\"'()[]"
SEPARATORS: Final = " \t\r\n,;:-"

# --- The words: what wasn't clear, in plain words ------------------------------------------------

TEAM_DOWN = "The team list couldn't be loaded right now. Try again in a moment."
NOT_LINKED_ME = "Your account isn't linked to a HubSpot owner yet. Pick yourself from the list."


def not_in_hubspot(heard: str) -> str:
    return f"We couldn't find '{heard}' in HubSpot. Pick the company."


def new_in_hubspot(name: str) -> str:
    """PLAN-V23 "Words for when things go wrong": in HubSpot, but not in our copy (until now)."""
    return f"{name} is new in HubSpot. We'll use it."


def isnt_in_hubspot(name: str) -> str:
    """PLAN-V23 "Words for when things go wrong": not in HubSpot either."""
    return f"{name} isn't in HubSpot. Add it, or pick another company."


def which(heard: str) -> str:
    return f"Which {heard}?"


def not_at_company(heard: str, company: str) -> str:
    return f"We couldn't find '{heard}' at {company}. Pick the person, or leave them out."


def off_the_team(heard: str, *, email: bool) -> str:
    who = "who gets it" if email else "who it's for"
    return f"We couldn't find '{heard}' on the team list. Pick {who}."


def no_account(name: str) -> str:
    return f"{name} has no Contour account, so they can't get this email. Pick someone else."


def outside(address: str) -> str:
    """PLAN-V22 "Words for when things go wrong": an outside address."""
    return f"Emails from the Assistant go to Contour people only. Remove {address} to send."


def no_meeting_ahead(whose: str) -> str:
    return (
        f"{whose} no meeting in HubSpot in the next {DAYS_AHEAD} days. Start a pre-read and "
        "type the date."
    )


def no_meeting_on(whose: str, day: str) -> str:
    return (
        f"{whose} no meeting in HubSpot on {day}. Pick one of the meetings ahead, or start a "
        "pre-read and type the date."
    )


# --- One command's surroundings ------------------------------------------------------------------


@dataclass(frozen=True)
class Context:
    """One command: its words, what is on screen, who asks, the settings and the time."""

    said: str  # the words, with emails and phone numbers blanked: what Claude got
    typed: str  # the words as sent: only Contour addresses typed in full are read from them
    on_page: AssistantOnPage | None
    card: AssistantCardIn | None
    auth: AuthContext | None
    settings: Settings
    meetings: MeetingSource
    leads: Sequence[CompanyLeads]
    now: datetime
    today: date  # Melbourne's
    app: FastAPI | None = (
        None  # for HubSpot's own search (PLAN-V23 T1-3); None asks HubSpot nothing
    )


# --- Words and names -----------------------------------------------------------------------------


def clean_line(text: str, limit: int) -> str:
    """One line of plain text for the card: no em dash, no email or phone number, cut to fit."""
    text = re.sub(rf"\s*{EM_DASH}\s*", ", ", text)
    text = " ".join(scrub(text.replace(EN_DASH, "-")).split())
    return text if len(text) <= limit else f"{text[: limit - 3].rstrip()}..."


def heard(text: str) -> str:
    """A name or a few words as heard, tidied: one line, no 's, no marks at the edges."""
    return POSSESSIVE.sub("", clean_line(text, HEARD_CHARS)).strip(EDGES)


def heard_key(text: str) -> str:
    """Words as a learned name keeps them (PLAN-V23 T1-2): lower case, one space between words
    and none at the ends. So "North  Wind" and "north wind" are the same words, and "North Wind"
    and "Northwind" are not."""
    return " ".join(text.casefold().split())


def name_words(text: str) -> list[str]:
    """A name's words in lower case: letters only, of 2 letters or more."""
    words = LETTERS.findall(POSSESSIVE.sub("", text))
    return [word.casefold() for word in words if len(word) >= 2]


def word_matches(said: str, theirs: str) -> bool:
    """The same word, or one spelled slightly wrong when both have CLOSE_MIN letters or more."""
    if said == theirs:
        return True
    return min(len(said), len(theirs)) >= CLOSE_MIN and fuzz.ratio(said, theirs) >= CLOSE_SCORE


def named(text: str, names: Sequence[str], *, first: Sequence[bool] = ()) -> list[int]:
    """The places of the names the words name, best first: every word said matches a word of
    the name. The whole name exactly comes first, then more words exactly, then shorter names,
    then those marked `first`, then the list's order. One exact whole name is the only one."""
    words = name_words(text)
    if not words:
        return []
    found: list[tuple[tuple[int, int, int, int, int], int]] = []
    for place, name in enumerate(names):
        theirs = name_words(name)
        if not theirs or not all(any(word_matches(w, t) for t in theirs) for w in words):
            continue
        marked = place < len(first) and first[place]
        exact = sum(word in theirs for word in words)
        found.append(((int(theirs != words), -exact, len(theirs), int(not marked), place), place))
    ranked = [place for _, place in sorted(found)]
    whole = [place for place in ranked if name_words(names[place]) == words]
    return whole if len(whole) == 1 else ranked


def people_named(text: str, people: Sequence[CompanyPerson]) -> list[CompanyPerson]:
    """The company's people the words name, best first. One whose full name is in the words is
    the one (`find_person`)."""
    one = find_person(text, people)
    if one is not None:
        return [one]
    return [people[place] for place in named(text, [person.name for person in people])]


def teammates_named(text: str, team: Sequence[TeamMember]) -> list[TeamMember]:
    """The teammates the words name, best first, those with a Contour account first among
    equals. "Me" is the rep."""
    if " ".join(name_words(text)) in ME_WORDS:
        return [member for member in team if member.is_me]
    places = named(text, [member.name for member in team], first=[m.has_account for m in team])
    return [team[place] for place in places]


# --- Days ----------------------------------------------------------------------------------------


def reading(when: str, today: date) -> When | None:
    """The words' day, or None for no day or words code can't read: never guessed."""
    try:
        return read_when(when, today)
    except Unreadable:
        return None


def day_of(when: str, today: date) -> date | None:
    """The day the words say: a month gives its 1st, as a call's field change does. None for a
    year alone."""
    found = reading(when, today)
    return found.on if found is not None and found.precision != "year" else None


def task_due(when: str, today: date) -> tuple[date, str | None]:
    """A task's day, never a weekend or in the past, and why, when code chose it."""
    try:
        return task_day(read_when(when, today), today)
    except Unreadable:
        return next_working_day(today), "the date couldn't be read"


def follow_up_day(when: str, today: date) -> date | None:
    """A call's follow-up day, for the read-back, when the words say one."""
    found = reading(when, today)
    if found is None or found.precision == "year":
        return None
    return task_day(found, today)[0]


def meeting_days(when: str, today: date) -> list[date]:
    """The days a meeting may be on. A weekday that is today ("Thursday's meeting", said on a
    Thursday) may mean today, so today comes first."""
    found = reading(when, today)
    if found is None or found.precision != "day":
        return []
    parts = re.sub(r"[^\w\s]", " ", when.casefold()).split()
    bare = len(parts) == 1 or (len(parts) == 2 and parts[0] == "this")
    if bare and WEEKDAY_WORDS.get(parts[-1]) == today.weekday() and found.on != today:
        return [today, found.on]
    return [found.on]


def day_words(day: date, today: date) -> str:
    """'Fri 21 Nov', with the year when it isn't this one."""
    words = f"{WEEKDAYS[day.weekday()][:3].title()} {day.day} {MONTHS[day.month - 1][:3].title()}"
    return words if day.year == today.year else f"{words} {day.year}"


def time_words(moment: datetime) -> str:
    """'10:00 am', in Melbourne time."""
    local = moment.astimezone(MELBOURNE)
    return f"{local.hour % 12 or 12}:{local.minute:02d} {'am' if local.hour < 12 else 'pm'}"


# --- A call's note -------------------------------------------------------------------------------


def _plain(word: str) -> str:
    return word.replace(CURLY, "'").strip(EDGES).casefold()


def note_after_cut(said: str, cut: str) -> str:
    """A call's note (choice 16): what was said after the command words at its start. Claude only
    names those words, and the note is always the rep's own text from where they end. When they
    aren't word for word the start of what was said, or are too many, nothing is cut."""
    whole = said.strip()
    wanted = [word for word in (_plain(part) for part in cut.split()) if word]
    if not wanted or len(wanted) > MAX_CUT_WORDS:
        return whole
    tokens = [token for token in re.finditer(r"\S+", whole) if _plain(token.group())]
    if len(tokens) < len(wanted):
        return whole
    if any(_plain(token.group()) != word for token, word in zip(tokens, wanted, strict=False)):
        return whole
    rest = whole[tokens[len(wanted) - 1].end() :].lstrip(SEPARATORS)
    return rest[:1].upper() + rest[1:]


# --- The company ---------------------------------------------------------------------------------


async def company_hit(
    session: AsyncSession, key: str, leads: Sequence[CompanyLeads]
) -> CompanyHit | None:
    """A company open to this person: in our HubSpot copy, or a lead of a project whose tick
    they have. None otherwise."""
    if not valid_key(key):
        return None
    if key.startswith("lead:"):
        name = await company_named(session, key, leads)
        if name is None:
            return None
        return CompanyHit(key=key, name=name, city=None, industry=None, source="lead")
    row = await session.get(HubSpotCompany, key)
    if row is None:
        return None
    return CompanyHit(
        key=key, name=row.name, city=row.city, industry=row.industry, source="hubspot"
    )


async def hubspot_hits(session: AsyncSession, keys: Sequence[str]) -> list[CompanyHit]:
    """These HubSpot companies, in this order, as a list shows them."""
    if not keys:
        return []
    rows = await session.execute(
        select(
            HubSpotCompany.hubspot_id,
            HubSpotCompany.name,
            HubSpotCompany.city,
            HubSpotCompany.industry,
        ).where(HubSpotCompany.hubspot_id.in_(list(keys)))
    )
    found = {
        key: CompanyHit(key=key, name=name, city=city, industry=industry, source="hubspot")
        for key, name, city, industry in rows.all()
    }
    return [found[key] for key in dict.fromkeys(keys) if key in found]


async def word_search(session: AsyncSession, text: str) -> list[str]:
    """Companies with a word that starts with each word said, shorter names first: "Sample" finds
    Sample Logistics Pty Ltd. Words that say nothing (Pty, Group, Australia ...) don't count."""
    words = [w for w in core_tokens(text) if len(w) >= 2 and re.fullmatch(r"[a-z0-9]+", w)]
    if not words:
        return []
    name = HubSpotCompany.name
    found = await session.scalars(
        select(HubSpotCompany.hubspot_id)
        .where(
            *(name.regexp_match(rf"\m{word}", flags="i") for word in words[:SEARCH_WORDS]),
            func.lower(func.btrim(name)) != PLACEHOLDER_NAME,
        )
        .order_by(func.length(name), name, HubSpotCompany.hubspot_id)
        .limit(MAX_CHOICES)
    )
    return list(found)


async def companies_named(session: AsyncSession, text: str, fuzzy_min: int) -> list[CompanyHit]:
    """The HubSpot companies the words name, best first."""
    joined = "".join(text.split())  # "North Wind" may be Northwind
    match = await match_company(
        session, text, found_name=joined if joined != text else None, fuzzy_min=fuzzy_min
    )
    if match.hubspot_id is not None:
        keys = [match.hubspot_id]
    elif match.candidates:
        keys = [candidate.hubspot_id for candidate in match.candidates]
    else:
        keys = await word_search(session, text)
    return await hubspot_hits(session, keys)


async def learned_hits(
    session: AsyncSession, words: str, leads: Sequence[CompanyLeads]
) -> list[CompanyHit]:
    """The companies the team taught for these words (PLAN-V23 choice 3), the newest pair first,
    each open to this person."""
    hits: list[CompanyHit] = []
    for key in await learned_store.taught_for(session, heard_key(words)):
        hit = await company_hit(session, key, leads)
        if hit is not None:
            hits.append(hit)
    return hits


def picked(
    words: str, hits: Sequence[CompanyHit], page: CompanyHit | None, *, from_hubspot: bool = False
) -> tuple[AssistantCompany, str | None]:
    """The one on screen when it is among the hits, else one hit, else the choices."""
    if page is not None and any(hit.key == page.key for hit in hits):
        return AssistantCompany(heard=words, from_page=True, found=page, choices=[]), None
    if len(hits) == 1:
        line = new_in_hubspot(hits[0].name) if from_hubspot else None
        found = AssistantCompany(
            heard=words, from_page=False, found=hits[0], choices=[], from_hubspot=from_hubspot
        )
        return found, line
    choices = AssistantCompany(
        heard=words,
        from_page=False,
        found=None,
        choices=list(hits[:MAX_CHOICES]),
        from_hubspot=from_hubspot,
    )
    return choices, which(words)


async def find_company(
    session: AsyncSession, said: str, page: CompanyHit | None, ctx: Context
) -> tuple[AssistantCompany, str | None]:
    """The company the words name, else the one on screen, and a line when it isn't clear: the
    one on screen when the words are close to it, then the learned names, then our copy, then
    HubSpot's own search (which reads what it finds into our copy). Found nowhere: the card may
    add it, when HubSpot was searched."""
    words = heard(said)
    if not words:
        return AssistantCompany(heard="", from_page=page is not None, found=page, choices=[]), None
    fuzzy_min = ctx.settings.match_fuzzy_min
    if page is not None and names_are_close(words, page.name, fuzzy_min):
        return AssistantCompany(heard=words, from_page=True, found=page, choices=[]), None
    return await company_for_words(
        session, words, page, fuzzy_min=fuzzy_min, leads=ctx.leads, app=ctx.app
    )


async def company_for_words(
    session: AsyncSession,
    words: str,
    page: CompanyHit | None,
    *,
    fuzzy_min: int,
    leads: Sequence[CompanyLeads],
    app: FastAPI | None,
) -> tuple[AssistantCompany, str | None]:
    """The company these words (tidied by `heard`) name, and a line when it isn't clear: the
    learned names, then our copy, then HubSpot's own search (which reads what it finds into our
    copy; `app` None asks HubSpot nothing). Among several, the one on screen wins. Found nowhere:
    the card may add it, when HubSpot was searched. The command step and the card's own find
    (`find_said`) both use it."""
    learned = await learned_hits(session, words, leads)
    if learned:
        return picked(words, learned, page)
    hits = await companies_named(session, words, fuzzy_min)
    if hits:
        return picked(words, hits, page)
    live = NOT_SEARCHED
    if app is not None:
        live = await live_search(session, app, words, fuzzy_min=fuzzy_min)
    found = await hubspot_hits(session, live.keys)
    if found:
        return picked(words, found, page, from_hubspot=True)
    line = isnt_in_hubspot(words) if live.searched else not_in_hubspot(words)
    company = AssistantCompany(
        heard=words, from_page=False, found=None, choices=[], can_add=live.searched
    )
    return company, line


# --- The card's own find (PLAN-V24 T3-2, choice 19) ----------------------------------------------


def words_empty() -> Problem:
    return Problem(
        422,
        "No company to find",
        "We didn't hear a company's name. Say it again, or type it.",
        code="words_empty",
    )


def words_with_contact_details() -> Problem:
    return Problem(
        422,
        "Contact details left out",
        "Phone numbers and emails can't be searched for. Take them out of the company's name, "
        "then try again.",
        code="contact_details",
    )


async def find_said(
    session: AsyncSession,
    words: str,
    *,
    settings: Settings,
    leads: Sequence[CompanyLeads],
    app: FastAPI | None,
) -> AssistantCompanyFind:
    """The company a rep says (or types) again on the card, found as the command step finds it,
    with no Claude request and no company on screen: the learned names, our copy, then HubSpot's
    own search. HubSpot is only read; what it finds goes into our copy. Words with an email
    address or a phone number are refused, so none goes to HubSpot, and so are words that leave
    nothing to search for once tidied (422)."""
    if scrub(words) != words:
        raise words_with_contact_details()
    tidied = heard(words)
    if not tidied:
        raise words_empty()
    company, line = await company_for_words(
        session, tidied, None, fuzzy_min=settings.match_fuzzy_min, leads=leads, app=app
    )
    return AssistantCompanyFind(company=company, line=line)


# --- What is on screen ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OnScreen:
    company: CompanyHit | None = None
    meeting: AssistantMeetingHit | None = None


async def meeting_hits(
    session: AsyncSession, meetings: Sequence[Meeting]
) -> list[AssistantMeetingHit]:
    """The meetings linked to a company in our copy, in the same order, each with its pre-read."""
    linked = await client_meetings(session, meetings)
    forms = await forms_of(session, [meeting.id for meeting, _ in linked])
    return [
        AssistantMeetingHit(
            id=meeting.id,
            title=meeting.title,
            starts_at=meeting.starts_at,
            company_key=meeting.company_id or "",
            company_name=name,
            form=forms.get(meeting.id),
        )
        for meeting, name in linked
    ]


async def form_meeting(
    session: AsyncSession, form_id: uuid.UUID, ctx: Context
) -> AssistantMeetingHit | None:
    """The meeting of the pre-read on screen, when its company is open to this person."""
    form = await session.get(MeetingForm, form_id)
    if form is None or await company_hit(session, form.company_key, ctx.leads) is None:
        return None
    return AssistantMeetingHit(
        id=form.meeting_id,
        title=form.title,
        starts_at=form.starts_at,
        company_key=form.company_key,
        company_name=form.company_name,
        form=MeetingFormState(
            id=form.id,
            status=form.status,
            sent_at=form.sent_at,
            sent_count=len(form.sent_to or []),
        ),
    )


async def on_screen(session: AsyncSession, ctx: Context) -> OnScreen:
    """The company and the meeting on screen, from what the page sent, if open to this person."""
    page = ctx.on_page
    if page is None:
        return OnScreen()
    meeting: AssistantMeetingHit | None = None
    if page.form_id is not None and ctx.settings.meeting_forms_enabled:
        meeting = await form_meeting(session, page.form_id, ctx)
    elif page.meeting_id is not None and ctx.settings.meeting_forms_enabled:
        found = await ctx.meetings.get(session, page.meeting_id)
        hits = await meeting_hits(session, [found] if found is not None else [])
        meeting = hits[0] if hits else None
    company = await company_hit(session, page.company_key, ctx.leads) if page.company_key else None
    if company is None and meeting is not None:
        company = await company_hit(session, meeting.company_key, ctx.leads)
    if company is None and page.note_id is not None:
        note = await session.get(CallNote, page.note_id)
        # A call that needs its company (PLAN-V24) has none to give.
        if note is not None and note.company_key is not None and may_read(note, ctx.auth):
            company = await company_hit(session, note.company_key, ctx.leads)
    return OnScreen(company=company, meeting=meeting)


# --- The person ----------------------------------------------------------------------------------


async def find_person_at(
    session: AsyncSession, said: str, company: AssistantCompany
) -> tuple[AssistantPerson, str | None]:
    """The person the words name, among the company's people, and a line when it isn't clear."""
    words = heard(said)
    hit = company.found
    if not words or hit is None:  # no company yet: the company's own line asks first
        return AssistantPerson(heard=words, found=None, choices=[]), None
    people = await people_of(session, hit.key) if hit.source == "hubspot" else []
    found = [
        PrepPerson(id=person.id, name=person.name, title=person.title)
        for person in people_named(words, people)
    ]
    if len(found) == 1:
        return AssistantPerson(heard=words, found=found[0], choices=[]), None
    line = which(words) if found else not_at_company(words, hit.name)
    return AssistantPerson(heard=words, found=None, choices=found[:MAX_CHOICES]), line


# --- The meeting ---------------------------------------------------------------------------------


def ahead(meetings: Sequence[Meeting], now: datetime) -> list[Meeting]:
    """The meetings still to come in the next 60 days, soonest first, without cancelled ones."""
    end = now + timedelta(days=DAYS_AHEAD)
    kept = [m for m in meetings if now <= m.starts_at < end and not cancelled(m)]
    return sorted(kept, key=lambda meeting: meeting.starts_at)


async def find_meeting(
    session: AsyncSession,
    said: str,
    when: str,
    company: AssistantCompany,
    screen: OnScreen,
    ctx: Context,
) -> tuple[AssistantMeeting, str | None]:
    """The meeting a pre-read is for, and a line when it isn't clear. The one on screen, unless
    the words name a company or a day. Else the company's next one, or the one on the day said.
    With no company named, my own meetings."""
    words = clean_line(said, HEARD_CHARS)
    days = meeting_days(when, ctx.today)
    none = AssistantMeeting(heard=words, from_page=False, found=None, choices=[])
    if screen.meeting is not None and not company.heard and not days:
        return AssistantMeeting(heard=words, from_page=True, found=screen.meeting, choices=[]), None
    hit = company.found
    if hit is None and company.heard:  # the company's own line asks first
        return none, None
    status = await ctx.meetings.status(session)
    if status.state != "ready":
        return none, f"{status.sentence or NOT_READY} {STILL_WORKS}"
    if hit is not None:
        whose = f"{hit.name} has"
        found = await ctx.meetings.for_company(session, hit.key) if hit.source == "hubspot" else []
    else:
        me = await my_owner(session, ctx.auth, ctx.meetings)
        if me is None:
            return none, None
        whose = "You have"
        found = await ctx.meetings.upcoming(session, owner_id=me, days=DAYS_AHEAD)
    coming = await meeting_hits(session, ahead(found, ctx.now))
    if not coming:
        return none, no_meeting_ahead(whose)
    if not days:
        return AssistantMeeting(heard=words, from_page=False, found=coming[0], choices=[]), None
    for day in days:
        on_day = [m for m in coming if m.starts_at.astimezone(MELBOURNE).date() == day]
        if len(on_day) == 1:
            return AssistantMeeting(heard=words, from_page=False, found=on_day[0], choices=[]), None
        if on_day:
            line = f"Which meeting on {day_words(day, ctx.today)}?"
            choices = on_day[:MAX_CHOICES]
            return AssistantMeeting(heard=words, from_page=False, found=None, choices=choices), line
    line = no_meeting_on(whose, day_words(days[-1], ctx.today))
    choices = coming[:MAX_CHOICES]
    return AssistantMeeting(heard=words, from_page=False, found=None, choices=choices), line


# --- Teammates -----------------------------------------------------------------------------------


async def team_of(session: AsyncSession, ctx: Context) -> list[TeamMember] | None:
    """The team list behind `GET /companies/team`, or None when it can't be read."""
    try:
        return await list_team(session, ctx.auth)
    except Problem:  # 503 team_unavailable: each name says so instead
        await session.rollback()
        return None


def recipient(said: str, team: Sequence[TeamMember] | None, *, email: bool) -> AssistantRecipient:
    """The teammate the words name. For an email, only one with a Contour account can get it."""
    words = heard(said)
    if team is None:
        return AssistantRecipient(
            heard=words, found=None, address=None, choices=[], problem=TEAM_DOWN
        )
    found = teammates_named(words, team)
    if len(found) == 1:
        member = found[0]
        problem = no_account(member.name) if email and not member.has_account else None
        return AssistantRecipient(
            heard=words, found=member, address=None, choices=[], problem=problem
        )
    if found:
        choices = found[:MAX_CHOICES]
        return AssistantRecipient(
            heard=words, found=None, address=None, choices=choices, problem=None
        )
    me = " ".join(name_words(words)) in ME_WORDS
    problem = NOT_LINKED_ME if me else off_the_team(words, email=email)
    return AssistantRecipient(heard=words, found=None, address=None, choices=[], problem=problem)


def email_recipients(
    names: Sequence[str], typed: str, team: Sequence[TeamMember] | None, domains: Sequence[str]
) -> list[AssistantRecipient]:
    """Who an email goes to: each teammate named, in order, once, then each address typed in
    full in the words. An outside address is listed with why it can't be sent to. At most 20."""
    found: list[AssistantRecipient] = []
    seen: set[str] = set()
    for name in names:
        if "@" in name or "[email" in name.casefold():
            continue  # addresses are read from the words themselves, below
        made = recipient(name, team, email=True)
        key = made.found.owner_id if made.found is not None else f"heard:{made.heard.casefold()}"
        if made.heard and key not in seen:
            seen.add(key)
            found.append(made)
    for address in dict.fromkeys(match.strip() for match in EMAIL.findall(typed)):
        allowed, _ = only_internal([address], domains)
        if allowed and allowed[0] not in seen:
            seen.add(allowed[0])
            found.append(
                AssistantRecipient(
                    heard=address, found=None, address=allowed[0], choices=[], problem=None
                )
            )
        elif not allowed:
            found.append(
                AssistantRecipient(
                    heard=address, found=None, address=None, choices=[], problem=outside(address)
                )
            )
    return found[:MAX_RECIPIENTS]


def task_owner(said: str, team: Sequence[TeamMember] | None) -> AssistantRecipient | None:
    """Who a task is for, when the words name a teammate. None: the rep."""
    words = heard(said)
    if not words or " ".join(name_words(words)) in ME_WORDS:
        return None
    made = recipient(words, team, email=False)
    return None if made.found is not None and made.found.is_me else made
