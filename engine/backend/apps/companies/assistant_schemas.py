"""What the Assistant takes and gives (PLAN-V22): the command step (T1-1 and T1-2, the contract's
part 1), Today (T1-3, part 2), a task on its own (T1-4, part 3) and the team email (T1-5, part
4). PLAN-V23 adds the mic's hint list, learned names, a better company search and adding a
company (its contract's parts 1 to 4). The website's types come from these.

A command is one thing a rep says or types. The server turns it into one action and finds the
company, the person, the meeting and the teammates in our HubSpot copy. Each thing it looks for
comes back the same way: the words as `heard`, then `found` (exactly one match) or `choices` (two
or more, best first), or neither (no match: the card asks the rep to pick).
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from apps.companies.schemas import (
    MAX_RECIPIENTS,
    Address,
    CallType,
    CompanyHit,
    MeetingFormState,
    NoteTaskKind,
    Out,
    OutcomeName,
    OwnerId,
    PrepPerson,
    TeamMember,
)
from core.api.models import SafeText, no_default_in_types, optional_in_types

# unclear (PLAN-V23 choice 4): the words are too unclear to make a command. The bar stops before
# the card, with the words in `read_back`.
AssistantAction = Literal[
    "pre_read",
    "log_call",
    "task",
    "email",
    "open",
    "change",
    "send",
    "cancel",
    "unknown",
    "unclear",
]
# The pages a command can open. `company` is one company's page, with `company_key`.
AssistantPageName = Literal[
    "home", "today", "meetings", "call_logs", "companies", "company", "lead_finder"
]
CommandSource = Literal["mic", "typed"]
# How sure code is of what it found (PLAN-V25 choice 1). sure: the card uses it at once, with
# Change and Undo. likely: the card suggests the first choice, with its reason; Enter, "yes" or a
# tap takes it. unsure: up to 3 choices, plus Search.
Level = Literal["sure", "likely", "unsure"]
CardAction = Literal["pre_read", "log_call", "task", "email"]

COMMAND_MAX_CHARS = 2_000  # the longest command (choice 18): longer is 422 command_too_long
# What a request may carry at all. More is refused at the edge, before any check reads it.
COMMAND_EDGE_CHARS = 20_000
BOX_PATTERN = r"^[A-Za-z][A-Za-z0-9 _-]{0,39}$"  # a card's box name: plain words only
MAX_BOXES = 20

BoxName = Annotated[str, StringConstraints(pattern=BOX_PATTERN)]


# --- In ----------------------------------------------------------------------------------------


class AssistantOnPage(BaseModel):
    """What is on screen when the rep speaks. A command that names no company uses this one."""

    model_config = ConfigDict(extra="forbid")

    company_key: SafeText | None = Field(
        None,
        max_length=64,
        description="The company on screen: a HubSpot id, or lead:<id>",
        examples=["201"],
    )
    meeting_id: str | None = Field(
        None, max_length=32, pattern=r"^[0-9]+$", description="The HubSpot meeting on screen"
    )
    form_id: uuid.UUID | None = Field(None, description="The pre-read on screen")
    note_id: uuid.UUID | None = Field(None, description="The call note on screen")


class AssistantCardIn(BaseModel):
    """The review card that is open, while the rep speaks a change to it."""

    model_config = ConfigDict(extra="forbid")

    action: CardAction = Field(description="What the card is for")
    boxes: list[BoxName] = Field(
        min_length=1,
        max_length=MAX_BOXES,
        description="The names of its boxes, like subject or due: letters, digits, spaces, _ "
        "and -, up to 40 characters each. Claude gets them, and a change names one of them",
        examples=[["subject", "due", "owner"]],
    )


LAST_HEARD_MAX_CHARS = 120


class AssistantLastTurn(BaseModel):
    """The conversation's last turn (PLAN-V25 T5-1, choice 21), as the bar keeps it until the
    conversation ends: its company and person, found and as heard. Code uses the found ones for
    "same company", "her" or "and Jo too". Claude gets only the names as heard."""

    model_config = ConfigDict(extra="forbid")

    action: CardAction | None = Field(None, description="What the last card was for")
    company_key: SafeText | None = Field(
        None,
        max_length=64,
        description="The last turn's company: a HubSpot id, or lead:<id>. Used only when this "
        "person may still open it",
        examples=["201"],
    )
    company_heard: SafeText = Field(
        "",
        max_length=LAST_HEARD_MAX_CHARS,
        description="The company's name as heard last turn. Claude gets it, scrubbed",
        examples=["Sample Logistics"],
    )
    person_id: str | None = Field(
        None,
        max_length=32,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="The last turn's client person: HubSpot's contact id",
    )
    person_heard: SafeText = Field(
        "",
        max_length=LAST_HEARD_MAX_CHARS,
        description="The person's name as heard last turn. Claude gets it, scrubbed",
        examples=["Jo Sample"],
    )


class AssistantCommandIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: SafeText = Field(
        max_length=COMMAND_EDGE_CHARS,
        description="What was said or typed, 1 to 2,000 characters once trimmed. 422 "
        "`command_empty` or `command_too_long` otherwise",
        examples=["Log a call with James from Sample Logistics, follow up Friday"],
    )
    source: CommandSource = Field(description="mic (said out loud) or typed")
    on_page: AssistantOnPage | None = Field(None, description="What is on screen, if anything")
    card: AssistantCardIn | None = Field(
        None,
        description="The open review card, if any. Then the only actions are change, send and "
        "cancel, and anything else comes back as unknown",
    )
    last_turn: AssistantLastTurn | None = Field(
        None,
        description="The conversation's last turn, if any (PLAN-V25 T5-1): 'same company', "
        "'her' and 'and Jo too' use it. Left out when the conversation is new",
    )


# --- Out ---------------------------------------------------------------------------------------


LEVEL_WORDS = (
    "How sure code is (PLAN-V25): sure (used at once, with Change and Undo), likely (the first "
    "choice is suggested, with its reason) or unsure (choose). None when nothing was found"
)
REASON_WORDS = (
    "Why, in a few plain words, like 'You meet them at 2 pm.': for sure, the one found; for "
    "likely, the first choice. None when there is nothing to say"
)


class AssistantChoice(CompanyHit):
    """One of several companies that match (PLAN-V25 T1-1)."""

    model_config = ConfigDict(json_schema_extra=optional_in_types("reason", "detail"))

    reason: str | None = Field(
        None,
        description="Its strongest signal in plain words, like 'Yours.' or 'Open deal.' None: none",
        json_schema_extra=no_default_in_types,
    )
    detail: str | None = Field(
        None,
        description="The one detail that tells it apart from the other choices: its city, its "
        "owner ('Owner: Sam Sample') or its last call ('Last call 12 Nov')",
        json_schema_extra=no_default_in_types,
    )


class AssistantPersonHit(PrepPerson):
    """A client person as a choice (PLAN-V25 T2-1). Found without the company, they bring it."""

    model_config = ConfigDict(
        json_schema_extra=optional_in_types("company_key", "company_name", "reason")
    )

    company_key: str | None = Field(
        None,
        description="Their company (a HubSpot id) when they were found without it. None when "
        "the company was already found",
        json_schema_extra=no_default_in_types,
    )
    company_name: str | None = Field(
        None, description="That company's name", json_schema_extra=no_default_in_types
    )
    reason: str | None = Field(
        None,
        description="Why they come first, like 'You called them on Tuesday.' None: nothing to say",
        json_schema_extra=no_default_in_types,
    )


class AssistantCompany(Out):
    # Added in PLAN-V23 and PLAN-V25: the API always sends them, and the website's types leave
    # them optional.
    model_config = ConfigDict(
        json_schema_extra=optional_in_types("from_hubspot", "can_add", "level", "reason")
    )

    heard: str = Field(description="The company as heard. Empty when the command named none")
    from_page: bool = Field(
        description="True when it is the company on screen: none was named, or the one named "
        "is close to it, or it is one of several that match"
    )
    found: CompanyHit | None = Field(
        description="The company to use: the one that matches, or the sure one of several"
    )
    choices: list[AssistantChoice] = Field(
        description="Two or more that match, best first, at most 3. For likely, the first is the "
        "suggestion"
    )
    from_hubspot: bool = Field(
        False,
        description="True when our copy didn't have it and HubSpot's own search found it (or "
        "the choices): it is in our copy now (PLAN-V23 T1-3)",
        json_schema_extra=no_default_in_types,
    )
    can_add: bool = Field(
        False,
        description="True when neither our copy nor HubSpot's search has the company: the card "
        "may offer to add it to HubSpot, with the name as heard (PLAN-V23 T1-4). False when "
        "HubSpot couldn't be searched",
        json_schema_extra=no_default_in_types,
    )
    level: Level | None = Field(
        None, description=LEVEL_WORDS, json_schema_extra=no_default_in_types
    )
    reason: str | None = Field(
        None, description=REASON_WORDS, json_schema_extra=no_default_in_types
    )


class AssistantPerson(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("level", "reason"))

    heard: str = Field(description="The client person as heard, like James. Empty if none")
    found: PrepPerson | None = Field(description="The one person at the company who matches")
    choices: list[AssistantPersonHit] = Field(
        description="Two or more at the company who match, best first, each with a job title, "
        "at most 3. Found without the company (PLAN-V25 T2-1), one or more, each with their "
        "company: taking one fills the company too"
    )
    level: Level | None = Field(
        None, description=LEVEL_WORDS, json_schema_extra=no_default_in_types
    )
    reason: str | None = Field(
        None, description=REASON_WORDS, json_schema_extra=no_default_in_types
    )


class AssistantMeetingHit(Out):
    id: str | None = Field(description="HubSpot's meeting id. None for a meeting typed in")
    title: str
    starts_at: datetime
    company_key: str
    company_name: str
    form: MeetingFormState | None = Field(description="Its pre-read, if it has one")


class AssistantMeeting(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("level", "reason"))

    heard: str = Field(
        description="The words that named the meeting, like Thursday's meeting. Empty if none"
    )
    from_page: bool = Field(description="True when it is the meeting or pre-read on screen")
    found: AssistantMeetingHit | None = Field(description="The one meeting that matches")
    choices: list[AssistantMeetingHit] = Field(
        description="Two or more that match, soonest first, or the company's next ones when "
        "none is on the day said"
    )
    level: Level | None = Field(
        None, description=LEVEL_WORDS, json_schema_extra=no_default_in_types
    )
    reason: str | None = Field(
        None, description=REASON_WORDS, json_schema_extra=no_default_in_types
    )


class AssistantRecipient(Out):
    """A teammate or a Contour address, as a command named them."""

    model_config = ConfigDict(json_schema_extra=optional_in_types("level"))

    heard: str = Field(description="The name or address as heard")
    found: TeamMember | None = Field(description="The one teammate on the team list who matches")
    address: str | None = Field(description="A Contour address, typed in full")
    choices: list[TeamMember] = Field(description="Two or more teammates who match, best first")
    problem: str | None = Field(
        description="Why this one can't be sent to yet, in plain words: not on the team list, "
        "no Contour account, or not a Contour address. None when it can"
    )
    level: Level | None = Field(
        None, description=LEVEL_WORDS, json_schema_extra=no_default_in_types
    )


class AssistantTask(Out):
    model_config = ConfigDict(
        json_schema_extra=optional_in_types("due_level", "due_choices", "subject_suggested")
    )

    subject: str = Field(
        description="What to do, up to 200 characters. When none was said, a suggestion "
        "(`subject_suggested`), like 'Follow up with Sample Logistics Pty Ltd'"
    )
    due: date = Field(description="A Melbourne working day, today or later")
    due_words: str = Field(description="When, in the rep's own words. Empty when none was said")
    kind: NoteTaskKind
    owner_id: str | None = Field(
        description="The teammate's HubSpot owner id. None: the rep, or a teammate still to pick "
        "(see `owner`)"
    )
    owner: AssistantRecipient | None = Field(
        description="Who it is for, when the command named a teammate. None: the rep"
    )
    due_level: Level = Field(
        "sure",
        description="sure when the day was said and read. likely when it wasn't said or couldn't "
        "be read: `due` is then a suggestion, the next working day (PLAN-V25 choice 13, TBC)",
        json_schema_extra=no_default_in_types,
    )
    due_choices: list[date] = Field(
        default_factory=list,
        description="For likely: the suggested day first, then 'In a week' (a working day). "
        "'Pick a day' is the card's own. Empty for sure",
    )
    subject_suggested: bool = Field(
        False,
        description="True when no subject was said and `subject` is a suggestion: the card asks "
        "'Use it' or 'Type it'",
        json_schema_extra=no_default_in_types,
    )


class AssistantEmail(Out):
    to: list[AssistantRecipient] = Field(description="At most 20, in the order said")
    subject: str = Field(description="Up to 120 characters. Empty when none could be made")
    body: str = Field(description="The rep's words, tidied by Claude, up to 4,000 characters")


class AssistantOpen(Out):
    page: AssistantPageName
    company_key: str | None = Field(description="For the company page: the company, once found")


class AssistantChange(Out):
    box: str = Field(description="One of the card's boxes, spelled as the card sent it")
    value: str = Field(description="The new value, as said")
    day: date | None = Field(description="The value as a day, when it reads as one")


class AssistantCommand(Out):
    """What a command would do. Nothing is written or sent: the review card does that."""

    # Added in PLAN-V25: the API always sends them, and the website's types leave them optional.
    model_config = ConfigDict(
        json_schema_extra=optional_in_types("call_type", "outcome", "quick", "follow_up_day")
    )

    action: AssistantAction
    read_back: str = Field(
        description="The card's first line, like 'Log a call with James Sample at Sample "
        "Logistics. Follow-up task on Fri 21 Nov.' For `unclear`, the words as heard, for the "
        "bar's text line"
    )
    company: AssistantCompany | None = Field(
        description="For a pre-read, a call, a task, a company page, or an email that names one"
    )
    person: AssistantPerson | None = Field(description="For a call")
    meeting: AssistantMeeting | None = Field(description="For a pre-read")
    note_text: str | None = Field(
        description="For a call: the note, word for word as said, without the command words at "
        "its start"
    )
    task: AssistantTask | None
    email: AssistantEmail | None
    open: AssistantOpen | None
    change: AssistantChange | None
    unsure: str | None = Field(
        description="A short line when something wasn't clear or wasn't found, or none"
    )
    call_type: CallType | None = Field(
        None,
        description="For a call: HubSpot's call type, Prospecting Call unless the command words "
        "said another, like 'log a follow-up call' (PLAN-V25 T3-1). None for other actions",
        json_schema_extra=no_default_in_types,
    )
    outcome: OutcomeName | None = Field(
        None,
        description="For a call that is only an outcome, like 'No answer, Jo Sample': that "
        "outcome. None when the words say more, or no outcome (the sort reads it from the note)",
        json_schema_extra=no_default_in_types,
    )
    quick: bool = Field(
        False,
        description="True for a quick log (PLAN-V25 T3-3): only No answer, Left voicemail, Busy "
        "or Wrong number, with a sure company and a sure person, and nothing unclear. The card "
        "may skip itself: the hold's toast says what goes, and Undo opens the card",
        json_schema_extra=no_default_in_types,
    )
    follow_up_day: date | None = Field(
        None,
        description="For a call: the day a follow-up nudge suggests ('No follow-up yet. Add one "
        "for Monday?'), the next working day (PLAN-V25 choice 14, TBC). The card shows the nudge "
        "only for a Connected call with no follow-up",
        json_schema_extra=no_default_in_types,
    )


# --- Today (T1-3, the contract's part 2) ---------------------------------------------------------

# The parts Today shows this person, the most urgent first (choice 6). Tasks and deals: anyone with
# the Assistant. Meetings, and the pre-reads sent to me (PLAN-V23 T2-3): the Meetings tick, while
# pre-meeting forms are on. Calls: the Call logs tick, while call notes are on.
TodayPart = Literal["tasks", "meetings", "pre_reads", "calls", "deals"]
# ok: read (or kept from a read under 5 minutes old). no_owner: no HubSpot link (or nobody is
# signed in). no_access: the HubSpot key can't read tasks. off: HubSpot isn't connected. failed:
# HubSpot didn't answer, and no earlier read is kept. none (PLAN-V23 T3-3): my account has no
# HubSpot user, so I have no HubSpot tasks, and HubSpot isn't asked.
TasksState = Literal["ok", "no_owner", "no_access", "off", "failed", "none"]
TaskGroup = Literal["overdue", "today", "soon"]
TaskPriorityName = Literal["low", "medium", "high"]
MeetingDay = Literal["today", "tomorrow"]
DealReason = Literal["close_date_passed", "quiet"]


class TodayCompany(Out):
    key: str = Field(description="The company's key: its HubSpot id", examples=["201"])
    name: str


class TodayTask(Out):
    id: str = Field(description="HubSpot's task id")
    subject: str = Field(
        description="One line, with email addresses and phone numbers left out", max_length=300
    )
    kind: NoteTaskKind
    priority: TaskPriorityName | None
    due: date = Field(description="The day it is due, Melbourne time")
    due_at: datetime = Field(description="HubSpot's due time")
    overdue: bool = Field(description="Due before today, Melbourne time")
    group: TaskGroup = Field(description="overdue, today, or soon (the next 7 days)")
    company: TodayCompany | None = Field(
        description="Its company, when it is linked to one in our HubSpot copy"
    )
    hubspot_url: str | None = Field(description="The task in HubSpot, when HubSpot gave it")


class TodayMeeting(Out):
    id: str | None = Field(
        description="HubSpot's meeting id. None for a meeting typed in for a pre-read"
    )
    title: str
    starts_at: datetime
    ends_at: datetime | None
    day: MeetingDay = Field(description="today or tomorrow, Melbourne time")
    company: TodayCompany
    form: MeetingFormState | None = Field(description="Its pre-read, if it has one")
    hubspot_url: str | None


class TodayPreRead(Out):
    """A pre-read sent to me (PLAN-V23 T2-3, choice 9), with or without a HubSpot user."""

    form_id: uuid.UUID = Field(
        description="The pre-read's id: its page is /assistant/meetings/<form_id>"
    )
    title: str = Field(description="The meeting's title")
    starts_at: datetime = Field(description="When the meeting starts")
    company: TodayCompany = Field(
        description="The meeting's company. Its key is lead:<id> for a Lead Finder company"
    )
    sent_by: str | None = Field(
        description="Who sent it, by name. None when that account is gone, or nobody signed in"
    )


class TodayCalls(Out):
    to_confirm: int = Field(description="My call notes waiting for me to confirm them")
    needs_look: int = Field(description="My call notes that failed, were partly saved, or unsure")


class TodayDeal(Out):
    id: str = Field(description="HubSpot's deal id")
    name: str
    company: TodayCompany
    stage: str | None = Field(description="HubSpot's stage, like Qualified Deal")
    close_date: date | None
    last_contact: date | None = Field(
        description="The last time anyone talked to the company: the newest of its last activity "
        "and last contacted, and the deal's last contacted. None when there is none"
    )
    why: str = Field(
        description="Why it needs a nudge, like 'Close date passed, 12 Nov' or 'No contact for "
        "21 days'"
    )
    reasons: list[DealReason] = Field(description="close_date_passed, quiet, or both")
    hubspot_url: str | None


class Today(Out):
    """The Assistant's first page: my day, the most urgent first. Free: no Claude request."""

    # Added in PLAN-V23 T2-3: the API always sends it, and the website's types leave it optional.
    model_config = ConfigDict(json_schema_extra=optional_in_types("pre_reads"))

    parts: list[TodayPart] = Field(
        description="The parts this person sees, in order. A part left out also comes back empty"
    )
    tasks: list[TodayTask] = Field(
        description="My open HubSpot tasks: overdue first, then today's, then the next 7 days', "
        "each group soonest due first"
    )
    tasks_state: TasksState
    tasks_sentence: str | None = Field(
        description="Plain words when the tasks can't show, or show from an earlier read"
    )
    tasks_more: int = Field(
        description="Older overdue tasks HubSpot has beyond the ones listed (100 at most are read)"
    )
    meetings: list[TodayMeeting] = Field(
        description="My meetings today and tomorrow, soonest first"
    )
    pre_reads: list[TodayPreRead] = Field(
        description="The pre-reads sent to me, for meetings from today on (Melbourne), soonest "
        "first, at most 20: found by my HubSpot user, and by my own address"
    )
    calls: TodayCalls
    deals: list[TodayDeal] = Field(
        description="My open deals that need a nudge: close date passed first, then the longest "
        "without contact"
    )
    deals_more: int = Field(description="More such deals beyond the ones listed (50 at most)")
    quiet_days: int = Field(description="The days without contact that make a deal quiet")
    checked_at: datetime = Field(
        description="When the tasks shown were read from HubSpot. When none could be read: when "
        "this answer was made"
    )


# --- A task on its own (T1-4, the contract's part 3) ---------------------------------------------

TASK_SUBJECT_MAX_CHARS = 200
TASK_BODY_MAX_CHARS = 2_000


class AssistantTaskIn(BaseModel):
    """One HubSpot task, as the review card sends it."""

    model_config = ConfigDict(extra="forbid")

    company_key: SafeText = Field(
        max_length=64,
        description="The company: its HubSpot id. A Lead Finder company that isn't in HubSpot "
        "yet (lead:<id>) can't have a task",
        examples=["201"],
    )
    subject: SafeText = Field(
        max_length=TASK_SUBJECT_MAX_CHARS,
        description="What to do, 1 to 200 characters once trimmed (422 `task_empty`). An email "
        "address or a phone number in it is sent as [email left out] or [number left out]",
        examples=["Send Sample Logistics the floor plan"],
    )
    body: SafeText = Field(
        "", max_length=TASK_BODY_MAX_CHARS, description="More words, if any, up to 2,000"
    )
    due: date = Field(description="The day it is due: today or later, Melbourne time")
    kind: NoteTaskKind = Field("todo", description="call, email or todo")
    owner_id: str | None = Field(
        None,
        max_length=32,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="A teammate's HubSpot owner id, from GET /team. None: me",
    )


# --- The team email (T1-5, the contract's part 4) -------------------------------------------------

EMAIL_SUBJECT_MAX_CHARS = 120
EMAIL_BODY_MAX_CHARS = 4_000


class AssistantEmailIn(BaseModel):
    """An email to teammates, as the review card sends it."""

    model_config = ConfigDict(extra="forbid")

    owner_ids: list[OwnerId] = Field(
        default_factory=list,
        max_length=MAX_RECIPIENTS,
        description="Teammates from GET /team, by HubSpot owner id. Each needs a Contour account "
        "(422 `no_account` otherwise, with why)",
    )
    emails: list[Address] = Field(
        default_factory=list,
        max_length=MAX_RECIPIENTS,
        description="Contour addresses typed in full. One outside address refuses the whole send "
        "(422 `outside_address`, naming it)",
    )
    subject: SafeText = Field(
        max_length=EMAIL_SUBJECT_MAX_CHARS,
        description="1 to 120 characters once trimmed (422 `subject_empty`)",
        examples=["The Sample Logistics floor plan"],
    )
    body: SafeText = Field(
        max_length=EMAIL_BODY_MAX_CHARS,
        description="1 to 4,000 characters once trimmed (422 `body_empty`). An email address or a "
        "phone number in it is sent as [email left out] or [number left out]",
    )
    company_key: SafeText | None = Field(
        None,
        max_length=64,
        description="A company in HubSpot (its id): the email links to it in Contour",
        examples=["201"],
    )


class TeamEmailPerson(Out):
    owner_id: str | None = Field(description="The teammate's HubSpot owner id. None: typed in")
    name: str | None = Field(description="Their name, when known")
    address: str = Field(description="The Contour address it goes to")


class TeamEmail(Out):
    """The team email as it goes (a preview), or as it went (a send)."""

    subject: str
    text: str = Field(description="The plain text, ending 'Sent by {name} from Contour HQ'")
    html: str = Field(description="The HTML version, with every value escaped")
    people: list[TeamEmailPerson] = Field(description="1 to 20 people, each once")
    reply_to_me: bool = Field(
        description="A reply goes to my own Contour address. False: to the sender's address"
    )
    company: TodayCompany | None = Field(description="The company it links to, if any")
    can_send: bool = Field(description="Email is set up, so it can be sent now")
    waiting_for: str | None = Field(description="Why it can't be sent now, in plain words")
    sends_left: int = Field(description="Team emails I may still send today (30 a day, TBC)")
    sent_at: datetime | None = Field(description="When it was sent. None for a preview")


# --- The hint list (PLAN-V23 T1-1, the contract's part 1) ---------------------------------------

# company: a company (or another name for it, like a deal's client); person: a client person;
# teammate: someone at Contour, by their HubSpot name; word: a fixed word, like fitout.
NameKind = Literal["company", "person", "teammate", "word"]


class AssistantName(Out):
    text: str = Field(
        description="The name as said: a company without Pty Ltd and the like, a person's full "
        "name, or a fixed word",
        examples=["Sample Logistics"],
    )
    kind: NameKind
    company_key: str | None = Field(
        description="The company it belongs to, for a company or a client person. None for a "
        "teammate or a word"
    )


class AssistantNames(Out):
    """The names this person is most likely to say, for the mic: the speech service's hints, and
    the list a misheard name is fixed against on every page. Free: no HubSpot request."""

    # Added in PLAN-V25: the API always sends it, and the website's types leave it optional.
    model_config = ConfigDict(json_schema_extra=optional_in_types("places"))

    names: list[AssistantName] = Field(
        description="At most the Settings page's number (50 to start), most likely first, each "
        "name once"
    )
    places: list[str] = Field(
        default_factory=list,
        description="The word list's places (PLAN-V25 T4-1): the cities and suburbs of the "
        "companies and offices in our copy, the most common first, at most 200, each once. For "
        "the name fix, and Chrome's hints when they are on. The office words are the website's own",
    )


# --- Learned names (PLAN-V23 T1-2, the contract's part 2) ---------------------------------------

HEARD_MAX_CHARS = 80


class LearnedNameIn(BaseModel):
    """A name the rep fixed on the card: the words as heard, and the company they picked."""

    model_config = ConfigDict(extra="forbid")

    heard: SafeText = Field(
        min_length=1,
        max_length=HEARD_MAX_CHARS,
        description="The words as heard, like North Wind: 1 to 80 characters. An email address "
        "or a phone number in them is refused (422 `contact_details`)",
        examples=["North Wind"],
    )
    company_key: SafeText = Field(
        min_length=1,
        max_length=64,
        description="The company the rep picked: a HubSpot id, or lead:<id>",
        examples=["201"],
    )


class LearnedNameOut(Out):
    id: uuid.UUID
    heard: str = Field(description="The words as heard, tidied")
    company_key: str
    company_name: str = Field(
        description="The company's name in our copy now, else its name when it was taught"
    )
    taught_by: str | None = Field(description="Who taught it. None: sign-in was off, or gone")
    created_at: datetime


class LearnedNamePage(Out):
    total: int
    items: list[LearnedNameOut] = Field(description="The newest first")


# --- Adding a company (PLAN-V23 T1-4, the contract's part 4) ------------------------------------

NEW_COMPANY_MAX_CHARS = 120
CITY_MAX_CHARS = 120


class AssistantCompanyIn(BaseModel):
    """A company to add to HubSpot, as the card has it."""

    model_config = ConfigDict(extra="forbid")

    name: SafeText = Field(
        min_length=1,
        max_length=NEW_COMPANY_MAX_CHARS,
        description="The company's name, 1 to 120 characters once its spaces are tidied (422 "
        "`company_name_empty` otherwise). No email address or phone number (422 "
        "`contact_details`)",
        examples=["Sample Logistics Pty Ltd"],
    )
    city: SafeText | None = Field(
        None,
        max_length=CITY_MAX_CHARS,
        description="Its city, when one was said, like Perth. Empty: none",
        examples=["Perth"],
    )


class AssistantCompanyPreview(Out):
    """What adding the company would do. Nothing is written to HubSpot."""

    name: str = Field(description="The name as it would be added, its spaces tidied")
    city: str | None
    similar: list[CompanyHit] = Field(
        description="HubSpot's companies with a close name, best first, at most 5, each read "
        "into our copy so the card can use it"
    )
    exists: CompanyHit | None = Field(
        description="A company HubSpot (or our copy) already has with this name: adding it again "
        "is refused (409 `company_exists`). Use this one"
    )
    can_write: bool = Field(description="Companies can be added to HubSpot now")
    waiting_for: str | None = Field(description="Why they can't, in plain words")
    sentence: str | None = Field(
        description="The card's line, in plain words: adding is off, the name is there already, "
        "or HubSpot has a company like it. None when there is nothing to say"
    )


class AssistantCompanyAdded(Out):
    company_key: str = Field(description="The company's HubSpot id: use it on the card")
    company: CompanyHit = Field(description="The company as our copy has it now")
    hubspot_url: str | None = Field(description="The company in HubSpot, when HubSpot gave it")


# --- The card's own company find (PLAN-V24 T3-2, choice 19) -------------------------------------

FIND_WORDS_MAX_CHARS = 120


class AssistantCompanyFind(Out):
    """A company said or typed again on the review card, found as a command finds it. Free: no
    Claude request."""

    company: AssistantCompany = Field(
        description="As a command's `company`: the words as heard, then `found` (one match) or "
        "`choices` (two or more, best first), with `from_hubspot`, and `can_add` when it is found "
        "nowhere. `from_page` is always false: the card sends no company on screen"
    )
    line: str | None = Field(
        description="The company's line, as a command gives it in `unsure`: like 'Northwind Pty "
        "Ltd is new in HubSpot. We'll use it.', 'Which North Wind?' or 'North Wind isn't in "
        "HubSpot. Add it, or pick another company.' None when one company was found in our copy "
        "or by a learned name"
    )
