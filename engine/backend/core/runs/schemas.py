"""The run contract: what the API returns for runs, and every event a run can emit.

These are the types the website is built from (through `engine/frontend/openapi.json`):
- `RunOut` and `RunPage`: a run, and a page of runs.
- `RunCreate`: the body of `POST /runs`. `params` is checked later against the project's own
  model for that mode.
- `RunEstimate`: what a run would cost, before it starts.
- `RunEvent`: one thing that happened in a run. A union on `type`, one typed `data` model for
  each event type. The same JSON goes out in the live stream (SSE) and in `GET /runs/{id}/log`.

Money is `Decimal`. In JSON it is a string, so no cents are lost on the way.
"""

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from core.api.errors import FieldError
from core.api.models import OutModel
from core.hubspot.matching import Status as HubSpotStatus

RunStatus = Literal["queued", "running", "done", "failed", "cancelled", "interrupted"]
CapKind = Literal["run_cost", "max_companies", "searches", "daily"]

NAME_PATTERN = r"^[a-z][a-z0-9_]*$"


# --- The run itself -----------------------------------------------------------------------


class RunCaps(OutModel):
    """The limits a run started with. They are saved with the run, so a resume keeps them."""

    run_cap_usd: Decimal = Field(
        Decimal(0), description="The most this run may spend on Claude, in US dollars"
    )
    max_companies: int = Field(0, description="The most companies this run researches")
    company_cap_usd: Decimal = Field(
        Decimal(0), description="The most one company may cost, in US dollars"
    )
    discovery_cap_usd: Decimal = Field(
        Decimal(0),
        description="The most discovery may use. The rest of the run cap is for researching.",
    )


class RunCounts(OutModel):
    """What a run has done so far. All zero until it does it."""

    slices: int = Field(0, description="Searches planned for discovery (a trigger in a city)")
    slices_done: int = 0
    slices_failed: int = 0
    candidates: int = Field(0, description="Companies found, before duplicates are merged")
    unique: int = Field(0, description="Companies left after merging duplicates")
    chosen: int = Field(0, description="Companies picked to research")
    researched: int = Field(0, description="Companies researched and saved as leads")
    skipped: int = Field(0, description="Companies left out, with the reason in the feed")
    failed: int = Field(0, description="Companies where research failed")
    by_result: dict[str, int] = Field(
        default_factory=dict, description="Leads saved, by result (like pass or watch)"
    )
    resumes: int = Field(0, description="How many times this run was resumed")


class RunOut(OutModel):
    """One run."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app: str = Field(examples=["lead_finder"])
    mode: str = Field(examples=["discovery"])
    status: RunStatus
    params: dict[str, Any] = Field(description="What the person asked for")
    caps: RunCaps
    rules_version: str
    prompt_versions: str
    cost_usd: Decimal = Field(
        description="What the run has cost. After a stop it can miss a request that was cut off."
    )
    web_searches: int
    claude_requests: int
    counts: RunCounts
    stop_reason: str | None = Field(description="Why the run ended, in plain words")
    error: str | None = Field(description="What went wrong, in plain words. Never a trace.")
    error_id: str | None = Field(description="Finds the full trace in the backend log")
    cancel_requested_at: datetime | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RunPage(BaseModel):
    total: int
    items: list[RunOut]


class RunCreate(BaseModel):
    """The body of `POST /runs`."""

    model_config = ConfigDict(extra="forbid")

    app: str = Field(
        min_length=1,
        max_length=64,
        pattern=NAME_PATTERN,
        description="The project, like lead_finder",
        examples=["lead_finder"],
    )
    mode: str = Field(
        min_length=1,
        max_length=32,
        pattern=NAME_PATTERN,
        description="What kind of run this project offers, like discovery",
        examples=["discovery"],
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="The settings for this mode. Missing ones use the project's defaults.",
        examples=[{"cities": ["Melbourne"], "triggers": ["lease_ending"], "since_days": 30}],
    )


class Blocked(BaseModel):
    """Why a run can't start. The Start button shows `message`."""

    code: str = Field(description="A stable word, like hubspot_names_not_approved")
    message: str = Field(description="Plain words, safe to show a person")


class RunEstimate(OutModel):
    """What a run would cost. An invalid body is a normal answer with `valid` false."""

    valid: bool
    errors: list[FieldError] = Field(default_factory=list)
    blocked: Blocked | None = None
    warnings: list[str] = Field(default_factory=list)
    slices: int = Field(0, description="Discovery searches the run would make")
    companies_expected: int = 0
    cost_usd_low: Decimal = Decimal(0)
    cost_usd_high: Decimal = Field(
        Decimal(0), description="The worst case: every request in flight costs its full reserve"
    )
    cap_usd: Decimal = Field(Decimal(0), description="The run cap that would apply")
    daily_left_usd: Decimal = Field(
        Decimal(0), description="What is left of today's limit across every run and request"
    )
    basis: str = Field("", description="Where the numbers come from, like past runs or defaults")
    over_cap: bool = Field(False, description="True when the worst case is above the cap")


class RunSummaryDay(BaseModel):
    """One day of runs. The day is a date in Australia/Melbourne, by when the run was created."""

    date: date
    cost_usd: Decimal
    runs: int


class RunSummary(BaseModel):
    """Cost and run counts by day, oldest first. Days without a run are left out.

    Every day is an Australia/Melbourne date, the same kind of date as the `since` and `until`
    of `GET /runs`.
    """

    since: date = Field(description="The first day counted (Australia/Melbourne)")
    days: list[RunSummaryDay]
    total_cost_usd: Decimal
    total_runs: int


# --- Events -------------------------------------------------------------------------------
# One `data` model for each event type, and one wrapper that adds `seq`, `type` and the time.


class RunStartedData(BaseModel):
    mode: str
    caps: RunCaps
    rules_version: str


class RunResumedData(BaseModel):
    from_status: str = Field(description="The status the run had before it was resumed")


class PlanReadyData(BaseModel):
    slices: int
    companies: int = Field(description="Companies to research, when they are already known")
    labels: list[str] = Field(description="One short label for each slice, like Melbourne: lease")


class SliceStartedData(BaseModel):
    slice_id: str
    label: str


class SliceDoneData(BaseModel):
    slice_id: str
    label: str
    found: int
    cost_usd: Decimal
    searches: int


class SliceFailedData(BaseModel):
    slice_id: str
    label: str
    reason: str


class MergedData(BaseModel):
    candidates: int
    unique: int


class CompanySkippedData(BaseModel):
    name: str
    reason: str
    count: int | None = Field(None, description="Set when one event stands for several companies")


class CompanyStartedData(BaseModel):
    name: str


class CompanyDoneData(BaseModel):
    name: str
    lead_id: UUID
    result: str = Field(description="The lead's result, like pass or director_review")
    score: int
    cost_usd: Decimal
    hubspot_status: HubSpotStatus = Field(description="Whether HubSpot already has this company")


class CompanyFailedData(BaseModel):
    name: str
    reason: str


class ProgressData(BaseModel):
    cost_usd: Decimal
    web_searches: int
    claude_requests: int
    counts: RunCounts


class RunProblemData(BaseModel):
    message: str


class CapReachedData(BaseModel):
    kind: CapKind
    detail: str


class RunFinishedData(BaseModel):
    status: RunStatus
    stop_reason: str | None
    cost_usd: Decimal
    counts: RunCounts


class _EventBase(BaseModel):
    seq: int = Field(ge=1, description="1, 2, 3 ... in the order the events happened")
    created_at: datetime


class RunStartedEvent(_EventBase):
    type: Literal["run_started"]
    data: RunStartedData


class RunResumedEvent(_EventBase):
    type: Literal["run_resumed"]
    data: RunResumedData


class PlanReadyEvent(_EventBase):
    type: Literal["plan_ready"]
    data: PlanReadyData


class SliceStartedEvent(_EventBase):
    type: Literal["slice_started"]
    data: SliceStartedData


class SliceDoneEvent(_EventBase):
    type: Literal["slice_done"]
    data: SliceDoneData


class SliceFailedEvent(_EventBase):
    type: Literal["slice_failed"]
    data: SliceFailedData


class MergedEvent(_EventBase):
    type: Literal["merged"]
    data: MergedData


class CompanySkippedEvent(_EventBase):
    type: Literal["company_skipped"]
    data: CompanySkippedData


class CompanyStartedEvent(_EventBase):
    type: Literal["company_started"]
    data: CompanyStartedData


class CompanyDoneEvent(_EventBase):
    type: Literal["company_done"]
    data: CompanyDoneData


class CompanyFailedEvent(_EventBase):
    type: Literal["company_failed"]
    data: CompanyFailedData


class ProgressEvent(_EventBase):
    type: Literal["progress"]
    data: ProgressData


class RunProblemEvent(_EventBase):
    type: Literal["problem"]
    data: RunProblemData


class CapReachedEvent(_EventBase):
    type: Literal["cap_reached"]
    data: CapReachedData


class RunFinishedEvent(_EventBase):
    type: Literal["run_finished"]
    data: RunFinishedData


# The data model for each event type. `emit(type, data)` checks the pair against this table.
EVENT_DATA_MODELS: dict[str, type[BaseModel]] = {
    "run_started": RunStartedData,
    "run_resumed": RunResumedData,
    "plan_ready": PlanReadyData,
    "slice_started": SliceStartedData,
    "slice_done": SliceDoneData,
    "slice_failed": SliceFailedData,
    "merged": MergedData,
    "company_skipped": CompanySkippedData,
    "company_started": CompanyStartedData,
    "company_done": CompanyDoneData,
    "company_failed": CompanyFailedData,
    "progress": ProgressData,
    "problem": RunProblemData,
    "cap_reached": CapReachedData,
    "run_finished": RunFinishedData,
}

# The event type for each data model: the other way round. A model that has an event type of its
# own can say it with `event_type_of(data)`, so an emit call can't pair a type with the wrong data.
EVENT_TYPE_OF: dict[type[BaseModel], str] = {
    model: name for name, model in EVENT_DATA_MODELS.items()
}
if len(EVENT_TYPE_OF) != len(EVENT_DATA_MODELS):  # two event types share one data model
    raise RuntimeError("Each event type needs its own data model")

# A `type` alias gives the union a name of its own (RunEvent) in the OpenAPI file.
type RunEvent = Annotated[
    RunStartedEvent
    | RunResumedEvent
    | PlanReadyEvent
    | SliceStartedEvent
    | SliceDoneEvent
    | SliceFailedEvent
    | MergedEvent
    | CompanySkippedEvent
    | CompanyStartedEvent
    | CompanyDoneEvent
    | CompanyFailedEvent
    | ProgressEvent
    | RunProblemEvent
    | CapReachedEvent
    | RunFinishedEvent,
    Field(discriminator="type"),
]

RunEventAdapter: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)


class EventLog(BaseModel):
    """A page of a run's events, oldest first."""

    items: list[RunEvent]
    last_seq: int = Field(
        description="The highest seq the run has (0 if none). Read on if the last item is lower."
    )


def event_type_of(data: BaseModel) -> str:
    """The event type of a data model, found from the model's own class (`type(data)`).

    Raises TypeError when the model is not one of the event data models. A subclass is not
    accepted either: the type has to be exact, so the stored row and the model always agree.
    """
    name = EVENT_TYPE_OF.get(type(data))
    if name is None:
        raise TypeError(f"{type(data).__name__} is not the data of any run event")
    return name


def event_data(type: str, data: BaseModel) -> dict[str, Any]:
    """The JSON to store in a run_events row: `data` as plain JSON (Decimal becomes text).

    Raises ValueError for an unknown type, and TypeError when `data` is not that type's model.
    """
    model = EVENT_DATA_MODELS.get(type)
    if model is None:
        raise ValueError(f"Unknown event type: {type!r}")
    if not isinstance(data, model):
        raise TypeError(f"{type} needs a {model.__name__}, not a {data.__class__.__name__}")
    return data.model_dump(mode="json")


def build_event(
    seq: int, type: str, data: BaseModel | Mapping[str, Any], created_at: datetime
) -> RunEvent:
    """One typed event, from a data model (a live `emit`) or from a stored row's JSON.

    Live events and replayed events both go through here, so they are identical.
    """
    payload = event_data(type, data) if isinstance(data, BaseModel) else dict(data)
    return RunEventAdapter.validate_python(
        {"seq": seq, "type": type, "data": payload, "created_at": created_at}
    )


def dump_event(event: RunEvent) -> dict[str, Any]:
    """The event as plain JSON: what goes in an SSE `data:` line and in the log."""
    dumped: dict[str, Any] = RunEventAdapter.dump_python(event, mode="json")
    return dumped
