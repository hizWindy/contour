"""The answer forms Claude fills in. Pydantic checks every answer against them.

PARAMETERS.md section 2 lists what we record for each company. Every fact has a source
link, a date and a label. A fact with no source is unknown.
"""

from typing import Literal

from pydantic import BaseModel, Field

Label = Literal["confirmed", "estimated", "guessed"]
Angle = Literal["property", "people", "money", "gaps"]


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
    triggers: list[TriggerFound] = Field(description="Signs of an office change. Can be empty.")
    boosters: list[BoosterFound] = Field(description="Can be empty")
    expected_move: Fact[str] = Field(description="When an office change might happen, like 2027")
    contact_role: str | None = Field(
        description="The role to contact first, like Head of Property, COO or CFO. No names."
    )
    summary: str = Field(description="What happened, in one or two plain sentences")
    opening_line: str | None = Field(description="A friendly first line for a sales email")


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
