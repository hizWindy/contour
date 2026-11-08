"""Every Lead Finder type the API sends or takes, in one place. The website is built from these.

Groups: the Start page options (`RunOptions`), leads (`LeadRow`, `LeadDetail`, `LeadPatch`,
facets, the map, look-alikes), the HubSpot watchlist, and the test set. Money is `Decimal`
(text in JSON). Every fixed list of words is a `Literal`, so the website gets a real union type.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from apps.lead_finder.context import Origin
from apps.lead_finder.params import AreaId, LeadFinderRunParams
from apps.lead_finder.research import LeadCard
from apps.lead_finder.rules import Result
from apps.lead_finder.scoring import Band
from core.api.models import OutModel, SafeText
from core.hubspot.matching import Status
from core.runs.schemas import RunStatus

HubSpotStatus = Status
LeadStatus = Literal["new", "watching", "rejected", "sent"]
# A person can set these. `sent` is set only by the HubSpot send, which comes in Phase 5.
PatchableStatus = Literal["new", "watching", "rejected"]
# Why a person rejected a lead (PLAN-V9 D1). The same list as tables.REJECT_REASONS.
RejectReason = Literal[
    "too_small",
    "wrong_industry",
    "already_talking",
    "bad_timing",
    "not_a_real_sign",
    "other",
]
REJECT_REASON_LABELS: dict[str, str] = {
    "too_small": "Too small",
    "wrong_industry": "Wrong industry",
    "already_talking": "Already talking to them",
    "bad_timing": "Bad timing",
    "not_a_real_sign": "Not a real sign",
    "other": "Other",
}
RivalStatus = Literal["pending", "used", "skipped"]
CityKind = Literal["pass", "director_review"]
TriggerGroup = Literal["main", "other", "weak"]
LeadSort = Literal[
    "score",
    "created_at",
    "updated_at",
    "company",
    "city",
    "result",
    "status",
    "hubspot_status",
    "trigger_date",
    "office_m2",
    "cost_usd",
]
SortOrder = Literal["asc", "desc"]
OfficeBased = Literal["likely", "unlikely"]
LookalikeBasis = Literal["profile", "none"]


# --- Start page options ---------------------------------------------------------------------


class AreaOption(BaseModel):
    id: AreaId
    label: str = Field(examples=["CBD"])
    suburbs: list[str] = Field(description="The suburbs searched. Empty for the whole city.")


class CityOption(BaseModel):
    name: str = Field(examples=["Melbourne"])
    kind: CityKind = Field(
        description="pass: a result can pass. director_review: a Director looks."
    )
    lat: float = Field(description="The centre of the city, approximate")
    lng: float
    areas: list[AreaOption]


class TriggerOption(BaseModel):
    id: str
    label: str
    group: TriggerGroup
    default: bool = Field(description="True when the Start page ticks it at first")


class SinceDaysOption(BaseModel):
    choices: list[int]
    default: int


class ModeOption(BaseModel):
    mode: str
    title: str
    needs_approval: bool = Field(description="True when it sends HubSpot names to Claude")
    approved: bool = Field(description="True when that is allowed. Always true if no approval")


class CompaniesLimit(BaseModel):
    min: int
    max: int


class OptionCaps(BaseModel):
    run_cap_usd: Decimal
    max_companies: int
    company_cap_usd: Decimal
    daily_left_usd: Decimal


class RunOptions(BaseModel):
    """Everything the Start page needs to draw itself."""

    cities: list[CityOption]
    triggers: list[TriggerOption]
    since_days: SinceDaysOption
    modes: list[ModeOption]
    companies_limit: CompaniesLimit
    caps: OptionCaps
    defaults: LeadFinderRunParams = Field(
        description=(
            "The starting values for every part of a run's `params`. The Start page must send "
            "only the parts of its mode in `POST /runs`: a part another mode owns is refused "
            "(422). Each part's description says which mode uses it. `caps` is used by every "
            "mode."
        )
    )


# --- Leads ----------------------------------------------------------------------------------


class LeadRow(BaseModel):
    """One row of the results table."""

    id: UUID
    company: str
    city: str | None
    suburb: str | None
    result: Result
    stage: str = Field(description="The Profile's stage for the result, like Active prospect")
    score: int = Field(description="The points earned, out of the Profile's 100")
    score_checked: int | None = Field(
        description="The most points the tool could judge, like 48 of 60. Empty for a Drop, "
        "and for a lead scored under version 1."
    )
    band: Band | None = Field(
        description="research_first (75 to 100), investigate (50 to 74) or nurture (under 50)"
    )
    status: LeadStatus
    hubspot_status: HubSpotStatus
    hubspot_owner: str | None = Field(
        default=None, description="The HubSpot owner's name, when HubSpot has the company"
    )
    trigger_id: str | None = Field(description="The best trigger that counts")
    trigger_ids: list[str] = Field(description="Every trigger that counts")
    trigger_label: str | None
    trigger_date: date | None
    office_m2: int | None
    office_m2_estimated: bool
    staff_in_city: int | None
    industry: str | None
    industry_group: str | None
    contact_role: str | None
    reason: str = Field(description="One line: why this result")
    form_failed: bool = Field(
        default=False,
        description="True when Claude couldn't fill in the answer form, so the facts are missing",
    )
    run_id: UUID | None
    origin: Origin = Field(
        description="Where the company came from: hubspot (the HubSpot watchlist), web (the "
        "research found it on the web) or typed (a person typed the name)"
    )
    is_test: bool
    useful: bool | None
    note: str | None
    cost_usd: Decimal
    web_searches: int
    created_at: datetime
    updated_at: datetime


class LeadPage(BaseModel):
    total: int
    items: list[LeadRow]


class PreviousLead(BaseModel):
    """An older research of the same company."""

    id: UUID
    created_at: datetime
    result: Result
    score: int
    status: LeadStatus


class RivalOut(BaseModel):
    """A competitor of this lead, to check (PLAN-V9 B5)."""

    name: str
    website: str | None
    city: str
    url: str = Field(description="The page that shows it is a rival")
    why: str
    status: RivalStatus = Field(
        description="pending (the next run for the city adds it), used (a run researched it) or "
        "skipped (a rule left it out, like an open deal)"
    )
    found_at: datetime


class LeadDetail(LeadCard):
    """The full lead card, and what a person has done with the lead."""

    status: LeadStatus
    reject_reason: RejectReason | None
    reject_note: str | None = Field(None, description="What 'other' means, or more detail")
    note: str | None
    useful: bool | None
    run_id: UUID | None
    origin: Origin
    is_test: bool
    updated_at: datetime
    previous: list[PreviousLead] = Field(
        description="Older researches of the same company, newest first"
    )
    rivals: list[RivalOut] = Field(
        default_factory=list,
        description="Rivals to check: competitors found because this is a good lead in a booming "
        "industry (PLAN-V9 B5). Empty for most leads.",
    )


class LeadPatch(BaseModel):
    """A merge patch: a field you leave out stays as it is, and `null` clears it.

    The Undo button sends the exact values the lead had before.
    """

    model_config = ConfigDict(extra="forbid")

    status: PatchableStatus | None = Field(
        None, description="new, watching or rejected. It can't be cleared, only changed."
    )
    reject_reason: RejectReason | None = Field(
        None,
        description="Why: too_small, wrong_industry, already_talking, bad_timing, "
        "not_a_real_sign or other. Required when the status becomes rejected. Cleared when it "
        "leaves rejected.",
    )
    reject_note: SafeText | None = Field(
        None,
        max_length=1000,
        description="Required when the reason is other. Cleared when it leaves rejected.",
    )
    note: SafeText | None = Field(
        None, max_length=2000, description="A person's note. null clears it."
    )
    useful: bool | None = Field(None, description="Thumbs up or down. null clears it.")

    @field_validator("status")
    @classmethod
    def _status_is_never_cleared(cls, value: str | None) -> str | None:
        """A field validator, so the 422 names the field: `body.status`. It runs only when the
        body has `status`, and `null` is the only value it refuses."""
        if value is None:
            raise PydanticCustomError("status", "status can't be cleared. Choose a status.")
        return value


# --- Facets and the map ---------------------------------------------------------------------


class FacetValue(BaseModel):
    value: str
    count: int


class TriggerFacet(BaseModel):
    id: str
    label: str
    count: int


class IntRange(BaseModel):
    min: int | None
    max: int | None


class DateRange(BaseModel):
    """Dates in Australia/Melbourne."""

    min: date | None
    max: date | None


class RunFacet(BaseModel):
    id: UUID
    created_at: datetime
    mode: str
    count: int


class LeadFacets(BaseModel):
    """What the filters offer, with counts. Each count applies every filter except its own."""

    result: list[FacetValue]
    city: list[FacetValue]
    trigger: list[TriggerFacet]
    industry: list[FacetValue] = Field(description="The 50 most common")
    industry_group: list[FacetValue]
    hubspot_status: list[FacetValue]
    status: list[FacetValue]
    origin: list[FacetValue] = Field(
        description="Where the companies came from: hubspot, web or typed, in that order"
    )
    score: IntRange
    office_m2: IntRange
    created: DateRange
    runs: list[RunFacet]


class MapPoint(BaseModel):
    """A pin. The place is approximate: the suburb's centre, or the city's, shifted a little."""

    id: UUID
    name: str
    result: Result
    score: int
    city: str | None
    suburb: str | None
    lat: float
    lng: float


class MapOut(BaseModel):
    total: int = Field(description="Leads that match, even when more than the pins sent")
    items: list[MapPoint] = Field(description="At most 2000 pins")


# --- Look-alikes ----------------------------------------------------------------------------


class DealLookalike(BaseModel):
    """A HubSpot company with a deal that looks like this lead."""

    hubspot_id: str
    name: str
    similarity: float = Field(description="1 is the same, 0 is unrelated")
    city: str | None
    industry: str | None
    deal_status: str | None
    deal_names: list[str]


class LeadLookalike(BaseModel):
    """Another researched lead that looks like this one."""

    lead_id: UUID
    name: str
    result: Result
    score: int
    similarity: float


class SimilarOut(OutModel):
    basis: LookalikeBasis = Field(description="none when the lead has no profile yet")
    note: str | None = None
    deals: list[DealLookalike]
    leads: list[LeadLookalike]


# --- The HubSpot watchlist ------------------------------------------------------------------


class WatchItem(BaseModel):
    """A HubSpot company worth watching."""

    hubspot_id: str
    name: str
    city: str | None = Field(description="The office city where the company is biggest")
    industry: str | None
    office_based: OfficeBased = Field(description="unlikely for builders, miners and the like")
    linkedin_staff: int | None
    estimated_staff: int | None = Field(description="LinkedIn staff times the multiplier")
    owner: str | None
    last_dissolved: date | None = Field(description="When its latest dissolved deal closed")
    note: str | None = Field(description="Like: Dissolved deal, or Industry unknown")


class WatchCounts(BaseModel):
    """How the HubSpot companies split. Every company is counted once."""

    companies: int = Field(description="Companies in the export, without the placeholder")
    watch: int
    likely: int
    unlikely: int
    director: int
    open_deal: int = Field(description="Left out: they have an open deal")
    dropped_small: int = Field(description="Left out: too few staff, or no staff number")
    staff_unknown: int = Field(description="Of those, how many have no staff number")
    no_office: int = Field(description="Left out: no office in a known city")


class WatchlistOut(BaseModel):
    total: int = Field(description="The size of the watch list, before `limit`")
    items: list[WatchItem] = Field(description="The watch list, most likely first")
    director: list[WatchItem] = Field(description="The Director review list")
    staff_unknown: list[WatchItem] = Field(description="Dropped for no staff number")
    counts: WatchCounts


# --- The test set ---------------------------------------------------------------------------


class TestSummary(BaseModel):
    """One run of the test set, so scores can be compared over time."""

    __test__ = False  # not a pytest class

    run_id: UUID
    created_at: datetime
    status: RunStatus
    companies: int
    expected: int = Field(description="Companies with an expected result")
    matched: int = Field(description="Of those, how many came out as expected")
    avg_cost_usd: Decimal
    total_cost_usd: Decimal
    rules_version: str
    prompt_versions: str


class TestPage(BaseModel):
    __test__ = False

    total: int
    items: list[TestSummary]


class TestItem(BaseModel):
    """One company of a test run."""

    __test__ = False

    name: str
    city: str | None
    expected: list[Result] | None = Field(description="null when nothing is expected")
    result: Result | None = Field(description="null when the company failed")
    score: int | None
    unknown_facts: list[str]
    cost_usd: Decimal
    ok: bool | None = Field(description="null when nothing is expected")
    lead_id: UUID | None
    note: str | None = Field(description="Why a company failed or was skipped")


class TestReport(BaseModel):
    __test__ = False

    summary: TestSummary
    items: list[TestItem]


# --- Reject reasons (PLAN-V9 D1) --------------------------------------------------------------


class RejectReasonCount(BaseModel):
    reason: RejectReason
    label: str
    count: int


class RejectReasonCounts(BaseModel):
    """How many leads were rejected for each reason lately. The counts show which rule to tune."""

    days: int
    total: int
    reasons: list[RejectReasonCount] = Field(description="Every reason, most used first")
