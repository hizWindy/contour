"""The team email (PLAN-V22 T1-5, the contract's part 4, choices 25 and 26): a short email from the
Assistant's review card to teammates. It follows the pre-read's send (`meeting_send.py`): the same
sender, the same Contour-only check and the same "email isn't set up" answer. The routes are in
api_assistant.py.

- **Who:** teammates from the team list, by HubSpot owner, each with a Contour account: the email
  goes to the account's own address (`rep_of_owner`), never to one from HubSpot. A teammate with
  no account, or whose account's address isn't Contour's, can't be picked, and the words say why
  (422 `no_account`). Contour addresses can be typed in full too. Every address goes through
  `only_internal`: one outside address refuses the whole send and names it (422
  `outside_address`). 1 to 20 people, each once.
- **What it says:** the subject, the words (every value HTML escaped), a link to the company in
  Contour when one is given, and "Sent by {name} from Contour HQ". An email address or a phone
  number in the words is sent as [email left out] or [number left out], as a call note and a
  task are (TBC). A reply goes to the rep's own address when it is a Contour one (`reply_to`);
  else to the sender's address.
- **Once:** the person and their Idempotency-Key make the email's key. A repeated key gives back
  the first send and sends nothing, and the email service gets the same key, so it doesn't send
  twice either.
- **30 sends a day a person** (TBC), by the Melbourne day (429 `too_many_emails`). The counts and
  the keys are kept in memory, so they start again when the backend restarts (TBC, the S0 Log).
- **No sender set up:** 409 `email_not_set_up`, and nothing is sent, as for a pre-read.
- Nothing is saved in the database. No database connection waits on the email service. Log lines
  hold counts and states only, never an address or the words.
"""

import html
import logging
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Final

from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant_find import no_account
from apps.companies.assistant_schemas import (
    AssistantEmailIn,
    TeamEmail,
    TeamEmailPerson,
    TodayCompany,
)
from apps.companies.facts import scrub
from apps.companies.meeting_job import email_sender
from apps.companies.meeting_send import company_link
from apps.companies.meeting_store import MeetingSource
from apps.companies.notes import MELBOURNE
from apps.companies.schemas import MAX_RECIPIENTS
from core.api.errors import Problem
from core.auth.sessions import AuthContext
from core.config import Settings
from core.email.internal import only_internal
from core.email.sender import EmailError, EmailNotSetUp, send
from core.hubspot.models import HubSpotCompany, HubSpotOwner
from core.hubspot.owners import shown_name

log = logging.getLogger(__name__)

SENDS_PER_DAY: Final = 30  # a person, by the Melbourne day (choice 25, TBC)
KEY_KEPT: Final = timedelta(hours=24)  # a send is given back for a repeated key this long
KEY_PREFIX: Final = "assistant-email"  # the email service's key: assistant-email:<person>:<key>
ANYONE: Final = "anyone"  # the person, while sign-in is off
SENT_FROM: Final = "Contour HQ"
NOT_SET_UP: Final = "Email isn't set up yet, so it can't be sent. An admin can set it up."

# --- The words (PLAN-V15 "Words for errors", PLAN-V22 "Words for when things go wrong") ---------


def outside_address(refused: Sequence[str]) -> Problem:
    """PLAN-V22's words for an outside address, naming each one refused."""
    return Problem(
        422,
        "Only Contour addresses",
        f"Emails from the Assistant go to Contour people only. Remove {', '.join(refused)} to "
        "send.",
        code="outside_address",
    )


def cannot_email(why: str) -> Problem:
    """A teammate who can't get the email (422 `no_account`). `why` names them and says why."""
    return Problem(422, "They can't get this email", why, code="no_account")


def no_contour_address(name: str) -> str:
    return (
        f"{name}'s account has no Contour email address, so they can't get this email. Pick "
        "someone else."
    )


def owner_not_found() -> Problem:
    return Problem(
        422,
        "We can't find that person on the team list",
        "They may have left HubSpot. Pick teammates from the list.",
        code="owner_not_found",
    )


def nobody_to_send() -> Problem:
    return Problem(
        422,
        "Nobody to send it to",
        "Pick at least one teammate, or type a Contour address.",
        code="no_one",
    )


def too_many_recipients() -> Problem:
    return Problem(
        422,
        "Too many people",
        f"Pick at most {MAX_RECIPIENTS} people at a time.",
        code="too_many_recipients",
    )


def subject_empty() -> Problem:
    return Problem(422, "An email needs a subject", "Write a short subject.", code="subject_empty")


def body_empty() -> Problem:
    return Problem(422, "An email needs words", "Write what the email says.", code="body_empty")


def lead_company() -> Problem:
    return Problem(
        422,
        "This company isn't in HubSpot yet",
        "Its link can't go in a team email. Leave the company out, or send it from the Lead "
        "Finder first.",
        code="not_in_hubspot",
    )


def company_not_found() -> Problem:
    return Problem(
        404,
        "We can't find that company",
        "It may have been merged or deleted in HubSpot. Pick the company again, or leave it out.",
        code="company_not_found",
    )


def email_not_set_up() -> Problem:
    return Problem(
        409,
        "Email isn't set up",
        "Email isn't set up yet, so nothing was sent. Your email stays on the card: send it once "
        "email is set up, or copy it.",
        code="email_not_set_up",
    )


def email_failed() -> Problem:
    return Problem(
        502,
        "The email didn't go",
        "The email service didn't take it. Try again in a minute: it is never sent twice.",
        code="email_failed",
    )


def email_sending() -> Problem:
    return Problem(
        409,
        "This email is being sent",
        "It is on its way right now. Wait a moment, then look again.",
        code="email_sending",
    )


def too_many_emails(wait_seconds: int) -> Problem:
    return Problem(
        429,
        "Too many emails today",
        f"That's {SENDS_PER_DAY} team emails today, the most for one day. Try again tomorrow, or "
        "email from your own inbox.",
        code="too_many_emails",
        headers={"Retry-After": str(wait_seconds)},
    )


# --- What is kept in memory -----------------------------------------------------------------------


class TeamEmailBook:
    """Each person's sends today, the emails sent under each key (for a day), and the keys being
    sent now. Kept in memory: it starts again when the backend restarts (TBC). It lives on
    `app.state.team_email`; a test puts its own."""

    def __init__(self, per_day: int = SENDS_PER_DAY) -> None:
        self.per_day = per_day
        self._days: dict[str, tuple[date, int]] = {}
        self._sent: dict[tuple[str, str], tuple[TeamEmail, datetime]] = {}
        self._sending: set[tuple[str, str]] = set()

    def left(self, who: str, today: date) -> int:
        day, used = self._days.get(who, (today, 0))
        return self.per_day - (used if day == today else 0)

    def take(self, who: str, today: date) -> bool:
        """Counts one send today. False when today's sends are all used."""
        left = self.left(who, today)
        if left <= 0:
            return False
        self._days[who] = (today, self.per_day - left + 1)
        return True

    def give_back(self, who: str, today: date) -> None:
        """A send that didn't go doesn't count."""
        day, used = self._days.get(who, (today, 0))
        if day == today and used > 0:
            self._days[who] = (today, used - 1)

    def first(self, who: str, key: str, now: datetime) -> TeamEmail | None:
        """The email sent under this key, if it went in the last day."""
        for kept, (_, at) in list(self._sent.items()):
            if now - at >= KEY_KEPT:
                del self._sent[kept]
        found = self._sent.get((who, key))
        return found[0] if found is not None else None

    def start(self, who: str, key: str) -> bool:
        """Marks the key as being sent. False when it is already."""
        if (who, key) in self._sending:
            return False
        self._sending.add((who, key))
        return True

    def finish(self, who: str, key: str) -> None:
        self._sending.discard((who, key))

    def remember(self, who: str, key: str, email: TeamEmail, now: datetime) -> None:
        self._sent[(who, key)] = (email, now)


def person_key(auth: AuthContext | None) -> str:
    return auth.user.id.hex if auth is not None else ANYONE


def melbourne_day(now: datetime) -> date:
    return now.astimezone(MELBOURNE).date()


def seconds_to_tomorrow(now: datetime) -> int:
    """Seconds until the next Melbourne midnight, when today's sends start again."""
    tomorrow = datetime.combine(melbourne_day(now) + timedelta(days=1), time(0), tzinfo=MELBOURNE)
    return max(1, math.ceil((tomorrow - now).total_seconds()))


# --- The email -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Draft:
    people: list[TeamEmailPerson]
    subject: str
    text: str
    html: str
    reply_to: str | None
    company: TodayCompany | None


async def people_of(
    session: AsyncSession, body: AssistantEmailIn, *, settings: Settings, source: MeetingSource
) -> list[TeamEmailPerson]:
    """Who the email goes to, checked: the teammates (each with a Contour account and a Contour
    address), then the addresses typed in, each address once. Raises the first problem found."""
    domains = settings.internal_email_domains
    allowed, refused = only_internal(body.emails, domains)
    if refused:
        raise outside_address(refused)
    owner_ids = list(dict.fromkeys(owner_id.strip() for owner_id in body.owner_ids))
    rows = {
        row.owner_id: row
        for row in await session.scalars(
            select(HubSpotOwner).where(HubSpotOwner.owner_id.in_(owner_ids))
        )
    }
    people: list[TeamEmailPerson] = []
    seen: set[str] = set()
    for owner_id in owner_ids:
        row = rows.get(owner_id)
        if row is None or row.archived:
            raise owner_not_found()
        name = shown_name(owner_id, row.name)
        rep = await source.rep_of_owner(session, owner_id)
        if rep is None:
            raise cannot_email(no_account(name))
        ours = only_internal([rep[1]], domains).allowed
        if not ours:
            raise cannot_email(no_contour_address(rep[0] or name))
        if ours[0] not in seen:
            seen.add(ours[0])
            people.append(TeamEmailPerson(owner_id=owner_id, name=rep[0] or name, address=ours[0]))
    for address in allowed:
        if address not in seen:
            seen.add(address)
            people.append(TeamEmailPerson(owner_id=None, name=None, address=address))
    if not people:
        raise nobody_to_send()
    if len(people) > MAX_RECIPIENTS:
        raise too_many_recipients()
    return people


async def company_of(session: AsyncSession, company_key: str | None) -> TodayCompany | None:
    """The company the email links to: one in our HubSpot copy, or none."""
    key = (company_key or "").strip()
    if not key:
        return None
    if key.startswith("lead:"):
        raise lead_company()
    name = (
        await session.scalar(select(HubSpotCompany.name).where(HubSpotCompany.hubspot_id == key))
        if key.isascii() and key.isdigit()
        else None
    )
    if name is None:
        raise company_not_found()
    return TodayCompany(key=key, name=name)


def sent_by(auth: AuthContext | None) -> str:
    name = " ".join((auth.user.name if auth is not None else "").split())
    return f"Sent by {name} from {SENT_FROM}" if name else f"Sent from {SENT_FROM}"


def email_text(
    words: str, company: TodayCompany | None, link: str | None, signed: str
) -> tuple[str, str]:
    """The email's plain text and HTML. Every value in the HTML is escaped."""

    def escaped(value: str) -> str:
        return html.escape(value, quote=True)

    paragraphs = [part.strip() for part in words.split("\n\n") if part.strip()]
    lines = [*paragraphs]
    parts = [
        "<p>" + "<br>".join(escaped(line) for line in paragraph.splitlines()) + "</p>"
        for paragraph in paragraphs
    ]
    if company is not None and link is not None:
        lines.append(f"{company.name} in Contour: {link}")
        parts.append(f'<p><a href="{escaped(link)}">{escaped(company.name)} in Contour</a></p>')
    lines.append(signed)
    parts.append(f"<p><em>{escaped(signed)}</em></p>")
    return "\n\n".join(lines), "".join(parts)


async def draft_email(
    session: AsyncSession,
    body: AssistantEmailIn,
    *,
    auth: AuthContext | None,
    settings: Settings,
    source: MeetingSource,
) -> Draft:
    """The email as it would go, checked."""
    people = await people_of(session, body, settings=settings, source=source)
    subject = " ".join(scrub(body.subject).split())
    if not subject:
        raise subject_empty()
    words = "\n".join(line.rstrip() for line in scrub(body.body).strip().splitlines())
    if not words:
        raise body_empty()
    company = await company_of(session, body.company_key)
    link = company_link(settings, company.key) if company is not None else None
    text, markup = email_text(words, company, link, sent_by(auth))
    mine = auth.user.email if auth is not None else ""
    ours = only_internal([mine], settings.internal_email_domains).allowed
    return Draft(
        people=people,
        subject=subject,
        text=text,
        html=markup,
        reply_to=ours[0] if ours else None,
        company=company,
    )


def out_of(
    drafted: Draft, *, waiting_for: str | None, sends_left: int, sent_at: datetime | None
) -> TeamEmail:
    return TeamEmail(
        subject=drafted.subject,
        text=drafted.text,
        html=drafted.html,
        people=drafted.people,
        reply_to_me=drafted.reply_to is not None,
        company=drafted.company,
        can_send=waiting_for is None,
        waiting_for=waiting_for,
        sends_left=max(0, sends_left),
        sent_at=sent_at,
    )


async def preview_email(
    session: AsyncSession,
    body: AssistantEmailIn,
    *,
    app: FastAPI,
    auth: AuthContext | None,
    settings: Settings,
    source: MeetingSource,
    book: TeamEmailBook,
    now: datetime,
) -> TeamEmail:
    """The email as it would go, and whether it can be sent now. Nothing is sent."""
    drafted = await draft_email(session, body, auth=auth, settings=settings, source=source)
    await session.commit()
    try:
        email_sender(app, settings)
        waiting_for = None
    except EmailNotSetUp:
        waiting_for = NOT_SET_UP
    left = book.left(person_key(auth), melbourne_day(now))
    return out_of(drafted, waiting_for=waiting_for, sends_left=left, sent_at=None)


async def send_email(
    session: AsyncSession,
    body: AssistantEmailIn,
    *,
    app: FastAPI,
    auth: AuthContext | None,
    settings: Settings,
    source: MeetingSource,
    book: TeamEmailBook,
    key: str,
    now: datetime,
) -> tuple[TeamEmail, bool]:
    """Sends the email once for this key: the email as it went, and whether this call sent it (a
    repeated key gives back the first send, and sends nothing)."""
    who = person_key(auth)
    first = book.first(who, key, now)
    if first is not None:
        return first, False
    drafted = await draft_email(session, body, auth=auth, settings=settings, source=source)
    await session.commit()  # no connection waits on the email service
    try:
        sender = email_sender(app, settings)
    except EmailNotSetUp:
        raise email_not_set_up() from None
    if not book.start(who, key):
        raise email_sending()
    today = melbourne_day(now)
    try:
        if not book.take(who, today):
            raise too_many_emails(seconds_to_tomorrow(now))
        try:
            await send(
                [person.address for person in drafted.people],
                drafted.subject,
                drafted.text,
                drafted.html,
                sender=sender,
                key=f"{KEY_PREFIX}:{who}:{key}",
                reply_to=drafted.reply_to,
            )
        except EmailNotSetUp:
            book.give_back(who, today)
            raise email_not_set_up() from None
        except EmailError as error:
            book.give_back(who, today)
            log.warning("team_email_failed", extra={"why": error.title})
            raise email_failed() from None
        sent = out_of(drafted, waiting_for=None, sends_left=book.left(who, today), sent_at=now)
        book.remember(who, key, sent, now)
    finally:
        book.finish(who, key)
    log.info(
        "team_email_sent",
        extra={"people": len(drafted.people), "reply_to": drafted.reply_to is not None},
    )
    return sent, True
