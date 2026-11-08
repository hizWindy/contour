"""What the Companies routes take and give (PLAN-V10). The website's types come from these."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from apps.companies.deals import DealState, StageKind

Source = Literal["hubspot", "lead"]
SortKey = Literal["name", "staff", "lease", "last_talk"]
SortOrder = Literal["asc", "desc"]
PeopleStatus = Literal["ready", "waiting"]


class Out(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


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


class CompanyDetail(Out):
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


class ScriptLine(Out):
    text: str
    sources: list[str] = Field(description="The ids of the sources this line rests on")


class Objection(Out):
    they_say: str
    answer: ScriptLine


class PrepScript(Out):
    still_there: StillThere
    still_there_note: ScriptLine | None
    news: list[ScriptLine]
    opener: list[ScriptLine]
    why_now: list[ScriptLine]
    questions: list[ScriptLine]
    if_they_say: list[Objection]
    goal: ScriptLine | None
    dropped: int = Field(description="Lines left out because they had no source")


class PrepOut(Out):
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
