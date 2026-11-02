"""The answer forms Claude fills in. Pydantic checks every answer against them.

PARAMETERS.md section 2 lists what we record for each company. Every fact has a source
link, a date and a label. A fact with no source is unknown.
"""

from typing import Annotated, Any, Literal, get_args

from pydantic import (
    BaseModel,
    BeforeValidator,
    Field,
    ValidationInfo,
    WithJsonSchema,
    field_validator,
    model_validator,
)

Label = Literal["confirmed", "estimated", "guessed"]
Angle = Literal["property", "people", "money", "gaps"]


def _empty_is_unknown(value: Any) -> Any:
    """Claude writes empty text for "not known" in the fields below. Python keeps None."""
    if isinstance(value, str) and not value.strip():
        return None
    return value


# Why some fields are plain text in Claude's answer form. A strict form (structured outputs) may
# have at most 16 fields that can be "null or a value" in one request: Anthropic's limit on union
# types. From 30 Oct our form had 18, and Claude refused every request with "The compiled grammar
# is too large" (PLAN-V4). So a text that may be unknown is a plain string in the form, empty when
# unknown. In Python, in saved cards and in the API the website reads, it stays None when unknown
# (`mode="validation"` changes only the schema Claude gets). Only a fact's value stays "null or a
# value". tests/lead_finder/test_forms.py fails if a form gets close to the limit again.
MaybeText = Annotated[
    str | None,
    BeforeValidator(_empty_is_unknown),
    WithJsonSchema({"type": "string"}, mode="validation"),
]
MaybeLabel = Annotated[
    Label | None,
    BeforeValidator(_empty_is_unknown),
    WithJsonSchema({"type": "string", "enum": [*get_args(Label), ""]}, mode="validation"),
]

# Facts added with company criteria version 2. A lead card saved earlier, and a test form that
# leaves them out, don't have them: they are unknown. Claude's answer always has every fact,
# because the form asks for all of them, so the form itself has no defaults.
NEWER_FACTS = (
    "growth_plan",
    "size_needed_m2",
    "growth_by",
    "office_matters",
    "office_since",
    "last_fitout",
)
NEWER_LISTS = ("fitout_contractors", "talking_points", "decision_makers")
MAX_TALKING_POINTS = 3
MAX_CONTRACTORS = 5
MAX_LINE_CHARS = 200  # a talking point or a firm name: one line, cut after parsing
MAX_DECISION_MAKERS = 3
MAX_NAME_CHARS = 120  # a person's name or job title: one line, cut after parsing
NEWER_TEXTS: tuple[str, ...] = ("tier_group",)


def _one_line(text: str, limit: int) -> str:
    return " ".join(text.split())[:limit]


def _holds_contact_details(text: str) -> bool:
    """An email address or a phone number: never kept, even when a public page shows it."""
    return "@" in text or sum(char.isdigit() for char in text) >= 6


# --- Step 1: a search worker's notes --------------------------------------------------


class Note(BaseModel):
    claim: str = Field(description="One fact, in one plain sentence. Name the company.")
    url: str = Field(description="The page that says it. Only a page you saw in your results.")
    published: str | None = Field(description="When the page was published: YYYY-MM-DD, or null")


class AngleNotes(BaseModel):
    notes: list[Note] = Field(description="Up to 12 notes. An empty list if nothing was found.")


# --- Step 2: the answer form ----------------------------------------------------------


class Fact[V: (str, int, bool)](BaseModel):
    value: V | None = Field(description="null when it isn't known")
    source_url: MaybeText = Field(
        description="The page it comes from, from the notes. Empty when the value is null."
    )
    source_date: MaybeText = Field(
        description="The page's date: YYYY-MM-DD. Empty when it isn't known."
    )
    label: MaybeLabel = Field(
        description="confirmed: a source says it. estimated: worked out from sources. "
        "guessed: a reasonable guess. Empty when the value is null."
    )


class TriggerFound(BaseModel):
    id: str = Field(description="One of the trigger ids in the instructions")
    what_happened: str = Field(description="One plain sentence")
    date: MaybeText = Field(
        description="When it happened, as YYYY-MM-DD or YYYY-MM. For lease_ending: when the "
        "lease ends. Empty when it isn't known."
    )
    source_url: str
    label: Label


class BoosterFound(BaseModel):
    id: str = Field(description="One of the booster ids in the instructions")
    evidence: str = Field(description="One plain sentence")
    source_url: str


class DecisionMaker(BaseModel):
    """A person a public page names as one of the company's leaders. Name and job title only."""

    name: str = Field(description="The person's full name, exactly as the note writes it")
    role: str = Field(description="Their job title, like Chief Financial Officer")
    source_url: str = Field(description="The note link that names them in this role")
    source_date: MaybeText = Field(
        description="The page's date: YYYY-MM-DD. Empty when it isn't known."
    )


class CompanyFacts(BaseModel):
    name: str
    website: Fact[str] = Field(description="The company's own website, like seek.com.au")
    city: Fact[str] = Field(description="The city of the office this lead is about")
    industry: Fact[str]
    industry_group: MaybeText = Field(
        description="If the industry belongs to one of the industry groups in the "
        "instructions, that group's name exactly as written. Else empty."
    )
    tier_group: MaybeText = Field(
        description="If the industry belongs to one of the tier groups in the instructions, "
        "that group's name exactly as written. Else empty."
    )
    owner: Fact[str] = Field(description="Like 'ASX-listed, Australian' or 'Private, UK-owned'")
    staff_in_city: Fact[int] = Field(description="Staff at the office in that city")
    staff_from_linkedin: bool = Field(description="true if staff_in_city is a LinkedIn count")
    office_m2: Fact[int] = Field(description="The office's floor area in square metres")
    local_team_runs_project: Fact[bool] = Field(
        description="The local team can run an office project, even if owned overseas"
    )
    healthy: Fact[bool] = Field(
        description="false if in administration, or cutting staff fast. Else true or null."
    )
    office_matters: Fact[bool] = Field(
        description="true if the office matters to how the company works: growth, performance, "
        "culture, collaboration or talent. A head office or technical office counts, even for a "
        "miner or builder. false if it works mostly from warehouses, plants, sites or shops. "
        "Null if no note says."
    )
    triggers: list[TriggerFound] = Field(description="Signs of an office change. Can be empty.")
    boosters: list[BoosterFound] = Field(description="Can be empty")
    expected_move: Fact[str] = Field(description="When an office change might happen, like 2027")
    growth_plan: Fact[bool] = Field(
        description="true if the company has raised big money or made a big announcement AND "
        "plans to hire a lot. Else false or null."
    )
    size_needed_m2: Fact[int] = Field(
        description="The floor area in square metres of the office it says it will need after "
        "that growth. Null if no note says."
    )
    growth_by: Fact[str] = Field(
        description="When it expects to need that office: YYYY-MM or YYYY. Null if no note says."
    )
    office_since: Fact[str] = Field(
        description="When the company moved into its current office in that city: YYYY or "
        "YYYY-MM. Null if no note says."
    )
    last_fitout: Fact[str] = Field(
        description="When that office last had a move, fitout or refit: YYYY-MM or YYYY. The "
        "move-in counts too. Null if no note says."
    )
    fitout_contractors: list[str] = Field(
        description="Names of design or fitout firms that did this company's office, only if a "
        "note names them. Firm names only. Can be empty."
    )
    talking_points: list[str] = Field(
        description="2 or 3 short points for a first call, each tied to the trigger or the "
        "office, like 'Lease ends March 2028'. Plain facts, no hype. No people's names, emails "
        "or phone numbers. Can be empty."
    )
    contact_role: MaybeText = Field(
        description="The role to contact first, like Head of Property, COO or CFO. No names. "
        "Empty if no note points to one."
    )
    decision_makers: list[DecisionMaker] = Field(
        description="Up to 3 people a note names as the company's current leaders, best first: "
        "the head of property, facilities or workplace, then the COO, the CFO, the CEO. Name and "
        "job title only, never an email or phone number. Can be empty."
    )
    summary: str = Field(description="What happened, in one or two plain sentences")
    opening_line: MaybeText = Field(
        description="A friendly first line for a sales email. Empty if there is nothing to say."
    )

    @field_validator("talking_points", "fitout_contractors", mode="after")
    @classmethod
    def _few_short_lines(cls, value: list[str], info: ValidationInfo) -> list[str]:
        """Cut after parsing, not in the form: a long answer must not throw away a paid reply."""
        limit = MAX_TALKING_POINTS if info.field_name == "talking_points" else MAX_CONTRACTORS
        lines = (_one_line(line, MAX_LINE_CHARS) for line in value)
        return [line for line in lines if line][:limit]

    @field_validator("decision_makers", mode="after")
    @classmethod
    def _few_people(cls, value: list[DecisionMaker]) -> list[DecisionMaker]:
        """One line each, no contact details, each person once, and at most three. Cut after
        parsing, like the lists above."""
        kept: list[DecisionMaker] = []
        names: set[str] = set()
        for person in value:
            name = _one_line(person.name, MAX_NAME_CHARS)
            role = _one_line(person.role, MAX_NAME_CHARS)
            if (
                not name
                or not role
                or any(char.isdigit() for char in name)
                or _holds_contact_details(name)
                or _holds_contact_details(role)
                or name.casefold() in names
            ):
                continue
            names.add(name.casefold())
            kept.append(person.model_copy(update={"name": name, "role": role}))
        return kept[:MAX_DECISION_MAKERS]

    @model_validator(mode="before")
    @classmethod
    def _fill_newer_facts(cls, data: Any) -> Any:
        """Facts that didn't exist when a card was saved are unknown, not an error."""
        if not isinstance(data, dict):
            return data
        filled = dict(data)
        for name in NEWER_FACTS:
            filled.setdefault(
                name, {"value": None, "source_url": None, "source_date": None, "label": None}
            )
        for name in NEWER_LISTS:
            filled.setdefault(name, [])
        for name in NEWER_TEXTS:
            filled.setdefault(name, None)
        return filled


# --- Discovery: one slice's list of companies -----------------------------------------------
# No max_length and no max_items on purpose: a long answer must not throw away a paid reply.
# The code cuts the list and the text after parsing (steps/discover.py).


class Candidate(BaseModel):
    """A company that discovery found on a page it read. Nothing here is trusted yet."""

    name: str = Field(
        description="The company's name as the page writes it. No instructions, no web addresses."
    )
    website: str | None = Field(
        description="The company's own website, like acme.com.au, only if you saw it. Else null."
    )
    city: str | None = Field(description="The Australian city of the office this is about, or null")
    trigger_id: str = Field(description="The trigger id from the request")
    what_happened: str = Field(
        description="What happened, in your own words, in one plain sentence"
    )
    date: str | None = Field(
        description="When it happened, as YYYY-MM-DD or YYYY-MM. For lease_ending: when the "
        "lease ends. Null if the page doesn't say."
    )
    url: str = Field(description="The page that says it. Only a page you saw in your results.")
    published: str | None = Field(description="When the page was published: YYYY-MM-DD, or null")


class Candidates(BaseModel):
    companies: list[Candidate] = Field(
        description="Up to 10 companies. An empty list if nothing was found."
    )
