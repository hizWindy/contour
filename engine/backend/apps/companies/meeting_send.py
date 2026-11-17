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

import hashlib
import html
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
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
from apps.companies.notes import MELBOURNE, where_failed
from apps.companies.schemas import (
    MAX_RECIPIENTS,
    FormEmailPreview,
    FormFact,
    FormPerson,
    FormRecipient,
    FormSummary,
    TaskSendState,
    recipient_display_name,
)
from apps.companies.tables import MeetingForm
from core.api.errors import Problem
from core.auth.models import User
from core.auth.sessions import AuthContext
from core.config import Settings
from core.email.internal import only_internal
from core.email.sender import EmailError, EmailNotSetUp, send
from core.hubspot import owners as hubspot_owners
from core.hubspot.activities import BODY_MAX_CHARS, ActivityRequest, NoteIn, TaskIn
from core.hubspot.client import HubSpotWritesOff
from core.hubspot.connection import open_hubspot
from core.hubspot.models import HubSpotOwner, HubSpotWrite
from core.hubspot.writer import WriteOut

TITLE_CHARS = 300
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

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
PICKED = "picked by you"
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


def too_many_recipients() -> Problem:
    return Problem(
        422,
        "Too many people",
        f"Pick at most {MAX_RECIPIENTS} people at a time.",
        code="too_many_recipients",
    )


def owner_not_found() -> Problem:
    return Problem(
        422,
        "Person not found",
        "Pick active team members from the list.",
        code="owner_not_found",
    )


def hubspot_writes_off(detail: str | None = None) -> Problem:
    return Problem(
        409,
        "HubSpot writing is off",
        detail or "Turn on HubSpot writing, or tick Also email them to send by email instead.",
        code="hubspot_writes_off",
    )


def _task_failed_detail(names: Sequence[str]) -> str:
    cleaned = [n.strip() for n in names if n and n.strip()]
    if not cleaned:
        return "A HubSpot task didn't go. Try again."
    if len(cleaned) == 1:
        return f"{cleaned[0]}'s HubSpot task didn't go."
    joined = f"{', '.join(cleaned[:-1])} and {cleaned[-1]}"
    return f"{joined}'s HubSpot tasks didn't go."


def task_failed(names: Sequence[str]) -> Problem:
    return Problem(
        502,
        "HubSpot task didn't go",
        _task_failed_detail(names),
        code="task_failed",
    )


def task_due(form: MeetingForm, now: datetime) -> date:
    """Next working day (Melbourne time) before the meeting, clamped so it is never past."""
    mel_today = now.astimezone(MELBOURNE).date()
    meeting_day = form.starts_at.astimezone(MELBOURNE).date()
    candidate = meeting_day - timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate -= timedelta(days=1)
    if candidate >= mel_today:
        return candidate
    if mel_today.weekday() < 5:
        return mel_today
    days_to_monday = (7 - mel_today.weekday()) % 7 or 7
    next_monday = mel_today + timedelta(days=days_to_monday)
    return next_monday if meeting_day >= next_monday else mel_today


def task_subject(form: MeetingForm) -> str:
    mel = form.starts_at.astimezone(MELBOURNE)
    day_label = f"{WEEKDAYS[mel.weekday()]} {mel.day} {MONTHS[mel.month - 1]}"
    return f"Pre-read: {form.title} with {form.company_name}, {day_label}"[:TITLE_CHARS]


def task_body(form: MeetingForm, settings: Settings) -> str:
    """Plain-text HubSpot task body, always preserving links at the bottom when truncated."""
    site = app_url(settings)
    form_link = f"{site}/meetings?form={form.id}"
    comp_link = company_link(settings, form.company_key)
    parts: list[str] = []
    if form.next_step and form.next_step.strip():
        parts.append(f"Ideal next step\n{form.next_step.strip()}")
    if form.going and form.going.strip():
        parts.append(f"Who is going\n{form.going.strip()}")
    for heading, item in summaries_of(form):
        if not item.text.strip():
            continue
        title = SUMMARY_TITLES[heading]
        label = f"{title} ({AI_MARK})" if item.by == "ai" else title
        parts.append(f"{label}\n{item.text.strip()}")
    footer = f"Pre-read in Contour: {form_link}\n{form.company_name} in Contour: {comp_link}"
    head = "\n\n".join(parts)
    if not head:
        return footer[:BODY_MAX_CHARS]
    full = f"{head}\n\n{footer}"
    if len(full) <= BODY_MAX_CHARS:
        return full
    keep = max(0, BODY_MAX_CHARS - len(footer) - 5)
    if keep == 0:
        return footer[:BODY_MAX_CHARS]
    return f"{head[:keep].rstrip()}...\n\n{footer}"


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


@dataclass(frozen=True)
class OwnerTarget:
    owner_id: str
    name: str
    address: str | None
    why: str


type RepLookup = Callable[[AsyncSession, str], Awaitable[tuple[str, str] | None]]


def _emailable(address: str, domains: Sequence[str]) -> bool:
    """Whether a teammate's own address may get the pre-read email. An account can sign up with
    any address (a Gmail one, say), and the email goes to Contour addresses only (`only_internal`).
    Someone outside still gets their HubSpot task."""
    return bool(only_internal([address], domains).allowed)


def _rep_lookup(app: FastAPI | None, source: MeetingSource | None = None) -> RepLookup:
    if source is not None:
        return source.rep_of_owner
    attached = getattr(app.state, "meeting_source", None) if app is not None else None
    return attached.rep_of_owner if attached is not None else hubspot_owners.rep_of_owner


async def _resolve_owners(
    session: AsyncSession,
    owner_ids: Sequence[str],
    *,
    rep_of_owner: RepLookup,
    why_by_owner: dict[str, str] | None = None,
    strict: bool = False,
) -> list[OwnerTarget]:
    ordered = list(dict.fromkeys(oid.strip() for oid in owner_ids if oid and oid.strip()))
    if not ordered:
        return []
    rows = {
        row.owner_id: row
        for row in await session.scalars(
            select(HubSpotOwner).where(HubSpotOwner.owner_id.in_(ordered))
        )
    }
    targets: list[OwnerTarget] = []
    for owner_id in ordered:
        row = rows.get(owner_id)
        if row is not None and row.archived:
            if strict:
                raise owner_not_found()
            continue
        rep = await rep_of_owner(session, owner_id)
        if row is None and rep is None:
            if strict:
                raise owner_not_found()
            continue
        name = (
            rep[0]
            if rep is not None
            else hubspot_owners.shown_name(owner_id, row.name if row else None)
        )
        addr = rep[1].strip().lower() if rep is not None and rep[1] else None
        why = (why_by_owner or {}).get(owner_id, PICKED)
        targets.append(OwnerTarget(owner_id=owner_id, name=name, address=addr, why=why))
    return targets


def _prior_recipients(
    form: MeetingForm,
) -> tuple[dict[str, FormRecipient], dict[str, FormRecipient], list[FormRecipient]]:
    """Prior recipients on the current sent version, empty while the form is a draft."""
    if form.status != "sent":
        return {}, {}, []
    recipients = [
        FormRecipient.model_validate(item)
        for item in (form.sent_to or [])
        if isinstance(item, dict)
    ]
    by_owner = {r.owner_id: r for r in recipients if r.owner_id}
    by_addr = {r.address.strip().lower(): r for r in recipients if r.address}
    return by_owner, by_addr, recipients


def _address_digest(addresses: Sequence[str]) -> str:
    joined = ",".join(sorted({a.strip().lower() for a in addresses if a.strip()}))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:12]


async def meeting_people(
    session: AsyncSession, form: MeetingForm, source: MeetingSource
) -> list[OwnerTarget]:
    """The team members on the meeting (or for a typed meeting, its author's HubSpot owner)."""
    if form.meeting_id is not None:
        meeting = await source.get(session, form.meeting_id)
        if meeting is None:
            return []
        owner_ids = [
            oid for oid in dict.fromkeys([meeting.owner_id, *meeting.attendee_owner_ids]) if oid
        ]
        return await _resolve_owners(
            session,
            owner_ids,
            rep_of_owner=source.rep_of_owner,
            why_by_owner=dict.fromkeys(owner_ids, ON_MEETING),
            strict=False,
        )
    if form.made_by is None:
        return []
    person = await session.get(User, form.made_by)
    if person is None:
        return []
    if person.hubspot_owner_id:
        return [
            OwnerTarget(
                owner_id=person.hubspot_owner_id,
                name=person.name,
                address=person.email.strip().lower() if person.email else None,
                why=TYPED_IT,
            )
        ]
    return []


async def preview(
    session: AsyncSession,
    form: MeetingForm,
    *,
    source: MeetingSource,
    settings: Settings,
    owner_ids: Sequence[str] | None = None,
    emails: Sequence[str] = (),
    email_them: bool = False,
    now: datetime | None = None,
) -> FormEmailPreview:
    """The task and email preview, and who gets what (PLAN-V19 T1-8). Writes nothing."""
    email = form_email(form, settings)
    preview_now = now or datetime.now(UTC)
    domains = settings.internal_email_domains
    by_owner, by_addr, _ = _prior_recipients(form)

    meeting_targets = await meeting_people(session, form, source)
    why_by_owner = {t.owner_id: t.why for t in meeting_targets}
    if owner_ids is None:
        targets = meeting_targets
    else:
        targets = await _resolve_owners(
            session,
            owner_ids,
            rep_of_owner=source.rep_of_owner,
            why_by_owner=why_by_owner,
            strict=False,
        )

    people: list[FormPerson] = []
    owner_index_by_addr: dict[str, int] = {}

    # Typed meeting author with no linked HubSpot owner still starts ticked for email.
    typed_fallback_addrs: list[tuple[str, str]] = []
    if owner_ids is None and form.meeting_id is None and not targets and form.made_by is not None:
        author = await session.get(User, form.made_by)
        if author is not None and author.email:
            typed_fallback_addrs.append((author.name, author.email))

    for target in targets:
        prior = by_owner.get(target.owner_id)
        if prior is None and target.address:
            prior = by_addr.get(target.address)
        already = prior.at if prior is not None else None
        task_needed = prior is None
        email_needed = bool(
            prior is None and email_them and target.address and _emailable(target.address, domains)
        )
        idx = len(people)
        people.append(
            FormPerson(
                owner_id=target.owner_id,
                name=target.name,
                address=target.address if email_needed or (prior and prior.email) else None,
                task=task_needed,
                email=email_needed,
                why=target.why,
                already=already,
                ticked=already is None,
                allowed=True,
            )
        )
        if target.address:
            owner_index_by_addr[target.address] = idx

    extra_names = await account_names(session, [*(a for _, a in typed_fallback_addrs), *emails])
    seen_addrs: set[str] = set()

    def add_address(name: str | None, raw_address: str, why: str) -> None:
        key = raw_address.strip().lower()
        if not key or key in seen_addrs:
            return
        seen_addrs.add(key)
        allowed = bool(only_internal([raw_address], domains)[0])
        shown = key if allowed else raw_address.strip()
        prior = by_addr.get(key) if allowed else None
        if allowed and key in owner_index_by_addr:
            existing = people[owner_index_by_addr[key]]
            if existing.already is None and prior is None:
                people[owner_index_by_addr[key]] = existing.model_copy(
                    update={"address": key, "email": True, "ticked": True}
                )
            return
        already = prior.at if (allowed and prior is not None) else None
        will_email = allowed and prior is None
        people.append(
            FormPerson(
                owner_id=None,
                name=name or extra_names.get(key),
                address=shown,
                task=False,
                email=will_email,
                why=why,
                already=already,
                ticked=will_email,
                allowed=allowed,
            )
        )

    for fallback_name, fallback_addr in typed_fallback_addrs:
        add_address(fallback_name, fallback_addr, TYPED_IT)
    for raw in emails:
        add_address(None, raw, ADDED)

    await session.commit()
    return FormEmailPreview(
        subject=email.subject,
        text=email.text,
        html=email.html,
        task_subject=task_subject(form),
        task_due=task_due(form, preview_now),
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
    *,
    owner_ids: Sequence[str] = (),
    emails: Sequence[str] = (),
    email_them: bool = False,
    auth: AuthContext | None,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
    now: datetime,
) -> MeetingForm:
    """Creates HubSpot tasks, optionally sends email, and saves the HubSpot copy once.

    A second press while it is being sent answers 409 `form_sending`."""
    if form.id in _SENDING:  # no await between the check and the claim
        raise being_sent()
    _SENDING.add(form.id)
    try:
        return await _send_once(
            session,
            form,
            owner_ids=owner_ids,
            emails=emails,
            email_them=email_them,
            auth=auth,
            app=app,
            settings=settings,
            writer=writer,
            now=now,
        )
    finally:
        _SENDING.discard(form.id)


async def _run_hubspot_write(
    session: AsyncSession,
    app: FastAPI,
    writer: ActivityWriter,
    *,
    request: ActivityRequest | None = None,
    write_id: uuid.UUID | None = None,
) -> tuple[WriteOut | None, bool, Exception | None]:
    """Executes one HubSpot write (preview+apply or apply existing) without holding locks."""
    await session.commit()
    try:
        async with open_hubspot(app) as hubspot:
            if hubspot is None:
                raise HubSpotWritesOff()
            if write_id is None:
                assert request is not None
                previewed = await writer.preview(session, hubspot, request)
                written = await writer.apply(session, hubspot, previewed.id)
            else:
                written = await writer.apply(session, hubspot, write_id)
            return written, False, None
    except HubSpotWritesOff:
        return None, True, None
    except Exception as error:
        return None, False, error


def _merge_sent_to(
    prior_list: Sequence[FormRecipient],
    updates_by_owner: dict[str, FormRecipient],
    updates_by_addr: dict[str, FormRecipient],
    extras: Sequence[FormRecipient],
) -> list[dict[str, object]]:
    """Merges prior recipients with newly sent/updated recipients cleanly without duplicates."""
    merged: list[FormRecipient] = []
    consumed_owners: set[str] = set()
    consumed_addrs: set[str] = set()

    for old in prior_list:
        cur = old
        if old.owner_id and old.owner_id in updates_by_owner:
            upd = updates_by_owner[old.owner_id]
            consumed_owners.add(old.owner_id)
            if upd.address:
                consumed_addrs.add(upd.address.lower())
            cur = FormRecipient(
                owner_id=old.owner_id,
                name=upd.name or old.name,
                address=upd.address or old.address,
                at=upd.at or old.at,
                task=upd.task if upd.task != "none" else old.task,
                email=old.email or upd.email,
            )
        elif old.address and old.address.lower() in updates_by_addr:
            upd = updates_by_addr[old.address.lower()]
            consumed_addrs.add(old.address.lower())
            cur = FormRecipient(
                owner_id=old.owner_id,
                name=upd.name or old.name,
                address=old.address,
                at=upd.at or old.at,
                task=old.task,
                email=old.email or upd.email,
            )
        merged.append(cur)

    for oid, rec in updates_by_owner.items():
        if oid not in consumed_owners:
            merged.append(rec)
            if rec.address:
                consumed_addrs.add(rec.address.lower())

    for rec in extras:
        key = (rec.address or "").lower()
        if key and key not in consumed_addrs:
            merged.append(rec)
            consumed_addrs.add(key)

    return [r.model_dump(mode="json") for r in merged]


async def _send_once(
    session: AsyncSession,
    form: MeetingForm,
    *,
    owner_ids: Sequence[str],
    emails: Sequence[str],
    email_them: bool,
    auth: AuthContext | None,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
    now: datetime,
) -> MeetingForm:
    locked = await session.get(MeetingForm, form.id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise form_not_found()
    if locked.status not in ("draft", "sent"):
        raise not_ready()
    if not (locked.next_step or "").strip() or not (locked.going or "").strip():
        raise blanks_empty()

    allowed_emails, refused = only_internal(emails, settings.internal_email_domains)
    if refused:
        raise outside_address(refused)
    clean_emails = list(dict.fromkeys(allowed_emails))
    owner_targets = await _resolve_owners(
        session, owner_ids, rep_of_owner=_rep_lookup(app), strict=True
    )
    if not owner_targets and not clean_emails:
        raise nobody_to_send()

    total_people = len(owner_targets) + len(
        [a for a in clean_emails if all(t.address != a for t in owner_targets)]
    )
    if total_people > MAX_RECIPIENTS:
        raise too_many_recipients()

    was_sent = locked.status == "sent"
    prior_by_owner, prior_by_addr, prior_list = _prior_recipients(locked)

    def _prior_for_owner(target: OwnerTarget) -> FormRecipient | None:
        return prior_by_owner.get(target.owner_id) or (
            prior_by_addr.get(target.address) if target.address else None
        )

    pending_task_owners = [t for t in owner_targets if _prior_for_owner(t) is None]

    extra_names = await account_names(session, clean_emails)
    pending_emails: list[str] = []
    emailed_set: set[str] = set()
    for t in owner_targets:
        prior = _prior_for_owner(t)
        if (
            email_them
            and t.address
            and _emailable(t.address, settings.internal_email_domains)
            and prior is None
            and t.address not in emailed_set
        ):
            pending_emails.append(t.address)
            emailed_set.add(t.address)
    for addr in clean_emails:
        prior = prior_by_addr.get(addr)
        if prior is None and addr not in emailed_set:
            pending_emails.append(addr)
            emailed_set.add(addr)

    lead_only = locked.company_key.startswith("lead:")
    need_copy = not lead_only and (not was_sent or locked.hubspot_copy != "saved")
    hs_ready = sending_state(app, settings)

    if pending_task_owners and not pending_emails and not lead_only and not hs_ready.ready:
        raise hubspot_writes_off(hs_ready.waiting_for)

    nothing_new_for_people = not pending_task_owners and not pending_emails
    if was_sent and nothing_new_for_people:
        if locked.hubspot_copy in ("waiting", "failed"):
            await save_copy(session, locked, app=app, settings=settings, writer=writer)
        else:
            await session.commit()
        return locked

    sender = None
    if pending_emails:
        try:
            sender = email_sender(app, settings)
        except EmailNotSetUp:
            raise email_not_set_up() from None

    email_doc = form_email(locked, settings)
    form_id, version = locked.id, locked.version
    deal_id = None if lead_only else await one_open_deal(session, locked.company_key)
    rep_owner_id = (
        await writer.owner_of(session, auth.user.id if auth is not None else None)
        if not lead_only
        else None
    )
    t_subject = task_subject(locked)
    t_due = task_due(locked, now)
    t_body = task_body(locked, settings)
    c_body = copy_body(locked, settings)
    c_meeting_id = locked.meeting_id

    await session.commit()  # release row lock before slow network I/O

    if pending_emails and sender is not None:
        email_key = (
            f"meeting-form:{form_id}:{version}"
            if not was_sent
            else f"meeting-form:{form_id}:{version}:more:{_address_digest(pending_emails)}"
        )
        try:
            await send(
                pending_emails,
                email_doc.subject,
                email_doc.text,
                email_doc.html,
                sender=sender,
                key=email_key,
            )
        except EmailNotSetUp:
            raise email_not_set_up() from None
        except EmailError as error:
            log.warning(
                "meeting_form_email_failed", extra={"form_id": str(form_id), "why": error.title}
            )
            raise email_failed() from None

    task_outcomes: dict[str, TaskSendState] = {}
    copy_state: str | None = None
    copy_sentence: str | None = None
    write_id: uuid.UUID | None = None

    if lead_only:
        for t in pending_task_owners:
            task_outcomes[t.owner_id] = "none"
        if need_copy:
            copy_state, copy_sentence = "off", LEAD_ONLY
    elif pending_task_owners or need_copy:
        if not hs_ready.ready:
            for t in pending_task_owners:
                task_outcomes[t.owner_id] = "waiting"
            if need_copy:
                copy_state, copy_sentence = "waiting", hs_ready.waiting_for
        else:
            batch_subject = (
                f"meeting_form:{form_id}:{version}"
                if need_copy and not was_sent
                else f"meeting_form:{form_id}:{version}:b:{uuid.uuid4().hex[:8]}"
            )
            hs_request = ActivityRequest(
                app=APP,
                subject=batch_subject,
                company_id=locked.company_key,
                deal_id=deal_id,
                owner_id=rep_owner_id,
                tasks=[
                    TaskIn(
                        subject=t_subject,
                        body=t_body,
                        due=t_due,
                        kind="todo",
                        priority="medium",
                        owner_id=t.owner_id,
                    )
                    for t in pending_task_owners
                ],
                note=NoteIn(body=c_body) if need_copy else None,
                meeting_id=c_meeting_id if need_copy else None,
            )
            written, writes_off_now, write_err = await _run_hubspot_write(
                session, app, writer, request=hs_request
            )
            if writes_off_now:
                for t in pending_task_owners:
                    task_outcomes[t.owner_id] = "waiting"
                if need_copy:
                    copy_state, copy_sentence = "waiting", WAITING_FOR_WRITES
            elif write_err is not None or written is None:
                if write_err is not None:
                    log.error(
                        "meeting_form_copy_failed",
                        extra={"form_id": str(form_id), **where_failed(write_err)},
                    )
                for t in pending_task_owners:
                    task_outcomes[t.owner_id] = "failed"
                if need_copy:
                    copy_state, copy_sentence = "failed", COPY_FAULT
            else:
                write_id = written.id
                steps_by_name = {s.step: str(s.status) for s in written.steps}
                for idx, t in enumerate(pending_task_owners, start=1):
                    step_status = steps_by_name.get(f"task:{idx}")
                    if step_status is None:
                        step_status = str(written.status) if not written.steps else "failed"
                    task_outcomes[t.owner_id] = "sent" if step_status == "done" else "failed"
                if need_copy:
                    note_status = steps_by_name.get("note")
                    if note_status is None:
                        note_status = str(written.status)
                    if note_status == "done":
                        copy_state, copy_sentence = "saved", None
                    elif note_status == "uncertain":
                        copy_state, copy_sentence = "failed", COPY_UNSURE
                    else:
                        copy_state, copy_sentence = "failed", COPY_FAILED

    locked = await session.get(MeetingForm, form_id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise form_not_found()

    updates_by_owner: dict[str, FormRecipient] = {}
    updates_by_addr: dict[str, FormRecipient] = {}
    for t in owner_targets:
        prior = _prior_for_owner(t)
        if prior is not None and t.owner_id not in task_outcomes and t.address not in emailed_set:
            continue
        emailed_now = t.address in emailed_set
        updates_by_owner[t.owner_id] = FormRecipient(
            owner_id=t.owner_id,
            name=t.name,
            address=t.address if (emailed_now or (prior and prior.email)) else None,
            at=now,
            task=task_outcomes.get(t.owner_id, prior.task if prior else "none"),
            email=emailed_now or bool(prior and prior.email),
        )

    extras: list[FormRecipient] = []
    for addr in clean_emails:
        prior = prior_by_addr.get(addr)
        emailed_now = addr in emailed_set
        if prior is not None and not emailed_now:
            continue
        rec = FormRecipient(
            owner_id=None,
            name=extra_names.get(addr) or (prior.name if prior else None),
            address=addr,
            at=now,
            task=prior.task if prior else "none",
            email=emailed_now or bool(prior and prior.email),
        )
        updates_by_addr[addr] = rec
        extras.append(rec)

    base_prior = prior_list if (was_sent and locked.version == version) else []
    locked.sent_to = _merge_sent_to(base_prior, updates_by_owner, updates_by_addr, extras)
    if not was_sent or locked.version != version:
        locked.sent_at = now
        locked.sent_by = auth.user.id if auth is not None else None
    if locked.version == version:
        locked.status = "sent"
        if copy_state is not None:
            locked.hubspot_copy = copy_state
            locked.hubspot_copy_sentence = copy_sentence
        if write_id is not None:
            locked.hubspot_write_id = write_id
    await session.commit()
    return locked


async def retry_tasks(
    session: AsyncSession,
    form: MeetingForm,
    *,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
    now: datetime,
) -> MeetingForm:
    """Retries failed HubSpot tasks on a sent pre-read without sending emails (PLAN-V19 T1-8).

    It takes the same claim as a send, so a second press, or a send to more people at that
    moment, answers 409 `form_sending` instead of making the tasks twice."""
    if form.id in _SENDING:  # no await between the check and the claim
        raise being_sent()
    _SENDING.add(form.id)
    try:
        return await _retry_once(session, form, app=app, settings=settings, writer=writer, now=now)
    finally:
        _SENDING.discard(form.id)


async def _retry_once(
    session: AsyncSession,
    form: MeetingForm,
    *,
    app: FastAPI,
    settings: Settings,
    writer: ActivityWriter,
    now: datetime,
) -> MeetingForm:
    """One retry. The send's write is applied again when it holds every failed task: the writer
    redoes only the steps that aren't done, and looks in HubSpot first for a task it may have
    made ("uncertain"), so a task is never made twice (core/hubspot/activities.py, "Never
    twice")."""
    if form.status != "sent":
        raise not_ready()
    recipients = [
        FormRecipient.model_validate(item)
        for item in (form.sent_to or [])
        if isinstance(item, dict)
    ]
    failed = [r for r in recipients if r.owner_id and r.task in ("failed", "waiting")]
    if not failed:
        return form
    if form.company_key.startswith("lead:"):
        return form
    hs_ready = sending_state(app, settings)
    if not hs_ready.ready:
        raise hubspot_writes_off(hs_ready.waiting_for)

    failed_owners = [r.owner_id for r in failed if r.owner_id is not None]
    existing_row = (
        await session.get(HubSpotWrite, form.hubspot_write_id)
        if form.hubspot_write_id is not None
        else None
    )
    can_reapply_existing = False
    existing_step_owners: dict[str, str] = {}
    if existing_row is not None and existing_row.status in ("partial", "failed", "uncertain"):
        plan_req = (existing_row.plan or {}).get("request") or {}
        plan_tasks = plan_req.get("tasks") or []
        step_statuses = {
            s.get("step"): s.get("status")
            for s in ((existing_row.result or {}).get("steps") or [])
            if isinstance(s, dict)
        }
        pending_step_owners: set[str] = set()
        for idx, t_item in enumerate(plan_tasks, start=1):
            step_name = f"task:{idx}"
            owner = t_item.get("owner_id") if isinstance(t_item, dict) else None
            if owner:
                existing_step_owners[step_name] = owner
                if step_statuses.get(step_name) != "done":
                    pending_step_owners.add(owner)
        can_reapply_existing = set(failed_owners) <= pending_step_owners

    need_copy = form.hubspot_copy != "saved"
    if can_reapply_existing and existing_row is not None:
        written, writes_off_now, write_err = await _run_hubspot_write(
            session, app, writer, write_id=existing_row.id
        )
    else:
        deal_id = await one_open_deal(session, form.company_key)
        rep_owner_id = await writer.owner_of(session, form.sent_by)
        hs_request = ActivityRequest(
            app=APP,
            subject=f"meeting_form:{form.id}:{form.version}:r:{uuid.uuid4().hex[:8]}",
            company_id=form.company_key,
            deal_id=deal_id,
            owner_id=rep_owner_id,
            tasks=[
                TaskIn(
                    subject=task_subject(form),
                    body=task_body(form, settings),
                    due=task_due(form, now),
                    kind="todo",
                    priority="medium",
                    owner_id=oid,
                )
                for oid in failed_owners
            ],
            note=NoteIn(body=copy_body(form, settings)) if need_copy else None,
            meeting_id=form.meeting_id if need_copy else None,
        )
        written, writes_off_now, write_err = await _run_hubspot_write(
            session, app, writer, request=hs_request
        )

    if writes_off_now:
        raise hubspot_writes_off(WAITING_FOR_WRITES)

    outcomes: dict[str, TaskSendState] = {}
    if write_err is not None or written is None:
        if write_err is not None:
            log.error(
                "meeting_form_task_retry_failed",
                extra={"form_id": str(form.id), **where_failed(write_err)},
            )
        outcomes = dict.fromkeys(failed_owners, "failed")
    else:
        steps_by_name = {s.step: str(s.status) for s in written.steps}
        if can_reapply_existing:
            for step_name, oid in existing_step_owners.items():
                if oid in failed_owners:
                    outcomes[oid] = "sent" if steps_by_name.get(step_name) == "done" else "failed"
        else:
            for idx, oid in enumerate(failed_owners, start=1):
                st = steps_by_name.get(f"task:{idx}")
                if st is None:
                    st = str(written.status) if not written.steps else "failed"
                outcomes[oid] = "sent" if st == "done" else "failed"

    locked = await session.get(MeetingForm, form.id, with_for_update=True, populate_existing=True)
    if locked is None:
        raise form_not_found()

    updated_list: list[FormRecipient] = []
    still_failed_names: list[str] = []
    for r in [
        FormRecipient.model_validate(item)
        for item in (locked.sent_to or [])
        if isinstance(item, dict)
    ]:
        if r.owner_id and r.owner_id in outcomes:
            new_state = outcomes[r.owner_id]
            updated = r.model_copy(
                update={"task": new_state, "at": now if new_state == "sent" else r.at}
            )
            updated_list.append(updated)
            if new_state == "failed":
                still_failed_names.append(recipient_display_name(updated))
        else:
            updated_list.append(r)

    locked.sent_to = [r.model_dump(mode="json") for r in updated_list]
    if written is not None:
        locked.hubspot_write_id = written.id
        if need_copy:
            note_status = next((str(s.status) for s in written.steps if s.step == "note"), None)
            if note_status == "done":
                locked.hubspot_copy = "saved"
                locked.hubspot_copy_sentence = None
    await session.commit()

    if still_failed_names:
        raise task_failed(still_failed_names)
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
