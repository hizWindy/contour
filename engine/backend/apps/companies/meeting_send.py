"""Sending a pre-read (PLAN-V17 T2-14): the email to the team, then its copy in HubSpot.

- **Who gets it:** Contour addresses only (`internal_email_domains`, choice 10). Every address
  goes through `only_internal`, and one that isn't Contour's refuses the whole send, naming it.
  Ticked by default: the Contour people on the meeting who have an account here: its owner and
  the other Contour people HubSpot lists on it, each through the `rep_of_owner` seam.
  An address the rep adds is ticked too, unless it isn't Contour's.
- **Before it goes:** the ideal next step and who is going are filled in (TBC with Levi).
- **The email:** in the body, never an attachment. The meeting, the facts, the three summaries
  ("Written by AI" on each, unless the rep wrote it), the ideal next step, who is going, and a
  link to the company. Every value is HTML escaped. Its key is the form's id and version, so a
  retry can't send it twice; and once sent, sending again emails nobody.
- **The copy in HubSpot** (choice 9): a note on the company, and on its deal when it has exactly
  one open deal, through the activity writer, after the email. Writing off: the email still goes,
  and the copy says "waiting". A company not in HubSpot: "off". Sending a sent pre-read again
  (the website's "Try the HubSpot copy again") tries a copy that is waiting or failed, without a
  second email. For a HubSpot meeting, while `meeting_note_on_meeting` is on, the note also goes
  at the end of the meeting's internal notes (the preview's `meeting_note` says so). The copy is
  saved once the note on the company is, whatever happens on the meeting.
"""

import html
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from urllib.parse import quote

from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.meeting_form import SUMMARY_NAMES, form_not_found, when_words
from apps.companies.meeting_job import app_url, email_sender
from apps.companies.meeting_store import EMPTY_SUMMARY, MeetingSource
from apps.companies.note_batch import ActivityWriter, one_open_deal
from apps.companies.note_store import WAITING_FOR_WRITES, sending_state
from apps.companies.notes import where_failed
from apps.companies.schemas import (
    FormEmailPreview,
    FormFact,
    FormPerson,
    FormRecipient,
    FormSummary,
)
from apps.companies.tables import MeetingForm
from core.api.errors import Problem
from core.auth.models import User
from core.auth.sessions import AuthContext
from core.config import Settings
from core.email.internal import only_internal
from core.email.sender import EmailError, EmailNotSetUp, send
from core.hubspot.activities import BODY_MAX_CHARS, ActivityRequest, NoteIn
from core.hubspot.client import HubSpotWritesOff
from core.hubspot.connection import open_hubspot

log = logging.getLogger(__name__)

APP = "companies"
SUBJECT_CHARS = 200
AI_MARK = "Written by AI"
SUMMARY_TITLES: Final = {
    "what_they_do": "What they do",
    "what_we_know": "What we know about the project",
    "talks_so_far": "The talks so far",
}
ON_MEETING = "on the meeting"
TYPED_IT = "typed this meeting in"
ADDED = "added by you"
# The preview's line when Send also adds the copy to the meeting (Track 3's Send dialog).
MEETING_NOTE = "The copy also goes at the end of the meeting's internal notes in HubSpot."

# --- The words (PLAN-V15 "Words for errors") ---------------------------------------------------

LEAD_ONLY = "This company isn't in HubSpot yet, so no copy was saved there."
# The website's button for a failed copy is "Try the HubSpot copy again" (Track 3), so the words
# don't name Send.
COPY_FAILED = "HubSpot didn't save the copy. Try it again: nobody is emailed twice."
COPY_UNSURE = (
    "HubSpot didn't answer, so the copy may or may not be there. Check the company in HubSpot."
)
COPY_FAULT = (
    "Something went wrong on our side while saving the copy in HubSpot. Try it again: nobody is "
    "emailed twice."
)


def outside_address(refused: Sequence[str]) -> Problem:
    return Problem(
        422,
        "Only Contour addresses",
        f"A pre-read goes to Contour addresses only, so nothing was sent. Take out: "
        f"{', '.join(refused)}.",
        code="outside_address",
    )


def blanks_empty() -> Problem:
    return Problem(
        422,
        "Two blanks to fill",
        "Fill in the ideal next step and who is going, then send it.",
        code="blanks_empty",
    )


def nobody_to_send() -> Problem:
    return Problem(
        422, "Nobody to send it to", "Pick at least one person to send it to.", code="no_one"
    )


def not_ready() -> Problem:
    return Problem(
        409,
        "Not ready to send",
        "This pre-read isn't ready to send. Wait for its draft, or draft it again.",
        code="form_not_ready",
    )


def email_not_set_up() -> Problem:
    return Problem(
        409,
        "Email isn't set up",
        "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send "
        "it once email is set up.",
        code="email_not_set_up",
    )


def email_failed() -> Problem:
    return Problem(
        502,
        "The email didn't go",
        "Nothing was sent. Try again in a minute.",
        code="email_failed",
    )


def being_sent() -> Problem:
    return Problem(
        409,
        "Being sent",
        "This pre-read is being sent right now. Wait a moment, then look again.",
        code="form_sending",
    )


# The pre-reads this backend is sending now. Send lets go of the row's lock while the email goes
# (no lock is held while we wait on the email service), so without this a second press in that
# moment would pass the "still a draft" check and email again. Only one backend runs at a time
# (the one-backend lock), so a set in this process is enough. The email's key would stop a second
# copy at Resend too, but not on the laptop's log sender.
_SENDING: set[uuid.UUID] = set()


# --- The email ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class FormEmail:
    subject: str
    text: str
    html: str


def company_link(settings: Settings, company_key: str) -> str:
    return f"{app_url(settings)}/companies/{quote(company_key, safe='')}"


def facts_of(form: MeetingForm) -> list[FormFact]:
    return [FormFact.model_validate(fact) for fact in form.facts if isinstance(fact, dict)]


def summaries_of(form: MeetingForm) -> list[tuple[str, FormSummary]]:
    saved = form.summaries if isinstance(form.summaries, dict) else {}
    found: list[tuple[str, FormSummary]] = []
    for name in SUMMARY_NAMES:
        summary = saved.get(name)
        found.append(
            (
                name,
                FormSummary.model_validate(summary) if isinstance(summary, dict) else EMPTY_SUMMARY,
            )
        )
    return found


def form_email(form: MeetingForm, settings: Settings) -> FormEmail:
    """The pre-read as the team gets it: a subject, plain text, and HTML with every value
    escaped."""
    company = form.company_name
    link = company_link(settings, form.company_key)
    subject = " ".join(f"Pre-read: {company}, {when_words(form.starts_at, None)}".split())
    facts = facts_of(form)
    summaries = summaries_of(form)

    lines = [f"Pre-read for the meeting with {company}", form.title, ""]
    lines += [f"{fact.label}: {fact.value}" for fact in facts]
    for name, summary in summaries:
        mark = f" ({AI_MARK})" if summary.by == "ai" else ""
        lines += ["", f"{SUMMARY_TITLES[name]}{mark}", summary.text or "Nothing yet."]
    lines += ["", "Ideal next step", form.next_step or "", "", "Who is going", form.going or ""]
    lines += ["", f"{company} in Contour: {link}"]

    def escaped(value: str) -> str:
        return html.escape(value, quote=True)

    def block(value: str) -> str:
        return "<p>" + "<br>".join(escaped(line) for line in value.splitlines()) + "</p>"

    parts = [
        f"<h2>Pre-read for the meeting with {escaped(company)}</h2>",
        f"<p><strong>{escaped(form.title)}</strong></p>",
        "<ul>"
        + "".join(
            f"<li><strong>{escaped(fact.label)}:</strong> {escaped(fact.value)}</li>"
            for fact in facts
        )
        + "</ul>",
    ]
    for name, summary in summaries:
        mark = f" <em>({AI_MARK})</em>" if summary.by == "ai" else ""
        parts += [
            f"<h3>{escaped(SUMMARY_TITLES[name])}{mark}</h3>",
            block(summary.text or "Nothing yet."),
        ]
    parts += [
        "<h3>Ideal next step</h3>",
        block(form.next_step or ""),
        "<h3>Who is going</h3>",
        block(form.going or ""),
        f'<p><a href="{escaped(link)}">{escaped(company)} in Contour</a></p>',
    ]
    return FormEmail(subject=subject[:SUBJECT_CHARS], text="\n".join(lines), html="".join(parts))


# --- The people -----------------------------------------------------------------------------------


async def account_names(session: AsyncSession, addresses: Sequence[str]) -> dict[str, str]:
    """The names of the accounts these addresses belong to, by address in lower case."""
    wanted = {address.strip().lower() for address in addresses if address.strip()}
    if not wanted:
        return {}
    rows = await session.execute(
        select(func.lower(User.email), User.name).where(func.lower(User.email).in_(wanted))
    )
    return {email: name for email, name in rows.all() if name}


async def meeting_people(
    session: AsyncSession, form: MeetingForm, source: MeetingSource
) -> list[tuple[str, str, str]]:
    """The Contour people on the meeting who have an account here (name, address, why): its
    owner and the other Contour people on it, or for a typed meeting the person who typed it.
    The same account twice is the caller's to skip."""
    if form.meeting_id is not None:
        meeting = await source.get(session, form.meeting_id)
        if meeting is None:
            return []
        people: list[tuple[str, str, str]] = []
        for owner_id in dict.fromkeys([meeting.owner_id, *meeting.attendee_owner_ids]):
            rep = await source.rep_of_owner(session, owner_id) if owner_id else None
            if rep is not None:
                people.append((rep[0], rep[1], ON_MEETING))
        return people
    if form.made_by is None:
        return []
    person = await session.get(User, form.made_by)
    return [(person.name, person.email, TYPED_IT)] if person is not None and person.email else []


async def preview(
    session: AsyncSession,
    form: MeetingForm,
    *,
    source: MeetingSource,
    settings: Settings,
    added: Sequence[str],
) -> FormEmailPreview:
    """The email as it would arrive, and the people: those on the meeting, then the addresses
    the rep added. Each says whether it may get it, and only those that may are ticked."""
    email = form_email(form, settings)
    domains = settings.internal_email_domains
    people: list[FormPerson] = []
    seen: set[str] = set()

    def add(name: str | None, address: str, why: str) -> None:
        key = address.strip().lower()
        if not key or key in seen:
            return
        seen.add(key)
        allowed = bool(only_internal([address], domains)[0])
        shown = key if allowed else address.strip()
        people.append(FormPerson(name=name, email=shown, why=why, ticked=allowed, allowed=allowed))

    for name, address, why in await meeting_people(session, form, source):
        add(name, address, why)
    names = await account_names(session, added)
    for address in added:
        add(names.get(address.strip().lower()), address, ADDED)
    await session.commit()
    return FormEmailPreview(
        subject=email.subject,
        text=email.text,
        html=email.html,
        people=people,
        meeting_note=MEETING_NOTE if goes_on_meeting(form, settings) else None,
    )


def goes_on_meeting(form: MeetingForm, settings: Settings) -> bool:
    """Whether Send also adds the copy to the meeting's internal notes: a HubSpot meeting, a
    company in HubSpot (else no copy is saved), and the switch on. Core's writer reads the
    switch again when it writes."""
    return (
        form.meeting_id is not None
        and not form.company_key.startswith("lead:")
        and settings.meeting_note_on_meeting
    )


# --- Sending --------------------------------------------------------------------------------------


async def send_form(
    session: AsyncSession,
    form: MeetingForm,
    to: Sequence[str],
    auth: AuthContext | None,
    *,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
    now: datetime,
) -> MeetingForm:
    """Emails the pre-read to Contour addresses only, then saves its copy in HubSpot. Sent
    already: nobody is emailed again, and a copy that is waiting or failed is tried again. A
    second press while it is being sent answers 409 `form_sending`."""
    if form.id in _SENDING:  # no await between the check and the claim
        raise being_sent()
    _SENDING.add(form.id)
    try:
        return await _send_once(
            session, form, to, auth, app=app, settings=settings, writer=writer, now=now
        )
    finally:
        _SENDING.discard(form.id)


async def _send_once(
    session: AsyncSession,
    form: MeetingForm,
    to: Sequence[str],
    auth: AuthContext | None,
    *,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
    now: datetime,
) -> MeetingForm:
    locked = await session.get(MeetingForm, form.id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise form_not_found()
    if locked.status == "sent":
        if locked.hubspot_copy in ("waiting", "failed"):
            await save_copy(session, locked, app=app, settings=settings, writer=writer)
        else:
            await session.commit()
        return locked
    if locked.status != "draft":
        raise not_ready()
    if not (locked.next_step or "").strip() or not (locked.going or "").strip():
        raise blanks_empty()
    allowed, refused = only_internal(to, settings.internal_email_domains)
    if refused:
        raise outside_address(refused)
    if not allowed:
        raise nobody_to_send()
    try:
        sender = email_sender(app, settings)
    except EmailNotSetUp:
        raise email_not_set_up() from None
    email = form_email(locked, settings)
    names = await account_names(session, allowed)
    form_id, version = locked.id, locked.version
    await session.commit()  # no lock is held while the email goes
    try:
        await send(
            allowed,
            email.subject,
            email.text,
            email.html,
            sender=sender,
            key=f"meeting-form:{form_id}:{version}",
        )
    except EmailNotSetUp:
        raise email_not_set_up() from None
    except EmailError as error:  # its title is plain words, and holds no address
        log.warning(
            "meeting_form_email_failed", extra={"form_id": str(form_id), "why": error.title}
        )
        raise email_failed() from None
    locked = await session.get(MeetingForm, form_id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise form_not_found()
    locked.sent_to = [
        FormRecipient(name=names.get(address), email=address).model_dump(mode="json")
        for address in allowed
    ]
    locked.sent_at = now
    locked.sent_by = auth.user.id if auth is not None else None
    # An edit while it went keeps it a draft: the new words weren't sent.
    sent = locked.version == version
    if sent:
        locked.status = "sent"
    await session.commit()
    if sent:
        await save_copy(session, locked, app=app, settings=settings, writer=writer)
    return locked


# --- The copy in HubSpot --------------------------------------------------------------------------


def copy_body(form: MeetingForm, settings: Settings) -> str:
    """The note on the company: the pre-read as plain text."""
    return form_email(form, settings).text[:BODY_MAX_CHARS]


async def copy_in_hubspot(
    session: AsyncSession,
    form: MeetingForm,
    *,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
) -> tuple[str, str | None, uuid.UUID | None]:
    """Saves the copy, and says how it went: (state, sentence, the write)."""
    if form.company_key.startswith("lead:"):
        return "off", LEAD_ONLY, None
    sending = sending_state(app, settings)
    if not sending.ready:
        return "waiting", sending.waiting_for, None
    request = ActivityRequest(
        app=APP,
        subject=f"meeting_form:{form.id}:{form.version}",
        company_id=form.company_key,
        deal_id=await one_open_deal(session, form.company_key),
        owner_id=await writer.owner_of(session, form.sent_by),
        note=NoteIn(body=copy_body(form, settings)),
        meeting_id=form.meeting_id,  # None for a typed one; core adds it only while switched on
    )
    form_id = form.id
    await session.commit()  # no lock is held while HubSpot works
    try:
        async with open_hubspot(app) as hubspot:
            if hubspot is None:
                raise HubSpotWritesOff()
            previewed = await writer.preview(session, hubspot, request)
            written = await writer.apply(session, hubspot, previewed.id)
    except HubSpotWritesOff:
        return "waiting", WAITING_FOR_WRITES, None
    except Exception as error:
        log.error(
            "meeting_form_copy_failed", extra={"form_id": str(form_id), **where_failed(error)}
        )
        return "failed", COPY_FAULT, None
    # The copy is the note on the company. With the meeting step on, a failed meeting step makes
    # the write `partial` while the note is saved, so the note's own step says how it went.
    note = next((item for item in written.steps if item.step == "note"), None)
    state = str(note.status) if note is not None else str(written.status)
    if state == "done":
        if written.status != "done":
            log.warning(
                "meeting_form_copy_meeting_step_not_done",
                extra={"form_id": str(form_id), "status": str(written.status)},
            )
        return "saved", None, previewed.id
    return "failed", COPY_UNSURE if state == "uncertain" else COPY_FAILED, previewed.id


async def save_copy(
    session: AsyncSession,
    form: MeetingForm,
    *,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
) -> None:
    form_id = form.id
    state, sentence, write_id = await copy_in_hubspot(
        session, form, app=app, settings=settings, writer=writer
    )
    locked = await session.get(MeetingForm, form_id, with_for_update=True, populate_existing=True)
    if locked is not None:
        locked.hubspot_copy = state
        locked.hubspot_copy_sentence = sentence
        if write_id is not None:
            locked.hubspot_write_id = write_id
    await session.commit()
