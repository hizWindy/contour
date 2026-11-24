"""What a command's review card shows (PLAN-V22 T1-1 and T1-2): Claude's answer, checked and filled
in by code (assistant_find.py), as the contract's `AssistantCommand`. The read-back is the card's
first line (choice 21), and `unsure` a short line when something wasn't clear or found.

- **Only what this person may use.** A pre-read needs the Meetings tick and Meetings switched on,
  and a call the Call logs tick. Anything else comes back as unknown, with what they can do.
- **On an open card,** only change (one of its boxes), send and cancel. Without a card, those
  three are unknown (choice 14).
- **Unclear words stop before the card** (PLAN-V23 choice 4), on a card or not: `unclear`, with
  the words as heard in the read-back, for the bar's text line, and the stop line in `unsure`.
- Nothing here writes or sends: the review card does that, through the routes that exist.
"""

import re
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any, Final, get_args

from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.assistant_find import (
    SAME_PERSON,
    Context,
    OnScreen,
    clean_line,
    company_hit,
    day_of,
    day_words,
    email_recipients,
    find_company,
    find_meeting,
    find_person_anywhere,
    find_person_at,
    follow_up_day,
    heard,
    means_same,
    note_after_cut,
    on_screen,
    task_due,
    task_owner,
    team_of,
    time_words,
    which,
)
from apps.companies.assistant_form import CommandAnswer
from apps.companies.assistant_research import research_command
from apps.companies.assistant_schemas import (
    AssistantAction,
    AssistantChange,
    AssistantCommand,
    AssistantCompany,
    AssistantEmail,
    AssistantMeeting,
    AssistantOpen,
    AssistantPageName,
    AssistantPerson,
    AssistantTask,
)
from apps.companies.call_words import QUICK_OUTCOMES, call_type_of, call_type_said, only_outcome
from apps.companies.meeting_store import meeting_forms_off
from apps.companies.note_dates import next_working_day
from apps.companies.notes import MELBOURNE
from core.api.access import can_feature, feature_not_allowed
from core.auth import users

UNSURE_CHARS: Final = 200  # Claude's own unsure line
UNCLEAR_CHARS: Final = 300  # the words as heard, shown back when they were unclear
UNSURE_MAX: Final = 600  # every line together
SUBJECT_CHARS: Final = 200  # a task's (the contract's part 3)
EMAIL_SUBJECT_CHARS: Final = 120  # an email's (the contract's part 4)
BODY_CHARS: Final = 4_000
VALUE_CHARS: Final = 2_000
SAID_CHARS: Final = 120

# --- The words -----------------------------------------------------------------------------------

CAN_ON_CARD = (
    "On this card, the Assistant can change a box, send it or cancel it. Try saying it as one "
    "of those."
)


def unclear_line(words: str) -> str:
    """PLAN-V23 "Words for when things go wrong": the words are too unclear."""
    return f"We didn't catch that clearly. You said: '{words}'. Say it again, or fix the words."


NO_COMPANY = "No company was named. Pick the company."
NO_ONE = "No teammate was named. Pick who gets it."
OTHER_BOX = "That isn't one of this card's boxes."
NOT_A_CALL_TYPE = (
    "That isn't one of HubSpot's call types: Prospecting Call, Follow Up Call or "
    "Agent/Networking Phone Call."
)
CALL_TYPE_BOXES: Final = frozenset({"call_type", "call type", "type"})
WEEK: Final = 7
PAGE_WORDS: Final = {
    "home": "Home",
    "today": "Today",
    "meetings": "Meetings",
    "call_logs": "Call logs",
    "companies": "Companies",
    "lead_finder": "the Lead Finder",
}
PAGES: Final[dict[str, AssistantPageName]] = {page: page for page in get_args(AssistantPageName)}


def join_words(items: Sequence[str], last: str) -> str:
    """'a, b or c'."""
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} {last} {items[-1]}"


def sentence(text: str) -> str:
    return text if not text or text.endswith((".", "?", "!")) else f"{text}."


def lines(*parts: str | None) -> str | None:
    """The unsure lines, the first ones first, in one short paragraph."""
    text = " ".join(part for part in parts if part)
    return text[:UNSURE_MAX] if text else None


def command(
    action: AssistantAction,
    read_back: str,
    *,
    company: AssistantCompany | None = None,
    person: AssistantPerson | None = None,
    meeting: AssistantMeeting | None = None,
    note_text: str | None = None,
    task: AssistantTask | None = None,
    email: AssistantEmail | None = None,
    opens: AssistantOpen | None = None,
    change: AssistantChange | None = None,
    unsure: str | None = None,
    **call: Any,
) -> AssistantCommand:
    return AssistantCommand(
        action=action,
        read_back=read_back,
        company=company,
        person=person,
        meeting=meeting,
        note_text=note_text,
        task=task,
        email=email,
        open=opens,
        change=change,
        unsure=unsure,
        **call,
    )


# --- Who may do what -----------------------------------------------------------------------------


def may_pre_read(ctx: Context) -> bool:
    return can_feature(ctx.auth, "companies.meetings") and ctx.settings.meeting_forms_enabled


def may_log_call(ctx: Context) -> bool:
    return can_feature(ctx.auth, "companies.call_logs")


def can_do(ctx: Context) -> str:
    """What the Assistant can do for this person, as choice 14 says it."""
    things = ["make a pre-read"] if may_pre_read(ctx) else []
    things += ["log a call"] if may_log_call(ctx) else []
    things += ["add a task", "email teammates", "research a company", "open a page"]
    return f"The Assistant can {join_words(things, 'or')}. Try saying it as one of those."


async def not_open(session: AsyncSession, action: AssistantAction, ctx: Context) -> str | None:
    """Why this person can't use this action now, in plain words, or None when they can."""
    if action == "pre_read" and not can_feature(ctx.auth, "companies.meetings"):
        asker = await users.platform_admin_name(session)
        return feature_not_allowed("companies.meetings", asker).detail
    if action == "pre_read" and not ctx.settings.meeting_forms_enabled:
        return meeting_forms_off().detail
    if action == "log_call" and not may_log_call(ctx):
        asker = await users.platform_admin_name(session)
        return feature_not_allowed("companies.call_logs", asker).detail
    return None


# --- Claude's answer, settled ---------------------------------------------------------------------


async def settle(session: AsyncSession, answer: CommandAnswer, ctx: Context) -> AssistantCommand:
    """The card's draft for Claude's answer. Reads our copy, and HubSpot's own search reads a
    company it finds into it (PLAN-V23 T1-3): nothing else is written."""
    claude = sentence(clean_line(answer.unsure, UNSURE_CHARS)) or None
    if answer.action == "unclear":
        return unclear(ctx)
    if ctx.card is not None:
        return on_card(answer, ctx, claude)
    action = answer.action
    if action in ("change", "send", "cancel", "unknown"):
        return command("unknown", can_do(ctx), unsure=claude)
    refused = await not_open(session, action, ctx)
    if refused is not None:
        return command("unknown", can_do(ctx), unsure=refused)
    if action == "pre_read":
        return await pre_read(session, answer, ctx, claude)
    if action == "log_call":
        return await log_call(session, answer, ctx, claude)
    if action == "task":
        return await add_task(session, answer, ctx, claude)
    if action == "email":
        return await write_email(session, answer, ctx, claude)
    if action == "research":  # PLAN-V27 T4-1: free, from what we know
        return await research_command(session, answer, ctx)
    return await open_page(session, answer, ctx, claude)


def unclear(ctx: Context) -> AssistantCommand:
    """The words were too unclear to make a command: they come back as heard, to fix or say
    again."""
    words = clean_line(ctx.said, UNCLEAR_CHARS)
    return command("unclear", words, unsure=unclear_line(words))


def on_card(answer: CommandAnswer, ctx: Context, claude: str | None) -> AssistantCommand:
    """On an open card: change one of its boxes, send or cancel. Anything else is unknown."""
    if answer.action == "send":
        return command("send", "Send it.", unsure=claude)
    if answer.action == "cancel":
        return command("cancel", "Cancel it.", unsure=claude)
    boxes = ctx.card.boxes if ctx.card is not None else []
    wanted = answer.box.strip().casefold()
    box = next((name for name in boxes if name.casefold() == wanted), None)
    if answer.action != "change" or box is None:
        why = OTHER_BOX if answer.action == "change" else None
        return command("unknown", CAN_ON_CARD, unsure=lines(why, claude))
    value = clean_line(answer.value, VALUE_CHARS)
    if box.casefold() in CALL_TYPE_BOXES:  # "make it a follow-up call" (PLAN-V25 T3-1)
        kind = call_type_said(value) or call_type_said(ctx.said)
        if kind is None:
            return command("unknown", CAN_ON_CARD, unsure=lines(NOT_A_CALL_TYPE, claude))
        change = AssistantChange(box=box, value=kind, day=None)
        return command("change", f"Change the call type to {kind}.", change=change, unsure=claude)
    day = day_of(answer.when, ctx.today)
    words = day_words(day, ctx.today) if day is not None else value
    read_back = f"Change {box.replace('_', ' ')} to {words}." if words else f"Clear {box}."
    change = AssistantChange(box=box, value=value, day=day)
    return command("change", read_back, change=change, unsure=claude)


async def pre_read(
    session: AsyncSession, answer: CommandAnswer, ctx: Context, claude: str | None
) -> AssistantCommand:
    screen = await on_screen(session, ctx)
    company, company_line = await find_company(session, answer.company, screen.company, ctx)
    meeting, meeting_line = await find_meeting(
        session, answer.meeting, answer.when, company, screen, ctx
    )
    if company.found is None and not company.heard and meeting.found is not None:
        hit = await company_hit(session, meeting.found.company_key, ctx.leads)  # my own meeting's
        company = AssistantCompany(heard="", from_page=meeting.from_page, found=hit, choices=[])
    if company.found is None and not company.heard and not meeting.choices:
        company_line = NO_COMPANY
    return command(
        "pre_read",
        pre_read_words(company, meeting, ctx),
        company=company,
        meeting=meeting,
        unsure=lines(company_line, meeting_line, claude),
    )


def pre_read_words(company: AssistantCompany, meeting: AssistantMeeting, ctx: Context) -> str:
    """'Draft the pre-read for the meeting with Sample Logistics on Thu 5 Nov at 10:00 am.'"""
    found = meeting.found
    if found is not None:
        verb = "Draft" if found.form is None else "Open"
        when = day_words(found.starts_at.astimezone(MELBOURNE).date(), ctx.today)
        return (
            f"{verb} the pre-read for the meeting with {found.company_name} on {when} at "
            f"{time_words(found.starts_at)}."
        )
    if company.found is not None:
        return f"Draft a pre-read for {company.found.name}."
    return "Draft a pre-read."


async def log_call(
    session: AsyncSession, answer: CommandAnswer, ctx: Context, claude: str | None
) -> AssistantCommand:
    screen = await on_screen(session, ctx)
    company, company_line = await find_company(session, answer.company, screen.company, ctx)
    person, person_line = await find_person_at(session, answer.person, company, ctx.last)
    if person_first(company, person):
        anywhere, anywhere_line = await find_person_anywhere(session, answer.person, ctx)
        if anywhere.choices or company.found is None:
            # Found elsewhere, or no company at all: the person comes first (PLAN-V25 T2-1).
            company = AssistantCompany(heard="", from_page=False, found=None, choices=[])
            person, person_line, company_line = anywhere, anywhere_line, None
    follow_up = follow_up_day(answer.when, ctx.today)
    who = person.found.name if person.found is not None else person.heard
    where = company.found.name if company.found is not None else company.heard
    with_whom = " at ".join(part for part in (who, where) if part)
    read_back = f"Log a call with {with_whom}." if with_whom else "Log a call."
    if follow_up is not None:
        read_back += f" Follow-up task on {day_words(follow_up, ctx.today)}."
    no_company = None if company.found or person.heard else NO_COMPANY
    unsure = lines(company_line or no_company, person_line, claude)
    names = [person.heard, company.heard]
    names += [found.name for found in (person.found, company.found) if found is not None]
    outcome = only_outcome(ctx.said, names)
    quick = (
        outcome in QUICK_OUTCOMES
        and company.found is not None
        and company.level == "sure"
        and person.found is not None
        and follow_up is None
        and unsure is None
    )
    return command(
        "log_call",
        read_back,
        company=company,
        person=person,
        note_text=note_after_cut(ctx.said, answer.note_cut),
        unsure=unsure,
        call_type=call_type_of(answer.note_cut, ctx.said),
        outcome=outcome,
        quick=quick,
        follow_up_day=next_working_day(ctx.today),
    )


def person_first(company: AssistantCompany, person: AssistantPerson) -> bool:
    """A person named with no company said (PLAN-V25 choice 8) is searched for everywhere when
    there is no company, or when the one on screen doesn't have them. A company said still wins
    (T2-1)."""
    if company.heard or not person.heard or means_same(person.heard, SAME_PERSON):
        return False
    return company.found is None or (person.found is None and not person.choices)


async def add_task(
    session: AsyncSession, answer: CommandAnswer, ctx: Context, claude: str | None
) -> AssistantCommand:
    screen = await on_screen(session, ctx)
    company, company_line = await find_company(session, answer.company, screen.company, ctx)
    team = await team_of(session, ctx) if heard(answer.task_for) else []
    owner = task_owner(answer.task_for, team)
    due, why = task_due(answer.when, ctx.today)
    said_day = answer.when.strip().casefold() not in ("", "unknown")
    guessed = why == "the date couldn't be read" or not said_day
    subject = clean_line(answer.subject, SUBJECT_CHARS)
    suggested = not subject
    if suggested:  # never a blank box (PLAN-V25 choice 13)
        about = company.found.name if company.found is not None else ""
        subject = clean_line(f"Follow up with {about}" if about else "Follow up", SUBJECT_CHARS)
    task = AssistantTask(
        subject=subject,
        due=due,
        due_words=clean_line(answer.when_said, SAID_CHARS),
        kind=answer.kind,
        owner_id=owner.found.owner_id if owner is not None and owner.found is not None else None,
        owner=owner,
        due_level="likely" if guessed else "sure",
        due_choices=[due, week_after(due)] if guessed else [],
        subject_suggested=suggested,
    )
    owner_line = None
    if owner is not None and owner.found is None:
        owner_line = which(owner.heard) if owner.choices else owner.problem
    date_line = None
    if why and said_day:  # a day said but moved or unread; none said is a suggestion instead
        date_line = f"Check the date: {why}, so it is due on the next working day."
    return command(
        "task",
        task_words(task, company, ctx),
        company=company,
        task=task,
        unsure=lines(
            company_line or (None if company.found else NO_COMPANY), owner_line, date_line, claude
        ),
    )


def week_after(day: date) -> date:
    """'In a week': the same weekday a week on, a working day by then."""
    return day + timedelta(days=WEEK)


def task_words(task: AssistantTask, company: AssistantCompany, ctx: Context) -> str:
    """'Add a task about Sample Logistics: Send the quote. Due Mon 9 Nov. It's for Lee Sample.'"""
    about = f" about {company.found.name}" if company.found is not None else ""
    what = f": {task.subject}" if task.subject else ""
    words = f"Add a task{about}{what}. Due {day_words(task.due, ctx.today)}."
    if task.owner is not None and task.owner.found is not None:
        words += f" It's for {task.owner.found.name}."
    return words


async def write_email(
    session: AsyncSession, answer: CommandAnswer, ctx: Context, claude: str | None
) -> AssistantCommand:
    company: AssistantCompany | None = None
    company_line: str | None = None
    if heard(answer.company):  # a company named in an email adds its link (the contract's part 4)
        company, company_line = await find_company(session, answer.company, None, ctx)
    team = await team_of(session, ctx)
    to = email_recipients(answer.to, ctx.typed, team, ctx.settings.internal_email_domains)
    email = AssistantEmail(
        to=to,
        subject=clean_line(answer.subject, EMAIL_SUBJECT_CHARS),
        body=clean_body(answer.body),
    )
    first_choice = next((which(item.heard) for item in to if item.choices), None)
    first_problem = next((item.problem for item in to if item.problem), None)
    return command(
        "email",
        email_words(email),
        company=company,
        email=email,
        unsure=lines(company_line, NO_ONE if not to else None, first_choice, first_problem, claude),
    )


def clean_body(text: str) -> str:
    """An email's body: its own lines, each tidied as a card line, at most one blank between."""
    body = "\n".join(clean_line(line, BODY_CHARS) for line in text.splitlines())
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body if len(body) <= BODY_CHARS else f"{body[: BODY_CHARS - 3].rstrip()}..."


def email_words(email: AssistantEmail) -> str:
    """'Email Lee Sample and Jo Sample: Quote for Sample Logistics.'"""
    names = [
        item.found.name if item.found is not None else (item.address or item.heard)
        for item in email.to
    ]
    who = join_words(names, "and") if names else "teammates"
    return f"Email {who}: {email.subject}." if email.subject else f"Email {who}."


async def open_page(
    session: AsyncSession, answer: CommandAnswer, ctx: Context, claude: str | None
) -> AssistantCommand:
    page = PAGES.get(answer.page)
    if page is None:
        return command("unknown", can_do(ctx), unsure=claude)
    if page != "company":
        opens = AssistantOpen(page=page, company_key=None)
        return command("open", f"Open {PAGE_WORDS[page]}.", opens=opens, unsure=claude)
    screen: OnScreen = await on_screen(session, ctx)
    company, company_line = await find_company(session, answer.company, screen.company, ctx)
    found = company.found
    opens = AssistantOpen(page="company", company_key=found.key if found is not None else None)
    name = found.name if found is not None else company.heard
    read_back = f"Open {name}." if name else "Open a company."
    return command(
        "open",
        read_back,
        company=company,
        opens=opens,
        unsure=lines(company_line or (None if found or company.heard else NO_COMPANY), claude),
    )
