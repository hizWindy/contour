"""The estimate and the params check. Fast: no database, no Claude.

The pure parts (the check of the params, the average cost, the warnings, the daily limit) are
tested directly. The whole `estimate_run` runs with a stand-in session factory that never
connects, and with the two reads it makes (the last 24 hours and the history) replaced. The SQL
of those two reads is tested against a real database in `test_runs_reads.py`.
"""

from decimal import Decimal
from typing import Annotated, Any, Literal, cast

import pytest
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.api.errors import FieldError, Problem
from core.config import Settings
from core.runs import estimate as estimate_module
from core.runs.estimate import (
    MIN_SAMPLES,
    add_limits,
    choose_unit_costs,
    daily_left,
    describe_basis,
    estimate_run,
)
from core.runs.schemas import RunCaps, RunCreate, RunEstimate
from core.runs.types import (
    DEFAULT_COMPANY_USD,
    DEFAULT_SLICE_USD,
    CapsOverride,
    EstimateContext,
    RunContext,
    RunKind,
    RunOutcome,
    UnitCosts,
)
from core.runs.validation import (
    MAX_ERRORS,
    MAX_MESSAGE_CHARS,
    PARAMS_FIELD,
    field_errors_of,
    find_kind,
    invalid_params,
    parse_params,
    try_parse_params,
)

D = Decimal


# --- A small params model and kind to test with (core never imports an app) -----------------------


class ToyCaps(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_cap_usd: Decimal | None = Field(None, gt=0)
    max_companies: int | None = Field(None, gt=0)


class ToyParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    names: list[Annotated[str, Field(min_length=2)]] = Field(default_factory=list, max_length=60)
    since_days: Literal[7, 30] = 30
    caps: ToyCaps = Field(default_factory=ToyCaps)

    @field_validator("names")
    @classmethod
    def _no_x(cls, value: list[str]) -> list[str]:
        if "xx" in value:
            raise ValueError("xx is not a company")
        return value

    @model_validator(mode="after")
    def _not_both(self) -> "ToyParams":
        if self.since_days == 7 and len(self.names) == 7:
            raise ValueError("seven days and seven names don't go together")
        return self


def toy_caps_override(params: ToyParams) -> CapsOverride:
    return CapsOverride(
        run_cap_usd=params.caps.run_cap_usd, max_companies=params.caps.max_companies
    )


async def never_runs(ctx: RunContext[ToyParams]) -> RunOutcome:
    raise AssertionError("an estimate never runs a handler")


class Seen:
    """What the kind's estimate function was given, and how often it was called."""

    def __init__(self) -> None:
        self.contexts: list[EstimateContext[ToyParams]] = []


def make_kind(
    seen: Seen,
    *,
    result: RunEstimate | Exception | None = None,
    check: Any = None,
    overrides: bool = True,
) -> RunKind[ToyParams]:
    async def toy_estimate(ctx: EstimateContext[ToyParams]) -> RunEstimate:
        seen.contexts.append(ctx)
        if isinstance(result, Exception):
            raise result
        if result is not None:
            return result
        return RunEstimate(
            valid=True,
            slices=2,
            companies_expected=len(ctx.params.names),
            cost_usd_low=D("1.00"),
            cost_usd_high=D("3.00"),
        )

    return RunKind(
        mode="toy",
        title="A toy run",
        params_model=ToyParams,
        handler=never_runs,
        estimate=toy_estimate,
        check=check,
        caps_override=toy_caps_override if overrides else None,
    )


class FakeFactory:
    """A session factory whose sessions are plain objects. Nothing connects."""

    def __call__(self) -> "FakeFactory":
        return self

    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(self, *exc: object) -> None:
        return None


class History:
    """What the two reads find. `calls` counts them, so a test can see a read did not happen."""

    def __init__(self) -> None:
        self.spent = D("0")
        self.costs = UnitCosts()
        self.spent_calls = 0
        self.cost_calls = 0


@pytest.fixture
def history(monkeypatch: pytest.MonkeyPatch) -> History:
    found = History()

    async def fake_spent(session: object) -> Decimal:
        found.spent_calls += 1
        return found.spent

    async def fake_costs(session: object, app: str) -> UnitCosts:
        found.cost_calls += 1
        assert app == "lead_finder"
        return found.costs

    monkeypatch.setattr(estimate_module, "spent_last_24h", fake_spent)
    monkeypatch.setattr(estimate_module, "load_unit_costs", fake_costs)
    return found


def settings_of(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


async def run_estimate(
    kind: RunKind[ToyParams],
    params: dict[str, Any],
    *,
    settings: Settings | None = None,
    app: str = "lead_finder",
    mode: str = "toy",
) -> RunEstimate:
    chosen = settings or settings_of(run_cap_usd=D("20"), daily_cap_usd=D("50"))

    async def provider() -> Settings:
        return chosen

    return await estimate_run(
        RunCreate(app=app, mode=mode, params=params),
        kinds={("lead_finder", "toy"): kind},
        session_factory=cast(Any, FakeFactory()),
        settings_provider=provider,
    )


# --- The params check: one conversion for start and for the estimate ------------------------------


def errors_of(params: dict[str, Any]) -> dict[str, str]:
    parsed, errors = try_parse_params(ToyParams, params)
    assert parsed is None
    return {error.field: error.message for error in errors}


def test_good_params_give_the_model_and_no_errors() -> None:
    parsed, errors = try_parse_params(ToyParams, {"names": ["Acme"], "since_days": 7})
    assert errors == []
    assert parsed == ToyParams(names=["Acme"], since_days=7)
    assert parse_params(ToyParams, {}) == ToyParams()


def test_a_bad_value_names_its_field_under_body_params() -> None:
    assert errors_of({"since_days": 14}) == {"body.params.since_days": "Input should be 7 or 30"}


def test_a_bad_item_names_its_place_in_the_list() -> None:
    found = errors_of({"names": ["ok", "a"]})
    assert list(found) == ["body.params.names.1"]


def test_an_unknown_key_is_an_error_on_that_key() -> None:
    found = errors_of({"surprise": 1})
    assert found == {"body.params.surprise": "Extra inputs are not permitted"}


def test_a_nested_field_has_the_full_path() -> None:
    assert list(errors_of({"caps": {"run_cap_usd": "-1"}})) == ["body.params.caps.run_cap_usd"]


def test_the_text_a_validator_wrote_has_no_pydantic_prefix() -> None:
    assert errors_of({"names": ["xx"]}) == {"body.params.names": "xx is not a company"}


def test_a_problem_with_the_params_as_a_whole_is_on_body_params() -> None:
    found = errors_of({"since_days": 7, "names": ["aa"] * 7})
    assert found == {PARAMS_FIELD: "seven days and seven names don't go together"}


def test_an_error_never_repeats_the_value_that_was_sent() -> None:
    found = errors_of({"since_days": "SECRET-VALUE-123", "names": [12345678]})
    assert "SECRET-VALUE-123" not in str(found)
    assert "12345678" not in str(found)


def test_many_errors_are_cut_short() -> None:
    class Wide(BaseModel):
        names: list[Annotated[str, Field(max_length=1)]]

    parsed, errors = try_parse_params(Wide, {"names": ["too long"] * 500})
    assert parsed is None
    assert len(errors) == MAX_ERRORS


def test_a_long_message_is_cut_short() -> None:
    class Wordy(BaseModel):
        value: int

        @field_validator("value")
        @classmethod
        def _check(cls, value: int) -> int:
            raise ValueError("long " * 1000)

    _, errors = try_parse_params(Wordy, {"value": 1})
    assert len(errors[0].message) == MAX_MESSAGE_CHARS


def test_parse_params_raises_a_422_with_the_same_errors() -> None:
    with pytest.raises(Problem) as raised:
        parse_params(ToyParams, {"since_days": 14, "surprise": 1})
    problem = raised.value
    assert problem.status == 422
    assert problem.extra["errors"] == [
        {"field": "body.params.since_days", "message": "Input should be 7 or 30"},
        {"field": "body.params.surprise", "message": "Extra inputs are not permitted"},
    ]
    _, errors = try_parse_params(ToyParams, {"since_days": 14, "surprise": 1})
    assert problem.extra["errors"] == [error.model_dump() for error in errors]


def test_invalid_params_builds_the_422() -> None:
    problem = invalid_params([FieldError(field="body.params.x", message="no")])
    assert (problem.status, problem.extra["errors"]) == (
        422,
        [{"field": "body.params.x", "message": "no"}],
    )


def test_find_kind_finds_it_or_raises_404() -> None:
    kind = make_kind(Seen())
    kinds: dict[tuple[str, str], RunKind[Any]] = {("lead_finder", "toy"): kind}
    assert find_kind(kinds, "lead_finder", "toy") is kind
    for app, mode in (("lead_finder", "nope"), ("nope", "toy")):
        with pytest.raises(Problem) as raised:
            find_kind(kinds, app, mode)
        assert (raised.value.status, raised.value.code) == (404, "unknown_run_kind")


def test_field_errors_of_a_check_problem() -> None:
    listed = Problem(
        422,
        "Too big",
        errors=[
            {"field": "body.params.cities", "message": "Too many"},
            FieldError(field="body.params.triggers", message="Too many too"),
            {"nonsense": True},  # not a field error: left out
        ],
    )
    assert field_errors_of(listed) == [
        FieldError(field="body.params.cities", message="Too many"),
        FieldError(field="body.params.triggers", message="Too many too"),
    ]
    plain = Problem(422, "Too big", "The plan has 40 searches, and the limit is 12.")
    assert field_errors_of(plain) == [
        FieldError(field=PARAMS_FIELD, message="The plan has 40 searches, and the limit is 12.")
    ]
    assert field_errors_of(Problem(422, "Too big", errors=[]))[0].message == "Too big"


# --- Unit costs: an average only from 5 samples --------------------------------------------------


def test_four_samples_are_not_enough_and_five_are() -> None:
    four = choose_unit_costs(
        company_samples=4, company_average=D("1.80"), slice_samples=4, slice_average=D("0.75")
    )
    assert four == UnitCosts(DEFAULT_COMPANY_USD, DEFAULT_SLICE_USD, 0, 0)
    assert not four.from_history

    five = choose_unit_costs(
        company_samples=5, company_average=D("1.80"), slice_samples=5, slice_average=D("0.75")
    )
    assert five == UnitCosts(D("1.80"), D("0.75"), 5, 5)
    assert five.from_history
    assert MIN_SAMPLES == 5


def test_companies_and_slices_are_decided_on_their_own() -> None:
    mixed = choose_unit_costs(
        company_samples=12, company_average=D("0.93"), slice_samples=2, slice_average=D("9.99")
    )
    assert (mixed.company_usd, mixed.company_samples) == (D("0.93"), 12)
    assert (mixed.slice_usd, mixed.slice_samples) == (DEFAULT_SLICE_USD, 0)
    assert mixed.from_history


def test_no_history_gives_the_defaults() -> None:
    none = choose_unit_costs(
        company_samples=0, company_average=None, slice_samples=0, slice_average=None
    )
    assert none == UnitCosts()
    assert none.company_usd == D("1.00") and none.slice_usd == D("0.40")


def test_an_average_is_rounded_to_six_places() -> None:
    costs = choose_unit_costs(
        company_samples=7,
        company_average=D("1.23456789"),
        slice_samples=0,
        slice_average=None,
    )
    assert costs.company_usd == D("1.234568")


def test_the_basis_says_where_the_numbers_come_from() -> None:
    assert describe_basis(UnitCosts()) == (
        "US$1.00 a company, a default (fewer than 5 past companies to average); "
        "US$0.40 a slice, a default (fewer than 5 past slices to average)"
    )
    assert describe_basis(UnitCosts(D("0.9312"), D("0.35"), 12, 8)) == (
        "US$0.93 a company, the average of 12 past companies; "
        "US$0.35 a slice, the average of 8 past slices"
    )


# --- The daily limit -----------------------------------------------------------------------------


def test_what_is_left_of_today_is_never_below_zero() -> None:
    assert daily_left(D("50"), D("12.5")) == D("37.5")
    assert daily_left(D("50"), D("50")) == D(0)
    assert daily_left(D("50"), D("63.1")) == D(0)
    assert daily_left(D("50"), D(0)) == D("50")


# --- Warnings and over_cap -----------------------------------------------------------------------

CAPS = RunCaps(
    run_cap_usd=D("20.00"),
    max_companies=20,
    company_cap_usd=D("2.50"),
    discovery_cap_usd=D("8.00"),
)


def limited(**values: Any) -> RunEstimate:
    return add_limits(RunEstimate(valid=True, **values), CAPS, D("37.50"), UnitCosts())


def test_a_worst_case_above_the_cap_is_over_cap_with_a_warning() -> None:
    result = limited(cost_usd_low=D("10"), cost_usd_high=D("24.505"))
    assert result.over_cap is True
    assert result.warnings == [
        "The worst case is US$24.51, which is more than the run limit of US$20.00. "
        "The run stops when it reaches the limit."
    ]


def test_a_worst_case_exactly_at_the_cap_is_not_over_it() -> None:
    result = limited(cost_usd_high=D("20.00"))
    assert result.over_cap is False
    assert result.warnings == []
    assert limited(cost_usd_high=D("20.000001")).over_cap is True


def test_the_worst_case_is_shown_rounded_up_never_down() -> None:
    result = limited(cost_usd_high=D("20.001"))
    assert "US$20.01" in result.warnings[0]


def test_a_list_longer_than_the_run_limit_gets_a_plain_warning() -> None:
    result = limited(companies_expected=47, cost_usd_high=D("12"))
    assert result.warnings == [
        "47 companies, but the run limit is 20. The run researches at most 20 of them."
    ]
    assert result.over_cap is False
    assert limited(companies_expected=20).warnings == []
    assert limited(companies_expected=21).warnings != []


def test_both_warnings_can_appear_and_the_kinds_own_stay() -> None:
    kind_says = RunEstimate(
        valid=True,
        companies_expected=30,
        cost_usd_high=D("25"),
        warnings=["Two cities have no known areas."],
    )
    result = add_limits(kind_says, CAPS, D("5"), UnitCosts())
    assert result.warnings[0] == "Two cities have no known areas."
    assert len(result.warnings) == 3
    assert result.warnings[1].startswith("30 companies, but the run limit is 20")
    assert result.warnings[2].startswith("The worst case is US$25.00")


def test_the_same_sentence_is_not_given_twice() -> None:
    twice = "47 companies, but the run limit is 20. The run researches at most 20 of them."
    result = add_limits(
        RunEstimate(valid=True, companies_expected=47, warnings=[twice]), CAPS, D("5"), UnitCosts()
    )
    assert result.warnings == [twice]


def test_the_cap_and_the_daily_amount_are_the_engines_numbers() -> None:
    kind_says = RunEstimate(valid=True, cap_usd=D("999"), daily_left_usd=D("999"))
    result = add_limits(kind_says, CAPS, D("37.50"), UnitCosts())
    assert (result.cap_usd, result.daily_left_usd) == (D("20.00"), D("37.50"))


def test_the_basis_is_filled_only_when_the_kind_left_it_empty() -> None:
    costs = UnitCosts(D("1.5"), D("0.5"), 6, 9)
    assert add_limits(RunEstimate(valid=True), CAPS, D(0), costs).basis == describe_basis(costs)
    kept = add_limits(RunEstimate(valid=True, basis="Past runs"), CAPS, D(0), costs)
    assert kept.basis == "Past runs"


def test_add_limits_does_not_change_what_it_was_given() -> None:
    original = RunEstimate(valid=True, companies_expected=47)
    add_limits(original, CAPS, D("5"), UnitCosts())
    assert original.warnings == [] and original.cap_usd == D(0)


# --- estimate_run, start to end, with the reads replaced -----------------------------------------


async def test_an_unknown_app_or_mode_is_a_404(history: History) -> None:
    kind = make_kind(Seen())
    for app, mode in (("lead_finder", "nope"), ("other", "toy")):
        with pytest.raises(Problem) as raised:
            await run_estimate(kind, {}, app=app, mode=mode)
        assert raised.value.status == 404
    assert history.spent_calls == 0


async def test_a_valid_body_is_estimated_with_the_cap_and_the_daily_amount(
    history: History,
) -> None:
    history.spent = D("12.50")
    history.costs = UnitCosts(D("1.50"), D("0.50"), 8, 6)
    seen = Seen()
    result = await run_estimate(make_kind(seen), {"names": ["Acme", "Beta"], "since_days": 7})

    assert result.valid is True and result.errors == []
    assert (result.slices, result.companies_expected) == (2, 2)
    assert (result.cost_usd_low, result.cost_usd_high) == (D("1.00"), D("3.00"))
    assert result.cap_usd == D("20.00")
    assert result.daily_left_usd == D("37.50")
    assert result.over_cap is False and result.warnings == []
    assert result.basis == describe_basis(history.costs)

    (context,) = seen.contexts
    assert (context.app, context.mode) == ("lead_finder", "toy")
    assert context.params == ToyParams(names=["Acme", "Beta"], since_days=7)
    assert context.caps.run_cap_usd == D("20.00") and context.caps.max_companies == 20
    assert context.daily_left_usd == D("37.50")
    assert context.unit_costs == history.costs
    assert context.settings.daily_cap_usd == D("50")


async def test_invalid_params_are_valid_false_and_nothing_else_runs(history: History) -> None:
    history.spent = D("4")
    seen = Seen()
    result = await run_estimate(make_kind(seen), {"since_days": 14, "surprise": True})

    assert result.valid is False
    assert [error.field for error in result.errors] == [
        "body.params.since_days",
        "body.params.surprise",
    ]
    assert result.cap_usd == D("20.00")  # the form still shows the limits
    assert result.daily_left_usd == D("46.00")  # and 0 would look like "nothing left today"
    assert (result.slices, result.companies_expected, result.cost_usd_high) == (0, 0, D(0))
    assert seen.contexts == []
    assert history.cost_calls == 0  # the history is not even read


async def test_the_caps_the_person_chose_lower_the_cap(history: History) -> None:
    seen = Seen()
    kind = make_kind(seen)
    lowered = await run_estimate(kind, {"caps": {"run_cap_usd": "5", "max_companies": 3}})
    assert lowered.cap_usd == D("5")
    assert seen.contexts[0].caps.run_cap_usd == D("5")
    assert seen.contexts[0].caps.max_companies == 3

    above = await run_estimate(kind, {"caps": {"run_cap_usd": "500", "max_companies": 900}})
    assert above.cap_usd == D("20.00")  # an override can only lower the settings' limit
    assert seen.contexts[1].caps.max_companies == 20


async def test_a_kind_without_caps_override_uses_the_settings(history: History) -> None:
    seen = Seen()
    result = await run_estimate(make_kind(seen, overrides=False), {"caps": {"run_cap_usd": "5"}})
    assert result.cap_usd == D("20.00")


async def test_the_company_limit_warning_uses_the_effective_limit(history: History) -> None:
    kind = make_kind(Seen(), result=RunEstimate(valid=True, companies_expected=47))
    result = await run_estimate(kind, {"caps": {"max_companies": 10}})
    assert result.warnings == [
        "47 companies, but the run limit is 10. The run researches at most 10 of them."
    ]


async def test_the_worst_case_above_the_cap_is_over_cap(history: History) -> None:
    kind = make_kind(
        Seen(), result=RunEstimate(valid=True, cost_usd_low=D("6"), cost_usd_high=D("21.40"))
    )
    result = await run_estimate(kind, {})
    assert result.over_cap is True
    assert "US$21.40" in result.warnings[0]
    raised = await run_estimate(kind, {"caps": {"run_cap_usd": "25"}})
    assert raised.over_cap is True  # a cap above the settings is ignored: still 20
    assert raised.cap_usd == D("20.00")
    roomy = await run_estimate(kind, {}, settings=settings_of(run_cap_usd=D("25")))
    assert (roomy.over_cap, roomy.warnings) == (False, [])


async def test_what_is_left_today_is_zero_when_the_limit_is_used_up(history: History) -> None:
    history.spent = D("71.30")
    result = await run_estimate(make_kind(Seen()), {})
    assert result.daily_left_usd == D(0)
    assert result.valid is True  # the estimate is still given


async def test_a_check_that_fails_with_a_422_is_valid_false(history: History) -> None:
    def too_big(params: ToyParams, settings: Settings, caps: RunCaps) -> None:
        raise Problem(
            422,
            "Too big for the settings",
            "The plan has 40 searches, but a run can pay for 12.",
            code="discovery_too_large",
        )

    seen = Seen()
    result = await run_estimate(make_kind(seen, check=too_big), {"names": ["Acme"]})
    assert result.valid is False
    assert result.errors == [
        FieldError(
            field=PARAMS_FIELD, message="The plan has 40 searches, but a run can pay for 12."
        )
    ]
    assert seen.contexts == [] and history.cost_calls == 0
    assert result.cap_usd == D("20.00") and result.daily_left_usd == D("50")


async def test_a_check_gets_the_params_the_settings_and_the_effective_caps(
    history: History,
) -> None:
    given: list[tuple[ToyParams, Settings, RunCaps]] = []

    def record(params: ToyParams, settings: Settings, caps: RunCaps) -> None:
        given.append((params, settings, caps))

    await run_estimate(make_kind(Seen(), check=record), {"caps": {"run_cap_usd": "8"}})
    (params, settings, caps) = given[0]
    assert params.caps.run_cap_usd == D("8")
    assert settings.run_cap_usd == D("20")
    assert caps.run_cap_usd == D("8") and caps.discovery_cap_usd == D("3.20")


async def test_a_check_that_fails_in_another_way_is_not_hidden(history: History) -> None:
    def broken(params: ToyParams, settings: Settings, caps: RunCaps) -> None:
        raise Problem(500, "Something went wrong")

    with pytest.raises(Problem) as raised:
        await run_estimate(make_kind(Seen(), check=broken), {})
    assert raised.value.status == 500


async def test_a_422_from_the_kinds_estimate_is_valid_false_too(history: History) -> None:
    kind = make_kind(
        Seen(),
        result=Problem(
            422, "No watchlist", errors=[{"field": "body.params.watchlist", "message": "Empty"}]
        ),
    )
    result = await run_estimate(kind, {})
    assert result.valid is False
    assert result.errors == [FieldError(field="body.params.watchlist", message="Empty")]
    assert result.daily_left_usd == D("50")


async def test_other_problems_from_the_kinds_estimate_are_not_hidden(history: History) -> None:
    kind = make_kind(Seen(), result=Problem(503, "The engine isn't ready"))
    with pytest.raises(Problem) as raised:
        await run_estimate(kind, {})
    assert raised.value.status == 503


async def test_what_the_kind_says_about_blocking_is_kept(history: History) -> None:
    from core.runs.schemas import Blocked

    blocked = Blocked(code="hubspot_names_not_approved", message="Levi has not said yes yet.")
    kind = make_kind(Seen(), result=RunEstimate(valid=True, blocked=blocked, basis="From notes"))
    result = await run_estimate(kind, {})
    assert result.blocked == blocked
    assert result.basis == "From notes"
    assert result.valid is True


async def test_the_settings_come_from_the_provider_each_time(history: History) -> None:
    kind = make_kind(Seen())
    small = settings_of(run_cap_usd=D("6"), daily_cap_usd=D("9"))
    assert (await run_estimate(kind, {}, settings=small)).cap_usd == D("6")
    history.spent = D("2")
    assert (await run_estimate(kind, {}, settings=small)).daily_left_usd == D("7")
