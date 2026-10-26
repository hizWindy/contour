"""The run contract: every event type is typed, round trips, and money is text in JSON."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, get_args

import pytest
from pydantic import BaseModel, TypeAdapter, ValidationError

from core.api.errors import FieldError
from core.claude.client import Reply
from core.claude.pricing import Usage
from core.config import Settings
from core.runs import schemas
from core.runs.models import RUN_STATUSES
from core.runs.schemas import (
    EVENT_DATA_MODELS,
    EVENT_TYPE_OF,
    Blocked,
    CapReachedData,
    CompanyDoneData,
    CompanyFailedData,
    CompanySkippedData,
    CompanyStartedData,
    EventLog,
    MergedData,
    PlanReadyData,
    ProgressData,
    RunCaps,
    RunCounts,
    RunCreate,
    RunEstimate,
    RunEventAdapter,
    RunFinishedData,
    RunOut,
    RunPage,
    RunProblemData,
    RunResumedData,
    RunStartedData,
    RunStatus,
    RunSummary,
    RunSummaryDay,
    SliceDoneData,
    SliceFailedData,
    SliceStartedData,
    build_event,
    dump_event,
    event_data,
    event_type_of,
)
from core.runs.types import (
    CapsOverride,
    RunContext,
    RunKind,
    RunTotals,
    RunVersions,
    emit_event,
    make_caps,
)

NOW = datetime(2026, 10, 26, 9, 30, tzinfo=UTC)
CAPS = RunCaps(
    run_cap_usd=Decimal("20.00"),
    max_companies=20,
    company_cap_usd=Decimal("2.50"),
    discovery_cap_usd=Decimal("8.00"),
)
COUNTS = RunCounts(researched=3, by_result={"pass": 2, "watch": 1})
LEAD_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")

SAMPLES: dict[str, BaseModel] = {
    "run_started": RunStartedData(mode="discovery", caps=CAPS, rules_version="abc123"),
    "run_resumed": RunResumedData(from_status="interrupted"),
    "plan_ready": PlanReadyData(slices=2, companies=0, labels=["Melbourne: lease", "Perth: lease"]),
    "slice_started": SliceStartedData(slice_id="mel-lease", label="Melbourne: lease"),
    "slice_done": SliceDoneData(
        slice_id="mel-lease",
        label="Melbourne: lease",
        found=7,
        cost_usd=Decimal("0.41"),
        searches=4,
    ),
    "slice_failed": SliceFailedData(slice_id="per-lease", label="Perth: lease", reason="timeout"),
    "merged": MergedData(candidates=14, unique=11),
    "company_skipped": CompanySkippedData(name="Acme", reason="open deal in HubSpot"),
    "company_started": CompanyStartedData(name="Acme"),
    "company_done": CompanyDoneData(
        name="Acme",
        lead_id=LEAD_ID,
        result="pass",
        score=82,
        cost_usd=Decimal("1.234567"),
        hubspot_status="new",
    ),
    "company_failed": CompanyFailedData(name="Acme", reason="the form couldn't be filled"),
    "progress": ProgressData(
        cost_usd=Decimal("3.5"), web_searches=21, claude_requests=9, counts=COUNTS
    ),
    "problem": RunProblemData(message="One search failed"),
    "cap_reached": CapReachedData(kind="run_cost", detail="Spent $20.00 of the $20.00 cap"),
    "run_finished": RunFinishedData(
        status="done", stop_reason=None, cost_usd=Decimal("12.00"), counts=COUNTS
    ),
}

SPEC_EVENT_TYPES = {
    "run_started",
    "run_resumed",
    "plan_ready",
    "slice_started",
    "slice_done",
    "slice_failed",
    "merged",
    "company_skipped",
    "company_started",
    "company_done",
    "company_failed",
    "progress",
    "problem",
    "cap_reached",
    "run_finished",
}


def union_types() -> set[str]:
    """The `type` words of every event class in the union, read from the classes."""
    alias = schemas.RunEvent.__value__  # Annotated[A | B | ..., Field(discriminator=...)]
    members = get_args(get_args(alias)[0])
    return {get_args(member.model_fields["type"].annotation)[0] for member in members}


def test_every_event_type_in_the_design_has_a_data_model_and_a_union_member() -> None:
    assert set(EVENT_DATA_MODELS) == SPEC_EVENT_TYPES
    assert union_types() == SPEC_EVENT_TYPES
    assert set(SAMPLES) == SPEC_EVENT_TYPES  # this test file has a sample for each


@pytest.mark.parametrize("event_type", sorted(SPEC_EVENT_TYPES))
def test_each_event_validates_through_the_union_and_round_trips(event_type: str) -> None:
    sample = SAMPLES[event_type]
    event = build_event(7, event_type, sample, NOW)
    assert event.type == event_type
    assert event.seq == 7
    assert isinstance(event.data, type(sample))
    as_json = dump_event(event)
    assert as_json["type"] == event_type
    assert as_json["seq"] == 7
    again = RunEventAdapter.validate_python(as_json)
    assert again == event
    # The row stores `data`. Building the event from the stored JSON gives the same event.
    from_row = build_event(7, event_type, event_data(event_type, sample), NOW)
    assert from_row == event


def test_money_is_text_in_the_event_json() -> None:
    event = build_event(1, "company_done", SAMPLES["company_done"], NOW)
    data = dump_event(event)["data"]
    assert data["cost_usd"] == "1.234567"
    assert data["lead_id"] == str(LEAD_ID)
    progress = dump_event(build_event(2, "progress", SAMPLES["progress"], NOW))["data"]
    assert progress["cost_usd"] == "3.5"
    started = dump_event(build_event(3, "run_started", SAMPLES["run_started"], NOW))["data"]
    assert started["caps"]["run_cap_usd"] == "20.00"


def test_the_live_event_and_the_replayed_event_are_the_same_json() -> None:
    live = dump_event(build_event(4, "slice_done", SAMPLES["slice_done"], NOW))
    stored = event_data("slice_done", SAMPLES["slice_done"])
    replay = dump_event(build_event(4, "slice_done", stored, NOW))
    assert live == replay


def test_an_event_with_the_wrong_data_model_is_refused() -> None:
    with pytest.raises(TypeError):
        event_data("company_done", SAMPLES["merged"])
    with pytest.raises(TypeError):
        build_event(1, "merged", SAMPLES["company_done"], NOW)
    with pytest.raises(ValueError):
        event_data("nothing_like_it", SAMPLES["merged"])


def test_every_data_model_has_one_event_type_in_the_reverse_table() -> None:
    assert len(EVENT_TYPE_OF) == len(EVENT_DATA_MODELS) == len(SPEC_EVENT_TYPES)
    assert set(EVENT_TYPE_OF.values()) == SPEC_EVENT_TYPES
    for name, model in EVENT_DATA_MODELS.items():
        assert EVENT_TYPE_OF[model] == name


@pytest.mark.parametrize("event_type", sorted(SPEC_EVENT_TYPES))
def test_the_event_type_is_found_from_the_data_model(event_type: str) -> None:
    sample = SAMPLES[event_type]
    assert event_type_of(sample) == event_type
    # The type found this way builds the same event as the type written out.
    assert build_event(1, event_type_of(sample), sample, NOW).type == event_type


def test_a_model_that_is_not_an_event_has_no_type_and_neither_has_a_subclass() -> None:
    class Other(BaseModel):
        name: str

    class Sub(CompanyStartedData):
        pass

    with pytest.raises(TypeError, match="Other is not the data of any run event"):
        event_type_of(Other(name="x"))
    with pytest.raises(TypeError, match="Sub is not the data of any run event"):
        event_type_of(Sub(name="x"))  # exact types only: a stored row and its model must agree
    with pytest.raises(TypeError):
        event_type_of(RunCaps())  # a part of an event is not an event


def test_the_hubspot_status_of_a_finished_company_is_one_of_the_five_words() -> None:
    from core.hubspot.matching import Status

    words = set(get_args(Status))
    assert words == {"new", "in_hubspot", "open_deal", "dissolved_deal", "possible_match"}
    for word in words:
        data = CompanyDoneData(
            name="Acme",
            lead_id=LEAD_ID,
            result="pass",
            score=80,
            cost_usd=Decimal("1"),
            hubspot_status=word,
        )
        assert data.hubspot_status == word
    with pytest.raises(ValidationError):
        CompanyDoneData.model_validate(
            {**SAMPLES["company_done"].model_dump(), "hubspot_status": "maybe"}
        )
    # The result is still plain text: the rules may add a word without a contract change.
    odd = CompanyDoneData.model_validate({**SAMPLES["company_done"].model_dump(), "result": "x"})
    assert odd.result == "x"


async def test_emit_event_sends_the_type_found_from_the_data() -> None:
    sent: list[tuple[str, BaseModel]] = []

    async def emit(type: str, data: BaseModel) -> None:
        sent.append((type, data))

    merged = MergedData(candidates=3, unique=2)
    await emit_event(emit, merged)
    assert sent == [("merged", merged)]
    with pytest.raises(TypeError):
        await emit_event(emit, CAPS)
    assert len(sent) == 1  # the refused one was not sent


def test_the_union_rejects_an_unknown_type_and_a_data_that_does_not_fit() -> None:
    with pytest.raises(ValidationError):
        RunEventAdapter.validate_python(
            {"seq": 1, "type": "nothing_like_it", "data": {}, "created_at": NOW}
        )
    with pytest.raises(ValidationError):
        RunEventAdapter.validate_python(
            {"seq": 1, "type": "company_done", "data": {"name": "Acme"}, "created_at": NOW}
        )
    with pytest.raises(ValidationError):
        build_event(0, "merged", SAMPLES["merged"], NOW)  # seq starts at 1


def test_cap_kinds_are_the_four_in_the_design() -> None:
    CapReachedData(kind="max_companies", detail="x")
    CapReachedData(kind="searches", detail="x")
    CapReachedData(kind="daily", detail="x")
    with pytest.raises(ValidationError):
        CapReachedData.model_validate({"kind": "mood", "detail": "x"})


def test_company_skipped_may_carry_a_count() -> None:
    data = CompanySkippedData(name="12 companies", reason="over the limit", count=12)
    assert event_data("company_skipped", data)["count"] == 12
    assert event_data("company_skipped", SAMPLES["company_skipped"])["count"] is None


def test_the_event_log_holds_typed_events_and_the_last_seq() -> None:
    log = EventLog(
        items=[
            build_event(1, "run_started", SAMPLES["run_started"], NOW),
            build_event(2, "merged", SAMPLES["merged"], NOW),
        ],
        last_seq=2,
    )
    dumped = log.model_dump(mode="json")
    assert [item["type"] for item in dumped["items"]] == ["run_started", "merged"]
    assert EventLog.model_validate(dumped) == log


def test_run_statuses_match_the_table() -> None:
    assert set(get_args(RunStatus)) == set(RUN_STATUSES)


def run_row(**changes: Any) -> SimpleNamespace:
    """A row shaped like core.runs.models.Run, with JSON columns as plain dicts."""
    row: dict[str, Any] = {
        "id": uuid.uuid4(),
        "app": "lead_finder",
        "mode": "discovery",
        "status": "running",
        "params": {"cities": ["Melbourne"]},
        "caps": CAPS.model_dump(mode="json"),
        "rules_version": "abc123",
        "prompt_versions": "research 1, extract 2",
        "cost_usd": Decimal("1.50"),
        "web_searches": 6,
        "claude_requests": 3,
        "counts": {"researched": 1},
        "stop_reason": None,
        "error": None,
        "error_id": None,
        "cancel_requested_at": None,
        "created_at": NOW,
        "started_at": NOW,
        "finished_at": None,
    }
    return SimpleNamespace(**(row | changes))


def test_a_run_row_becomes_a_run() -> None:
    run = RunOut.model_validate(run_row(), from_attributes=True)
    assert run.status == "running"
    assert run.caps.run_cap_usd == Decimal("20.00")
    assert run.counts.researched == 1
    assert run.counts.by_result == {}
    assert run.counts.resumes == 0
    dumped = run.model_dump(mode="json")
    assert dumped["cost_usd"] == "1.50"
    assert dumped["caps"]["company_cap_usd"] == "2.50"


def test_a_run_row_with_empty_json_columns_still_loads() -> None:
    run = RunOut.model_validate(run_row(caps={}, counts={}, params={}), from_attributes=True)
    assert run.caps.run_cap_usd == Decimal(0)
    assert run.counts == RunCounts()


def test_a_run_page_round_trips() -> None:
    page = RunPage(total=1, items=[RunOut.model_validate(run_row(), from_attributes=True)])
    assert RunPage.model_validate(page.model_dump(mode="json")) == page


def test_run_counts_start_at_zero() -> None:
    counts = RunCounts()
    assert counts.model_dump() == {
        "slices": 0,
        "slices_done": 0,
        "slices_failed": 0,
        "candidates": 0,
        "unique": 0,
        "chosen": 0,
        "researched": 0,
        "skipped": 0,
        "failed": 0,
        "by_result": {},
        "resumes": 0,
    }


def test_run_create_refuses_unknown_fields_and_odd_names() -> None:
    body = RunCreate.model_validate({"app": "lead_finder", "mode": "discovery"})
    assert body.params == {}
    with pytest.raises(ValidationError):
        RunCreate.model_validate({"app": "lead_finder", "mode": "discovery", "param": {}})
    with pytest.raises(ValidationError):
        RunCreate.model_validate({"app": "Lead Finder", "mode": "discovery"})
    with pytest.raises(ValidationError):
        RunCreate.model_validate({"app": "lead_finder", "mode": ""})


def test_an_invalid_estimate_is_a_normal_answer() -> None:
    estimate = RunEstimate(
        valid=False, errors=[FieldError(field="body.params.cities", message="Unknown city")]
    )
    dumped = estimate.model_dump(mode="json")
    assert dumped["valid"] is False
    assert dumped["errors"] == [{"field": "body.params.cities", "message": "Unknown city"}]
    assert dumped["blocked"] is None
    assert dumped["cost_usd_high"] == "0"
    assert dumped["over_cap"] is False


def test_a_full_estimate_has_money_as_text() -> None:
    estimate = RunEstimate(
        valid=True,
        blocked=Blocked(code="hubspot_names_not_approved", message="Not approved yet"),
        warnings=["47 companies, but the run limit is 20"],
        slices=12,
        companies_expected=20,
        cost_usd_low=Decimal("12.50"),
        cost_usd_high=Decimal("19.80"),
        cap_usd=Decimal("20.00"),
        daily_left_usd=Decimal("41.25"),
        basis="defaults",
        over_cap=False,
    )
    dumped = estimate.model_dump(mode="json")
    assert dumped["cost_usd_low"] == "12.50"
    assert dumped["daily_left_usd"] == "41.25"
    assert dumped["blocked"]["code"] == "hubspot_names_not_approved"


def test_the_summary_is_a_list_of_days() -> None:
    summary = RunSummary(
        since=NOW.date(),
        days=[RunSummaryDay(date=NOW.date(), cost_usd=Decimal("3.20"), runs=2)],
        total_cost_usd=Decimal("3.20"),
        total_runs=2,
    )
    dumped = summary.model_dump(mode="json")
    assert dumped["days"][0] == {"date": "2026-10-26", "cost_usd": "3.20", "runs": 2}
    assert TypeAdapter(RunSummary).validate_python(dumped) == summary


def fake_reply(cost: str, searches: int) -> Reply[BaseModel]:
    return Reply(
        model="claude-opus-5-5",
        stop_reason="end_turn",
        parsed=None,
        text="",
        sources=(),
        queries=(),
        usage=Usage(web_searches=searches),
        cost_usd=Decimal(cost),
    )


def test_run_totals_count_each_reply_and_make_a_progress_event() -> None:
    totals = RunTotals()
    totals.add_reply(fake_reply("0.30", 2))
    totals.add_reply(fake_reply("0.45", 3))
    totals.counts.researched += 1
    totals.counts.by_result["pass"] = 1
    progress = totals.progress()
    assert progress.cost_usd == Decimal("0.75")
    assert progress.web_searches == 5
    assert progress.claude_requests == 2
    assert progress.counts.by_result == {"pass": 1}
    totals.counts.researched += 1  # the event holds a copy, so it doesn't change
    assert progress.counts.researched == 1
    build_event(1, "progress", progress, NOW)


def test_run_totals_can_be_the_budget_hook() -> None:
    """`add_reply` has the shape of the per-company budget's `on_spend` hook."""
    from core.claude.budget import Budget

    totals = RunTotals()
    budget = Budget(Decimal("5"), 10)
    reply = fake_reply("0.30", 2)
    budget.record(reply, on_spend=totals.add_reply)
    assert totals.cost_usd == Decimal("0.30")
    assert budget.spent_usd == Decimal("0.30")


# --- The caps a run starts with, and the hooks of a run kind ---------------------------------


def defaults(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


def test_the_caps_come_from_the_settings_when_nobody_chose_any() -> None:
    expected = RunCaps(
        run_cap_usd=Decimal("20.00"),
        max_companies=20,
        company_cap_usd=Decimal("2.50"),
        discovery_cap_usd=Decimal("8.00"),  # 40 percent of the run cap
    )
    assert make_caps(defaults()) == expected
    assert make_caps(defaults(), CapsOverride()) == expected


def test_a_person_can_lower_the_caps_and_the_discovery_share_follows() -> None:
    caps = make_caps(defaults(), CapsOverride(run_cap_usd=Decimal("7.50"), max_companies=5))
    assert caps.run_cap_usd == Decimal("7.50")
    assert caps.max_companies == 5
    assert caps.discovery_cap_usd == Decimal("3.00")
    assert caps.company_cap_usd == Decimal("2.50")
    only_companies = make_caps(defaults(), CapsOverride(max_companies=3))
    assert only_companies.run_cap_usd == Decimal("20.00")
    assert only_companies.max_companies == 3


def test_a_person_cannot_raise_the_caps_above_the_settings() -> None:
    caps = make_caps(defaults(), CapsOverride(run_cap_usd=Decimal("99"), max_companies=80))
    assert caps.run_cap_usd == Decimal("20.00")
    assert caps.max_companies == 20
    assert caps.discovery_cap_usd == Decimal("8.00")


def test_the_discovery_cap_is_whole_cents_rounded_down_and_a_company_fits_the_run() -> None:
    odd = make_caps(defaults(), CapsOverride(run_cap_usd=Decimal("7.33")))
    assert odd.discovery_cap_usd == Decimal("2.93")  # 2.932 rounds down
    tiny = make_caps(defaults(), CapsOverride(run_cap_usd=Decimal("0.50")))
    assert tiny.company_cap_usd == Decimal("0.50")  # one company can't cost more than the run
    assert tiny.discovery_cap_usd == Decimal("0.20")
    sharing = make_caps(defaults(discovery_share=0.25))
    assert sharing.discovery_cap_usd == Decimal("5.00")


def test_a_caps_object_round_trips_as_the_run_row_stores_it() -> None:
    caps = make_caps(defaults(), CapsOverride(run_cap_usd=Decimal("7.50")))
    stored = caps.model_dump(mode="json")
    assert stored["run_cap_usd"] == "7.50"
    assert RunCaps.model_validate(stored) == caps


class SomeParams(BaseModel):
    cities: list[str] = []


async def some_handler(ctx: RunContext[SomeParams]) -> Any:
    raise NotImplementedError


async def some_estimate(ctx: Any) -> Any:
    raise NotImplementedError


def test_a_run_kind_needs_no_hooks_and_the_versions_are_empty_text_by_default() -> None:
    kind = RunKind(
        mode="plain",
        title="Plain",
        params_model=SomeParams,
        handler=some_handler,
        estimate=some_estimate,
    )
    assert (kind.check, kind.caps_override, kind.versions) == (None, None, None)
    assert RunVersions() == RunVersions(rules="", prompts="")


def test_a_run_kind_takes_its_hooks_and_the_context_carries_the_versions() -> None:
    def lower(params: SomeParams) -> CapsOverride:
        return CapsOverride(run_cap_usd=Decimal(len(params.cities)))

    def versions() -> RunVersions:
        return RunVersions(rules="abc123", prompts="research x, extract y")

    kind = RunKind(
        mode="plain",
        title="Plain",
        params_model=SomeParams,
        handler=some_handler,
        estimate=some_estimate,
        caps_override=lower,
        versions=versions,
    )
    assert kind.caps_override is not None
    assert kind.caps_override(SomeParams(cities=["a", "b"])).run_cap_usd == Decimal(2)
    assert kind.versions is not None
    assert kind.versions().prompts == "research x, extract y"
    fields = RunContext.__dataclass_fields__
    assert "rules_version" in fields
    assert "prompt_versions" in fields
