"""What the Assistant takes and gives (PLAN-V22): the command step (T1-1 and T1-2, the contract's
part 1), Today (T1-3, part 2), a task on its own (T1-4, part 3) and the team email (T1-5, part
4). The website's types come from these.

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
    CompanyHit,
    MeetingFormState,
    NoteTaskKind,
    Out,
    OwnerId,
    PrepPerson,
    TeamMember,
)
from core.api.models import SafeText

AssistantAction = Literal[
    "pre_read", "log_call", "task", "email", "open", "change", "send", "cancel", "unknown"
]
# The pages a command can open. `company` is one company's page, with `company_key`.
AssistantPageName = Literal[
    "home", "today", "meetings", "call_logs", "companies", "company", "lead_finder"
]
CommandSource = Literal["mic", "typed"]
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


# --- Out ---------------------------------------------------------------------------------------


class AssistantCompany(Out):
    heard: str = Field(description="The company as heard. Empty when the command named none")
    from_page: bool = Field(
        description="True when it is the company on screen: none was named, or the one named "
        "is close to it, or it is one of several that match"
    )
    found: CompanyHit | None = Field(description="The one company that matches")
    choices: list[CompanyHit] = Field(description="Two or more that match, best first")


class AssistantPerson(Out):
    heard: str = Field(description="The client person as heard, like James. Empty if none")
    found: PrepPerson | None = Field(description="The one person at the company who matches")
    choices: list[PrepPerson] = Field(
        description="Two or more at the company who match, best first, each with a job title"
    )


class AssistantMeetingHit(Out):
    id: str | None = Field(description="HubSpot's meeting id. None for a meeting typed in")
    title: str
    starts_at: datetime
    company_key: str
    company_name: str
    form: MeetingFormState | None = Field(description="Its pre-read, if it has one")


class AssistantMeeting(Out):
    heard: str = Field(
        description="The words that named the meeting, like Thursday's meeting. Empty if none"
    )
    from_page: bool = Field(description="True when it is the meeting or pre-read on screen")
    found: AssistantMeetingHit | None = Field(description="The one meeting that matches")
    choices: list[AssistantMeetingHit] = Field(
        description="Two or more that match, soonest first, or the company's next ones when "
        "none is on the day said"
    )


class AssistantRecipient(Out):
    """A teammate or a Contour address, as a command named them."""

    heard: str = Field(description="The name or address as heard")
    found: TeamMember | None = Field(description="The one teammate on the team list who matches")
    address: str | None = Field(description="A Contour address, typed in full")
    choices: list[TeamMember] = Field(description="Two or more teammates who match, best first")
    problem: str | None = Field(
        description="Why this one can't be sent to yet, in plain words: not on the team list, "
        "no Contour account, or not a Contour address. None when it can"
    )


class AssistantTask(Out):
    subject: str = Field(description="What to do, up to 200 characters. Empty when none was said")
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

    action: AssistantAction
    read_back: str = Field(
        description="The card's first line, like 'Log a call with James Sample at Sample "
        "Logistics. Follow-up task on Fri 21 Nov.'"
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


# --- Today (T1-3, the contract's part 2) ---------------------------------------------------------

# The parts Today shows this person, the most urgent first (choice 6). Tasks and deals: anyone with
# the Assistant. Meetings: the Meetings tick, while pre-meeting forms are on. Calls: the Call logs
# tick, while call notes are on.
TodayPart = Literal["tasks", "meetings", "calls", "deals"]
# ok: read (or kept from a read under 5 minutes old). no_owner: no HubSpot link (or nobody is
# signed in). no_access: the HubSpot key can't read tasks. off: HubSpot isn't connected. failed:
# HubSpot didn't answer, and no earlier read is kept.
TasksState = Literal["ok", "no_owner", "no_access", "off", "failed"]
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

    names: list[AssistantName] = Field(
        description="At most the Settings page's number (50 to start), most likely first, each "
        "name once"
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
