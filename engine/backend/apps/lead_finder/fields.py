"""The answer forms Claude fills in. Pydantic checks every answer against them.

PARAMETERS.md section 2 lists what we record for each company. Every fact has a source
link, a date and a label. A fact with no source is unknown.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

Label = Literal["confirmed", "estimated", "guessed"]
Angle = Literal["property", "people", "money", "gaps"]

# Facts added with company criteria version 2. A lead card saved earlier, and a test form that
# leaves them out, don't have them: they are unknown. Claude's answer always has every fact,
# because the form asks for all of them, so the form itself has no defaults.
NEWER_FACTS = ("growth_plan", "size_needed_m2", "growth_by", "office_matters")
NEWER_LISTS: tuple[str, ...] = ()
NEWER_TEXTS: tuple[str, ...] = ("tier_group",)


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
    source_url: str | None = Field(description="The page it comes from, from the notes")
    source_date: str | None = Field(description="The page's date: YYYY-MM-DD, or null")
    label: Label | None = Field(
        description="confirmed: a source says it. estimated: worked out from sources. "
        "guessed: a reasonable guess."
    )


class TriggerFound(BaseModel):
    id: str = Field(description="One of the trigger ids in the instructions")
    what_happened: str = Field(description="One plain sentence")
    date: str | None = Field(
        description="When it happened, as YYYY-MM-DD or YYYY-MM. For lease_ending: when the "
        "lease ends."
    )
    source_url: str
    label: Label


class BoosterFound(BaseModel):
    id: str = Field(description="One of the booster ids in the instructions")
    evidence: str = Field(description="One plain sentence")
    source_url: str


class CompanyFacts(BaseModel):
    name: str
    website: Fact[str] = Field(description="The company's own website, like seek.com.au")
    city: Fact[str] = Field(description="The city of the office this lead is about")
    industry: Fact[str]
    industry_group: str | None = Field(
        description="If the industry belongs to one of the industry groups in the "
        "instructions, that group's name exactly as written. Else null."
    )
    tier_group: str | None = Field(
        description="If the industry belongs to one of the tier groups in the instructions, "
        "that group's name exactly as written. Else null."
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
    contact_role: str | None = Field(
        description="The role to contact first, like Head of Property, COO or CFO. No names."
    )
    summary: str = Field(description="What happened, in one or two plain sentences")
    opening_line: str | None = Field(description="A friendly first line for a sales email")

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
