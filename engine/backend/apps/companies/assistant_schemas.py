"""What the Assistant's command step takes and gives (PLAN-V22 T1-1 and T1-2, the contract's part
1). The website's types come from these.

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
    CompanyHit,
    MeetingFormState,
    NoteTaskKind,
    Out,
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
