"""What the Companies routes take and give (PLAN-V10). The website's types come from these."""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from pydantic.config import JsonDict

from apps.companies.deals import DealState, StageKind
from core.api.models import SafeText
from core.hubspot.meetings import Meeting, MeetingsState, MeetingWhere

Source = Literal["hubspot", "lead"]
# For a field named `date` with a default: in the class body the name `date` is the field by the
# time the annotation is read, so the type needs a name of its own.
DayOrNone = date | None
SortKey = Literal["name", "staff", "lease", "last_talk"]
SortOrder = Literal["asc", "desc"]
PeopleStatus = Literal["ready", "waiting"]
ToneKey = Literal["friendly", "direct", "consultative", "formal"]  # the tone presets (PLAN-V15)


class Out(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


def optional_in_types(*names: str) -> Callable[[JsonDict], None]:
    """Leaves these fields out of `required` in the website's types, so test data written before
    they existed still type-checks. The API always sends them (PLAN-V14)."""

    def drop(schema: JsonDict) -> None:
        required = schema.get("required")
        if isinstance(required, list):
            schema["required"] = [name for name in required if name not in names]

    return drop


# --- The list ----------------------------------------------------------------------------------


class CompanyRow(Out):
    key: str = Field(description="The HubSpot id, or lead:<id> for a lead not in HubSpot yet")
    name: str
    domain: str | None
    city: str | None
    industry: str | None
    staff: int | None = Field(description="Staff, as HubSpot has it (the whole company)")
    owner: str | None = Field(description="The HubSpot owner's name")
    last_talk: date | None = Field(description="When someone last talked to them, per HubSpot")
    next_lease_end: date | None = Field(description="The nearest lease end still to come")
    deal: DealState
    source: Source = Field(description="hubspot, or lead: found by the Lead Finder, not in HubSpot")
    lead_result: str | None = Field(
        None, description="The Lead Finder's newest result. Only with the Lead Finder tick."
    )
    lead_score: int | None = Field(None, description="Only with the Lead Finder tick")


class CompanyPage(Out):
    total: int
    items: list[CompanyRow]
    leads_shown: bool = Field(
        description="True when this person sees the Lead Finder's rows and fields (its tick)"
    )


class CompanyFacetValue(Out):
    value: str
    count: int


class CompanyFacets(Out):
    cities: list[CompanyFacetValue]
    owners: list[CompanyFacetValue] = Field(description="Owners with the most companies first")
    leads_shown: bool


# --- One company -------------------------------------------------------------------------------


class CompanyOffice(Out):
    label: str
    city: str | None
    street: str | None
    level: str | None
    lease_end: date | None
    moved_in: date | None
    office_m2: Decimal | None
    linkedin_staff: int | None
    quality: str | None


class CompanyDeal(Out):
    name: str
    stage: str | None
    state: StageKind
    pipeline: str | None
    amount_aud: Decimal | None
    close_date: date | None
    owner: str | None
    next_step: str | None
    hubspot_url: str | None


class CompanyNote(Out):
    text: str = Field(description="What a page said, in a summary (not a quote)")
    url: str | None
    date: date | None
    found_by: str = Field(description="The project that saved it, like lead_finder")


class CompanyPerson(Out):
    id: str = Field(description="HubSpot's contact id")
    name: str
    title: str | None
    phone: str | None
    last_activity: datetime | None


class CompanyCall(Out):
    id: str
    called_at: datetime | None
    person: str | None
    owner: str | None
    minutes: int | None
    outcome: str | None
    note: str | None
    hubspot_url: str | None


class CompanyLead(Out):
    title: str = Field(description="The project's name, like Lead Finder")
    lead_id: uuid.UUID
    result: str
    result_label: str
    score: int
    score_checked: int | None
    summary: str
    best_sign: str | None
    sign_date: date | None
    status: str
    found_at: datetime
    link: str


RelationshipStage = Literal[
    "open_deal", "customer", "past_customer", "lost_deal", "contacted", "cold"
]


class Relationship(Out):
    """Where we stand with the company (PLAN-V15 T3-3). Both call scripts open from it."""

    stage: RelationshipStage
    since: DayOrNone = Field(
        description=(
            "The date the stage rests on: the last talk, or the won or lost deal's close date. "
            "None when there is none, as for an open deal or a cold call"
        )
    )
    reason: str = Field(
        description="One plain sentence, like 'Open deal: Perth fitout, at Proposal.'"
    )
    source: str = Field(
        description="Where it shows, like 'HubSpot deal' or 'HubSpot call, 3 Mar 2026'"
    )


class CompanyDetail(Out):
    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        json_schema_extra=optional_in_types("relationship", "meetings"),
    )

    key: str
    source: Source
    name: str
    domain: str | None
    website: str | None
    city: str | None
    state: str | None
    industry: str | None
    staff: int | None
    linkedin_staff: int | None
    description: str | None
    owner: str | None
    lifecycle_stage: str | None
    last_talk: date | None
    last_talk_note: str | None = Field(description="The newest call note, once calls are copied")
    next_lease_end: date | None
    deal: DealState
    hubspot_url: str | None
    offices: list[CompanyOffice]
    deals: list[CompanyDeal]
    notes: list[CompanyNote] = Field(description="Saved notes under 30 days old, newest first")
    people: list[CompanyPerson]
    calls: list[CompanyCall] = Field(description="The newest calls first, at most 20")
    people_status: PeopleStatus = Field(
        description="waiting: HubSpot can't give contacts and calls yet (its scopes)"
    )
    lead: CompanyLead | None = Field(description="Only with the Lead Finder tick")
    relationship: Relationship = Field(
        description="Where we stand: open deal, customer, past customer, lost deal, contacted "
        "before, or cold (PLAN-V15). The API always sends it"
    )
    meetings: list["MeetingItem"] = Field(
        default_factory=list,
        description="Its next three meetings, soonest first, then its last three, newest first "
        "(PLAN-V17). A past one has no group. Empty while meetings are off or not read yet",
    )


# --- The prep box ------------------------------------------------------------------------------


class CompanyHit(Out):
    key: str
    name: str
    city: str | None
    industry: str | None
    source: Source


class PersonHit(Out):
    id: str
    name: str
    title: str | None
    company_key: str | None
    company_name: str | None


class CompanySearch(Out):
    people: list[PersonHit]
    companies: list[CompanyHit]


# --- Call prep (PLAN-V10 D2 to D4) ---------------------------------------------------------------

SourceKind = Literal["hubspot", "call", "memory", "lead", "web"]
PrepStatus = Literal["searching", "ready", "failed"]
PrepKind = Literal["person", "cold"]
PrepTrigger = Literal["person", "search_ahead"]
StillThere = Literal["yes", "no", "unknown", "not_checked"]


class PrepSource(Out):
    id: str = Field(description="F1, F2 ... for a fact from the pack, W1, W2 ... for a web page")
    kind: SourceKind
    label: str = Field(description="Where it came from, like 'HubSpot: Perth office'")
    url: str | None
    date: date | None


class PrepFact(Out):
    id: str
    text: str
    source: PrepSource


class PrepPerson(Out):
    id: str
    name: str
    title: str | None


class PrepFacts(Out):
    """Everything we already know, each fact with its source. Free: no Claude request."""

    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        json_schema_extra=optional_in_types("copy_at", "my_last_note"),
    )

    company_key: str
    company_name: str
    city: str | None
    industry: str | None
    staff: int | None
    owner: str | None
    deal: DealState
    next_lease_end: date | None
    last_talk: date | None
    hubspot_url: str | None
    person: PrepPerson | None
    phone: str | None = Field(description="The number to ring: the person's, else the company's")
    last_call: CompanyCall | None
    facts: list[PrepFact]
    people: list[CompanyPerson] = Field(description="For 'Who are you calling?'")
    people_status: PeopleStatus
    prep_enabled: bool = Field(description="False: call scripts are switched off (Settings)")
    names_ok: bool = Field(
        description="False: no names go to Claude (Levi's OK pending), so there is no web check"
    )
    prep_cap_usd: Decimal = Field(
        Decimal("0.25"),
        description="The most one prep may cost: what 'Research again' costs at most (PLAN-V14)",
    )
    copy_at: datetime | None = Field(
        None,
        description="When the last HubSpot sync finished, so the card can say an old copy is old "
        "(PLAN-V15). None before the first sync",
    )
    my_last_note: "MyLastNote | None" = Field(
        None,
        description="My newest call note on this company that isn't in HubSpot yet, for Last talk "
        "(PLAN-V17). None when there is none, or while call notes are off",
    )


class ScriptLine(Out):
    text: str
    sources: list[str] = Field(description="The ids of the sources this line rests on")


class Objection(Out):
    they_say: str
    answer: ScriptLine


class FollowUp(Out):
    """What to ask next, after one likely answer (PLAN-V10 F1)."""

    if_they_say: str = Field(description="A likely answer, in a few words, like 'We'll move'")
    ask: str = Field(description="The question to ask next")


class GuidedQuestion(ScriptLine):
    """A question to ask on the call, with what to ask next for each likely answer."""

    follow_ups: list[FollowUp] = Field(
        default_factory=list, description="Empty for a prep made before 9 Nov"
    )


class NewsLine(ScriptLine):
    """A news item, with the date of the newest dated source it cites (PLAN-V14 T1-2)."""

    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        json_schema_extra=optional_in_types("date"),
    )

    date: DayOrNone = Field(
        None,
        description=(
            "When it happened: the newest date of the web pages and saved notes it cites. "
            "None when none of them has a date, or for a prep made before 11 Nov"
        ),
    )


class PrepScript(Out):
    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        json_schema_extra=optional_in_types("tone_line"),
    )

    still_there: StillThere
    still_there_note: ScriptLine | None
    news: list[NewsLine] = Field(description="Newest first, with undated items last")
    opener: list[ScriptLine]
    why_now: list[ScriptLine]
    questions: list[GuidedQuestion]
    if_they_say: list[Objection]
    goal: ScriptLine | None
    dropped: int = Field(description="Lines left out because they had no source")
    tone_line: str | None = Field(
        None,
        description="Claude's own line on how to sound, in the chosen tone (PLAN-V15). Advice, "
        "not said aloud. None for a prep made before 12 Nov",
    )


class StyleUsed(Out):
    """Which style notes a script was written with (PLAN-V14). A free script uses none."""

    mine: bool = Field(False, description="True when the asker's own style went in")
    team_notes: int = Field(0, description="How many team style notes went in")


class PrepOut(Out):
    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        json_schema_extra=optional_in_types("style_used", "tone_used", "stage_used"),
    )

    id: uuid.UUID
    company_key: str
    company_name: str
    person: PrepPerson | None
    kind: PrepKind
    trigger: PrepTrigger
    status: PrepStatus
    stage: int = Field(description="0 to 3: facts, web check, script. For the progress bar")
    error: str | None = Field(description="Why it failed, in plain words")
    script: PrepScript | None
    sources: list[PrepSource]
    web_checked: bool = Field(description="True when this prep searched the web itself")
    reused: bool = Field(description="True when a ready prep from the last days came back")
    made_by: str | None = Field(description="Who asked, or None for the morning search ahead")
    created_at: datetime
    finished_at: datetime | None
    style_used: StyleUsed = Field(
        default_factory=StyleUsed,
        description="The style notes the script was written with. None for a prep before 11 Nov "
        "or one made with no notes",
    )
    tone_used: ToneKey | None = Field(
        None,
        description="The tone it was written in (PLAN-V15). None for a prep before 12 Nov. When "
        "it differs from mine, the card offers Research again; a tone change spends nothing",
    )
    stage_used: RelationshipStage | None = Field(
        None, description="The relationship stage it was written for. None before 12 Nov"
    )


class PrepAsk(BaseModel):
    company_key: str = Field(min_length=1, max_length=64)
    contact_id: str | None = Field(None, max_length=32, description="HubSpot's contact id")
    cold: bool = Field(False, description="A cold call to the switchboard: no person")
    refresh: bool = Field(False, description="Make a new one, even if one is fresh")


class PrepChip(Out):
    """One of my preps from today, for the chips under the prep box."""

    id: uuid.UUID
    company_key: str
    company_name: str
    person_name: str | None
    kind: PrepKind
    status: PrepStatus
    created_at: datetime


# --- Script edits and style notes (PLAN-V14 T1-3) ------------------------------------------------

# opener.0, why_now.2, question.4, if_they_say.1 or goal. A list slot goes up to its longest list
# (5 questions), so an edit past the end of a shorter new draft is kept.
SLOT_PATTERN = r"^(?:(?:opener|why_now|question|if_they_say)\.[0-4]|goal)$"
LINE_MAX_CHARS = 400
MINE_MAX_CHARS = 600
TEAM_MAX_CHARS = 200
TEAM_MAX_NOTES = 8
StyleStatus = Literal["active", "suggested", "rejected", "retired"]


class ScriptEditIn(BaseModel):
    company_key: str = Field(min_length=1, max_length=64)
    contact_id: str | None = Field(None, max_length=32, description="None for a cold call")
    slot: str = Field(pattern=SLOT_PATTERN, description="opener.0, why_now.1, question.2 ... goal")
    text: str = Field(min_length=1, max_length=LINE_MAX_CHARS)


class ScriptEditOut(Out):
    """One line of one call in my own words. Only I see it."""

    slot: str
    text: str
    updated_at: datetime


class StyleNoteOut(Out):
    id: uuid.UUID
    text: str
    status: StyleStatus
    suggested_by: str | None = Field(description="Who wrote it, or None if they are gone")
    decided_by: str | None = Field(description="The Admin who approved, rejected or retired it")
    decided_at: datetime | None
    created_at: datetime


class ToneChoice(Out):
    key: ToneKey
    label: str = Field(description="Its name on screen, like Direct")
    line: str = Field(description="What it means, like 'Short sentences, the reason first.'")


class ToneView(Out):
    """The tone presets (PLAN-V15 T3-5): mine, the team's default, and the four to pick from."""

    mine: ToneKey | None = Field(description="My own tone, or None to follow the team")
    team: ToneKey = Field(description="The team's default: Friendly until an Admin picks another")
    choices: list[ToneChoice]


class ToneIn(BaseModel):
    tone: ToneKey | None = Field(description="My tone, or None to follow the team's default")


class TeamToneIn(BaseModel):
    tone: ToneKey


class ScriptStyleOut(Out):
    """My style and the team's: what the next script is written with."""

    model_config = ConfigDict(
        json_schema_serialization_defaults_required=True,
        json_schema_extra=optional_in_types("tone"),
    )

    mine: str = Field(description="Your style, or an empty string")
    mine_updated_at: datetime | None
    team: list[StyleNoteOut] = Field(description="The active team notes, oldest first")
    suggestions: list[StyleNoteOut] = Field(
        description=(
            "Notes not active: an Admin gets every waiting one; anyone else gets their own, "
            "waiting or rejected. Newest first"
        )
    )
    can_decide: bool = Field(description="True for an Admin: may approve, reject and retire")
    mine_max_chars: int = MINE_MAX_CHARS
    team_max_chars: int = TEAM_MAX_CHARS
    team_max_notes: int = TEAM_MAX_NOTES
    tone: ToneView = Field(description="The tone presets (PLAN-V15). The API always sends it")


class StyleMineIn(BaseModel):
    text: str = Field(max_length=MINE_MAX_CHARS, description="An empty text clears it")


class StyleNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=TEAM_MAX_CHARS)


# --- Call notes (PLAN-V17 T2-5) -------------------------------------------------------------------

NoteSource = Literal["mic", "typed", "transcript"]
NoteStatus = Literal["sorting", "to_confirm", "sending", "logged", "partial", "failed", "uncertain"]
NoteSortedBy = Literal["ai", "person"]
NoteState = Literal["to_confirm", "logged", "needs_look"]
# HubSpot's six standard call outcomes (core.hubspot.activities.OUTCOME_NAMES; a test checks).
OutcomeName = Literal[
    "Connected", "No answer", "Left voicemail", "Left live message", "Busy", "Wrong number"
]
NoteTaskKind = Literal["call", "email", "todo"]
NoteFieldKind = Literal["date", "number"]
StepStatus = Literal["pending", "done", "failed", "uncertain", "skipped"]
NOTE_MAX_CHARS = 60_000  # the most a note can ever hold; the setting notes_max_chars is less
NOTE_SUMMARY_MAX_CHARS = 600
NOTE_SUBJECT_MAX_CHARS = 200
NOTE_VALUE_MAX_CHARS = 120
NOTE_BATCH_MAX = 50
CARD_ID_PATTERN = r"^[ct][0-9]{1,3}$"  # c1 for a change, t2 for a task
STEP_PATTERN = r"^(?:call|fields|note|task:[0-9]{1,2})$"


class NoteFieldOption(Out):
    id: str = Field(description="Like lease_end")
    label: str = Field(description="Like Lease end")
    kind: NoteFieldKind


SENDING_READY = "True when confirmed notes can be sent to HubSpot now"
WAITING_FOR = (
    "What sending waits for, in plain words, like 'Waiting for HubSpot write access.' None when "
    "ready"
)


class CallNoteOptions(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("transcript_max_chars"))

    enabled: bool = Field(description="True when Log call and Activity show")
    ai_enabled: bool = Field(
        description="True when Claude sorts a note: its switch is on and Claude is set up. "
        "False: the rep picks the outcome and adds follow-ups by hand"
    )
    sending_ready: bool = Field(description=SENDING_READY)
    waiting_for: str | None = Field(description=WAITING_FOR)
    outcomes: list[OutcomeName] = Field(description="HubSpot's call outcomes, for the chips")
    fields: list[NoteFieldOption] = Field(description="The fields a call may change")
    soft_seconds: int = Field(description="When the timer turns Ochre (it never cuts the rep off)")
    max_chars: int = Field(description="The longest note, in characters")
    transcript_max_chars: int = Field(
        description="The longest meeting transcript, in characters, once a .vtt file's times are "
        "taken out. A longer one answers 422 `transcript_too_long`"
    )


class CallNoteIn(BaseModel):
    company_key: str = Field(
        min_length=1, max_length=64, description="A HubSpot company id, or lead:<id>"
    )
    contact_id: SafeText | None = Field(
        None, max_length=32, description="HubSpot's contact id: who the call was with, if known"
    )
    prep_id: uuid.UUID | None = Field(None, description="The call prep it came from, if any")
    text: SafeText = Field(
        max_length=NOTE_MAX_CHARS,
        description="The note as typed or said. It may be empty when an outcome is picked (No "
        "answer needs no words). An email address or a phone number in it is saved as "
        "[email left out] or [number left out]",
    )
    source: NoteSource
    called_at: AwareDatetime = Field(description="When the call was, with its time zone")
    outcome: OutcomeName | None = Field(None, description="How the call went, if the rep picked it")


class CallNoteCall(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("in_hubspot"))

    summary: str = Field(description="Two short lines, or empty until sorted or written")
    outcome: OutcomeName | None
    in_hubspot: bool = Field(
        False, description="True once it is in HubSpot: it can't change here any more"
    )


class CallNoteChange(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("in_hubspot"))

    id: str = Field(description="Like c1")
    field: str = Field(description="Like lease_end")
    label: str = Field(description="Like Lease end")
    office: str = Field(description="Like Perth, or the city of a group like Other Office 2")
    current: str | None = Field(description="What HubSpot has now: a date, or the text")
    value: str = Field(description="The new value: a date as YYYY-MM-DD, or a whole number")
    current_changed: bool = Field(description="True when HubSpot's value changed since you saw it")
    in_hubspot: bool = Field(
        False, description="True once it is in HubSpot: it can't change here any more"
    )


class CallNoteTask(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("in_hubspot"))

    id: str = Field(description="Like t1")
    subject: str
    due: date
    due_words: str = Field(description="When, in the rep's own words. Empty when a date was typed")
    kind: NoteTaskKind
    owner: str | None = Field(description="Who it is for. None: the rep who logged the call")
    in_hubspot: bool = Field(
        False, description="True once it is in HubSpot: it can't change here any more"
    )


class CallNoteStep(Out):
    step: str = Field(
        description="call (note for a logged meeting's notes), fields or task:1 ..., as the "
        "newest send to HubSpot names it. The name to send back when saying whether HubSpot has "
        "an unsure step"
    )
    status: StepStatus = Field(
        description="pending (waiting to be sent), done, failed, uncertain (HubSpot didn't "
        "answer), or skipped (not written: a field HubSpot changed since you saw it is held)"
    )
    words: str = Field(description="What happened, in plain words, like 'Call logged.'")


class CallNoteOut(Out):
    id: uuid.UUID
    company_key: str
    company_name: str
    person: PrepPerson | None
    text: str
    source: NoteSource
    called_at: datetime
    status: NoteStatus
    sorted_by: NoteSortedBy
    unsure: str | None = Field(
        description="When something needs a look before sending, in plain words. These notes "
        "sort first"
    )
    call: CallNoteCall
    changes: list[CallNoteChange]
    tasks: list[CallNoteTask]
    left_out: bool = Field(description="True when it is left out of the next send")
    steps: list[CallNoteStep] = Field(description="Each step of the send, empty until it is sent")
    hubspot_url: str | None = Field(description="The call in HubSpot, once it is logged")
    made_by: str | None = Field(description="Who logged it. None with sign-in off")
    created_at: datetime
    confirmed_at: datetime | None


class CallNotePage(Out):
    total: int
    items: list[CallNoteOut]


class CallNoteChangeIn(BaseModel):
    id: str | None = Field(
        None, pattern=CARD_ID_PATTERN, description="Its id on the card, or none for a new change"
    )
    field: str = Field(
        min_length=1, max_length=32, pattern=r"^[a-z][a-z0-9_]*$", description="Like lease_end"
    )
    office: SafeText | None = Field(
        max_length=64, description="One of the company's offices, as the card names it"
    )
    value: SafeText = Field(
        min_length=1,
        max_length=NOTE_VALUE_MAX_CHARS,
        description="A date as YYYY-MM-DD, or a whole number of staff",
    )


class CallNoteTaskIn(BaseModel):
    id: str | None = Field(
        None, pattern=CARD_ID_PATTERN, description="Its id on the card, or none for a new task"
    )
    subject: SafeText = Field(min_length=1, max_length=NOTE_SUBJECT_MAX_CHARS)
    due: date = Field(description="Not before today, Melbourne time")
    due_words: SafeText | None = Field(
        None,
        max_length=NOTE_VALUE_MAX_CHARS,
        description="The words the date came from, like 'next Tuesday'. Empty when a date was "
        "picked. Left out: kept as they were while the day is the same",
    )
    kind: NoteTaskKind = "todo"
    owner_id: SafeText | None = Field(
        None, max_length=32, description="The HubSpot owner it is for. None: the rep"
    )


class CallNotePatch(BaseModel):
    """The rep's edits. Only the parts sent change: `outcome` or `contact_id` sent as null clears
    it, and `changes` or `tasks` replace the card's whole list."""

    summary: SafeText | None = Field(None, max_length=NOTE_SUMMARY_MAX_CHARS)
    outcome: OutcomeName | None = None
    contact_id: SafeText | None = Field(
        None, max_length=32, description="Who the call was with: one of the company's people"
    )
    changes: list[CallNoteChangeIn] | None = Field(None, max_length=10)
    tasks: list[CallNoteTaskIn] | None = Field(None, max_length=10)
    left_out: bool | None = Field(None, description="True leaves it out of the next send")


class CallNoteIds(BaseModel):
    ids: list[uuid.UUID] = Field(
        min_length=1, max_length=NOTE_BATCH_MAX, description="The notes, in the order to send them"
    )


class CallNoteSkipped(Out):
    id: uuid.UUID
    why: str = Field(description="Why it was left out, in plain words")


class CallNoteTotals(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("meeting_notes"))

    calls: int = Field(description="The calls not yet in HubSpot")
    meeting_notes: int = Field(
        description="The logged meetings' notes not yet in HubSpot. Each goes as a note, not a call"
    )
    tasks: int = Field(description="The follow-ups not yet in HubSpot")
    changes: int = Field(description="The field changes not yet in HubSpot, and not held")


class CallNotePreview(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("skipped"))

    items: list[CallNoteOut] = Field(description="Each note, with what HubSpot has now")
    sending_ready: bool = Field(description=SENDING_READY)
    waiting_for: str | None = Field(description=WAITING_FOR)
    totals: CallNoteTotals = Field(description="What sending these notes would add, in all")
    skipped: list[CallNoteSkipped] = Field(description="The notes that can't be sent, with why")


class CallNoteConfirm(Out):
    model_config = ConfigDict(json_schema_extra=optional_in_types("batch_id", "notes", "skipped"))

    sending: int = Field(description="How many notes started sending. 0 when one was already")
    already_sending: bool = Field(
        description="True when a batch was being sent already: nothing new started"
    )
    batch_id: uuid.UUID | None = Field(description="The batch being sent")
    notes: list[CallNoteOut] = Field(description="The notes that started sending, in order")
    skipped: list[CallNoteSkipped] = Field(description="The notes left out, with why")


class CallNoteResolve(BaseModel):
    step: str = Field(
        pattern=STEP_PATTERN, description="The step to settle: call, fields, task:1 ... or note"
    )
    landed: bool = Field(
        description="True: it is in HubSpot. False: it isn't, so sending again adds it"
    )


class CallNoteSummary(Out):
    to_confirm: int = Field(description="My notes waiting for me to confirm them")
    needs_look: int = Field(description="My notes that failed, were partly saved, or are unsure")
    logged_today: int = Field(description="My notes logged in HubSpot today, Melbourne time")


class MyLastNote(Out):
    """The asking person's newest note on a company that isn't in HubSpot yet (PLAN-V17 T2-7)."""

    model_config = ConfigDict(json_schema_extra=optional_in_types("status"))

    id: uuid.UUID
    summary: str = Field(description="The card's summary, or the note's first 200 characters")
    called_at: datetime
    outcome: OutcomeName | None
    status: NoteStatus = Field(description="Where it is: any status but logged")


PrepFacts.model_rebuild()  # it names MyLastNote, which comes after it


# --- Meetings and the pre-read (PLAN-V17 T2-11) --------------------------------------------------

MeetingWhen = Literal["upcoming", "past"]
# Whose meetings (PLAN-V18 T1-4): everyone's, mine, or my HubSpot team's.
MeetingWho = Literal["all", "mine", "team"]
# Whether "My team" can pick anything out (PLAN-V18 T1-4).
TeamState = Literal["ready", "not_linked", "no_team", "none_in_hubspot"]
# What Sync on Meetings did (PLAN-V18 T1-5).
MeetingsSyncState = Literal["started", "running", "fresh"]
# By the Melbourne date: today, tomorrow, the rest of this week (to Sunday), or later.
MeetingGroup = Literal["today", "tomorrow", "this_week", "later"]
FormStatus = Literal["drafting", "draft", "sent", "failed"]
SummaryBy = Literal["ai", "person"]
HubSpotCopyState = Literal["saved", "waiting", "off", "failed"]


class MeetingFormState(Out):
    """A meeting's pre-read, in short, for a list."""

    id: uuid.UUID
    status: FormStatus = Field(
        description="drafting (being written), draft (ready to check), sent, or failed"
    )


class MeetingItem(Out):
    """One client meeting in a list: the meeting as HubSpot has it, and where its pre-read is."""

    model_config = ConfigDict(json_schema_extra=optional_in_types("owner_name", "mine"))

    meeting: Meeting
    company_name: str = Field(description="The company it is linked to, from our copy")
    owner_name: str | None = Field(
        None,
        description="Whose meeting it is: its owner in HubSpot, from our copy of owners. None for "
        "a typed one (always mine) or an owner we don't know",
    )
    group: MeetingGroup | None = Field(
        description="An upcoming meeting's day, by the Melbourne date: today, tomorrow, "
        "this_week (to Sunday) or later. None for a past one"
    )
    form: MeetingFormState | None = Field(description="Its pre-read, or none yet")
    notes_logged: bool = Field(description="A call note is linked to it (Log meeting)")
    typed: bool = Field(
        False,
        description="True for a meeting typed in for New pre-read: it isn't in HubSpot, its "
        "`meeting.id` is empty, and `form` is its pre-read",
    )
    mine: bool = Field(
        False,
        description="True when I own the meeting or am on it as a Contour person in HubSpot. A "
        "typed one is always mine. False for everyone with sign-in off",
    )


class MeetingPage(Out):
    # Added in PLAN-V18: the API always sends them, and the website's types leave them optional.
    model_config = ConfigDict(
        json_schema_extra=optional_in_types(
            "who", "linked", "team_state", "team_names", "checked_at", "syncing", "sync_problem"
        )
    )

    items: list[MeetingItem]
    total: int = Field(description="How many match, on every page")
    meetings_state: MeetingsState = Field(
        description="ready, waiting (HubSpot's meetings aren't read yet) or off"
    )
    sentence: str | None = Field(
        description="One plain sentence when the list can't show what was asked: meetings "
        "aren't ready, or My meetings or My team can't pick anything out (not linked to a "
        "HubSpot owner, in no HubSpot team, or nobody signed in). Never for All once meetings "
        "are ready"
    )
    who: MeetingWho = Field("all", description="The filter used: all, mine or team")
    linked: bool = Field(
        False,
        description="True when my account is linked to a HubSpot owner. False with sign-in off",
    )
    team_state: TeamState = Field(
        "none_in_hubspot",
        description="ready (I'm in a HubSpot team), not_linked (my account has no HubSpot owner, "
        "or nobody is signed in), no_team (I'm in none) or none_in_hubspot (HubSpot has no "
        "teams: the website hides My team)",
    )
    team_names: list[str] = Field(
        default_factory=list, description="My HubSpot teams' names, by name, or an empty list"
    )
    checked_at: datetime | None = Field(
        None, description="When the last good read of HubSpot's meetings finished, or none"
    )
    syncing: bool = Field(
        False,
        description="True while a read of HubSpot's meetings is running (a Sync, the daily one, "
        "or a refresh). The website asks again until it is false",
    )
    sync_problem: str | None = Field(
        None,
        description="One plain sentence when the newest read of HubSpot's meetings failed or is "
        "waiting for a permission, or none. The list stays as the last good read left it",
    )


class MeetingsSyncOut(Out):
    """What Sync on Meetings did (PLAN-V18 T1-5)."""

    state: MeetingsSyncState = Field(
        description="started (a read of HubSpot's meetings began now, in the background), "
        "running (one was going already: nothing new started) or fresh (a good read finished "
        "under a minute ago, so HubSpot isn't asked again)"
    )
    checked_at: datetime | None = Field(
        description="When the last good read of HubSpot's meetings finished, or none"
    )


class MeetingSummary(Out):
    need_pre_read: int = Field(
        description="My upcoming meetings (the next 7 days) with no pre-read, or one that failed"
    )
    draft_ready: int = Field(description="My upcoming meetings whose pre-read waits for me")


class FormMeeting(Out):
    """The meeting a pre-read is for, as it was when the form was made: from HubSpot, or typed
    in for "New pre-read"."""

    meeting_id: str | None = Field(description="HubSpot's meeting, or none for a typed one")
    company_key: str
    company_name: str
    title: str
    starts_at: datetime
    ends_at: datetime | None
    where: MeetingWhere = Field(description="online (Teams), in_person, or unknown")


class FormFact(Out):
    """A fact on the pre-read, with no AI."""

    label: str = Field(description="Like When, Where, Who we meet, Staff, Lease end")
    value: str
    source: str = Field(description="Where it comes from, like HubSpot meeting")


class FormSummary(Out):
    text: str = Field(description="Empty until it is written")
    by: SummaryBy = Field(description="ai: written by AI. person: the rep wrote or changed it")
    sources: list[PrepSource] = Field(description="The facts it rests on")


class FormSummaries(Out):
    what_they_do: FormSummary
    what_we_know: FormSummary = Field(description="What we know about the project")
    talks_so_far: FormSummary


class FormRecipient(Out):
    name: str | None = Field(description="Their name, when they have an account here")
    email: str = Field(description="A Contour address")


class HubSpotCopy(Out):
    """The pre-read's copy in HubSpot, once it is sent: a note on the company (choice 9)."""

    state: HubSpotCopyState = Field(
        description="saved; waiting (writing to HubSpot isn't ready); off; or failed"
    )
    sentence: str | None = Field(description="One plain sentence, unless it is saved")


class MeetingFormOut(Out):
    """A pre-read: the meeting, the facts, the three summaries, the rep's two blanks, and who it
    went to."""

    id: uuid.UUID
    meeting: FormMeeting
    status: FormStatus
    facts: list[FormFact]
    summaries: FormSummaries
    next_step: str | None = Field(description="The ideal next step: the rep's, never the AI's")
    going: str | None = Field(description="Who is going: the rep's, never the AI's")
    sent_to: list[FormRecipient]
    sent_at: datetime | None
    sent_by: str | None = Field(description="Who sent it")
    hubspot_copy: HubSpotCopy | None = Field(description="None until it is sent")
    cost_usd: Decimal
    error: str | None = Field(description="Why the draft failed, in plain words")


FORM_SUMMARY_MAX_CHARS = 2_000
FORM_BLANK_MAX_CHARS = 1_000


class MeetingFormStart(BaseModel):
    """Starts a pre-read: for a HubSpot meeting (`meeting_id`), or for one typed in
    (`company_key`, `title`, `starts_at`, and `ends_at` and `where` when known)."""

    meeting_id: str | None = Field(
        None, max_length=32, pattern=r"^[0-9]+$", description="HubSpot's meeting"
    )
    company_key: SafeText | None = Field(
        None, max_length=64, description="A typed meeting's company: a HubSpot id, or lead:<id>"
    )
    title: SafeText | None = Field(None, max_length=300)
    starts_at: AwareDatetime | None = Field(None, description="With its time zone")
    ends_at: AwareDatetime | None = None
    where: MeetingWhere = "unknown"

    @model_validator(mode="after")
    def _one_kind(self) -> Self:
        typed = (self.company_key, self.title, self.starts_at, self.ends_at)
        if self.meeting_id is not None and any(part is not None for part in typed):
            raise ValueError("send a meeting_id, or a typed meeting, not both")
        if self.meeting_id is None and not (
            (self.company_key or "").strip() and (self.title or "").strip() and self.starts_at
        ):
            raise ValueError("a typed meeting needs a company_key, a title and starts_at")
        if self.starts_at and self.ends_at and self.ends_at < self.starts_at:
            raise ValueError("ends_at is before starts_at")
        return self


class FormSummariesPatch(BaseModel):
    """The new text of each summary the rep changed. Null or empty clears it."""

    what_they_do: SafeText | None = Field(None, max_length=FORM_SUMMARY_MAX_CHARS)
    what_we_know: SafeText | None = Field(None, max_length=FORM_SUMMARY_MAX_CHARS)
    talks_so_far: SafeText | None = Field(None, max_length=FORM_SUMMARY_MAX_CHARS)


class MeetingFormPatch(BaseModel):
    """The rep's edits. Only the parts sent change. A summary sent here is the rep's own from
    then on (`by: person`): a redraft leaves it alone, and it keeps its sources."""

    summaries: FormSummariesPatch | None = None
    next_step: SafeText | None = Field(None, max_length=FORM_BLANK_MAX_CHARS)
    going: SafeText | None = Field(None, max_length=FORM_BLANK_MAX_CHARS)


ADDRESS_MAX_CHARS = 254
MAX_RECIPIENTS = 20  # the email service's limit for one email
# One address, at most 254 characters (an email address's limit), so a long one is refused
# before any check reads it.
Address = Annotated[SafeText, Field(max_length=ADDRESS_MAX_CHARS)]


class FormPreviewIn(BaseModel):
    """The addresses the rep added, to see the email with them. Empty: only the people on the
    meeting."""

    to: list[Address] = Field(
        default_factory=list,
        max_length=MAX_RECIPIENTS,
        description="Addresses the rep added, each checked against Contour's own domains",
    )


class FormSendIn(BaseModel):
    to: list[Address] = Field(
        min_length=1,
        max_length=MAX_RECIPIENTS,
        description="Who gets it: Contour addresses only. One that isn't refuses the whole send",
    )


class FormPerson(Out):
    """Someone the pre-read would go to."""

    name: str | None = Field(description="Their name, when they have an account here")
    email: str
    why: str = Field(description="Like 'on the meeting', or 'added by you'")
    ticked: bool = Field(description="Ticked to get it. Never ticked when it isn't allowed")
    allowed: bool = Field(description="False for an address that isn't Contour's: it can't")


class FormEmailPreview(Out):
    """The email as it would arrive, and the people it would go to."""

    subject: str
    text: str = Field(description="The plain text version")
    html: str = Field(description="The HTML version, with every value escaped")
    people: list[FormPerson]
    meeting_note: str | None = Field(
        None,
        description=(
            "One sentence when Send also adds the copy to the HubSpot meeting's internal notes "
            "(a HubSpot meeting, and that switch on); none when Send won't touch the meeting"
        ),
    )


TRANSCRIPT_MAX_CHARS = 200_000  # the most a transcript can ever send; the setting is less


class MeetingTranscriptIn(BaseModel):
    """A past meeting's transcript: pasted, or the text of a .txt or .vtt file the website read."""

    text: SafeText = Field(
        max_length=TRANSCRIPT_MAX_CHARS,
        description="The transcript. A .vtt file's text is cleaned of its times here",
    )
    file_name: SafeText | None = Field(
        None, max_length=255, description="The file it came from, if any: a .txt or .vtt file"
    )


class MeetingDetail(Out):
    meeting: Meeting
    company_name: str = Field(description="The company it is linked to, from our copy")
    form: MeetingFormOut | None = Field(description="Its pre-read, or none yet")


CompanyDetail.model_rebuild()  # it names MeetingItem, which comes after it
