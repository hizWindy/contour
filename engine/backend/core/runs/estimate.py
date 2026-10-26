"""What a run would cost, before it starts (`POST /runs/estimate`).

Like `reads.py`, this sits apart from `manager.py` so the package that builds the estimate
(B1b) and the package that builds the manager (B1a) never edit the same file.
`RunManager.estimate` only calls `estimate_run` here.

The steps `estimate_run` follows:
1. Find the kind for `(body.app, body.mode)`. Unknown: Problem 404.
2. Check `body.params` with the kind's `params_model`, through the same helper `start` uses
   (`core.runs.validation`). Errors give `valid: false` and `errors` as `body.params.<field>`,
   never an exception.
3. Get the effective settings, then `caps = make_caps(settings, kind.caps_override(params))`
   (`core.runs.types`), the same call the manager makes at start. Then call `kind.check` and
   turn a 422 from it into `valid: false`.
4. Work out `daily_left_usd` and the unit costs (`UnitCosts`: an average of at least 5 finished
   companies or slices from history, else the defaults).
5. Call `kind.estimate(EstimateContext(...))`, which fills the slices, companies and cost range.
6. Add what only the engine knows: the cap that applies, what is left of today's limit, `over_cap`,
   and plain warnings. A kind can report `companies_expected` as the number the params ask for,
   and the engine adds the warning when that is above the run's company limit.

It never starts a run, never runs a gate and never calls Claude. A request that finds nothing
wrong makes three reads: the settings, the cost of the last 24 hours and the history for the
averages.
"""

from collections.abc import Mapping
from datetime import timedelta
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.errors import FieldError, Problem
from core.config import Settings
from core.runs.schemas import RunCaps, RunCreate, RunEstimate
from core.runs.types import (
    DEFAULT_COMPANY_USD,
    DEFAULT_SLICE_USD,
    EstimateContext,
    KindKey,
    RunKind,
    SettingsProvider,
    UnitCosts,
    make_caps,
)
from core.runs.validation import field_errors_of, find_kind, try_parse_params
from core.searches.models import SearchLog

MIN_SAMPLES = 5  # fewer finished companies or slices than this: use the defaults
SAMPLE_WINDOW = 50  # the average looks at the most recent companies or slices only
DAILY_WINDOW = timedelta(hours=24)
DISCOVER_STEP = "discover"  # the step name discovery logs. Every other step is research.
MICRO = Decimal("0.000001")  # money is stored to 6 places
CENT = Decimal("0.01")


# --- Pure parts: no database, so they are quick to test -----------------------------------------


def daily_left(daily_cap_usd: Decimal, spent_last_24h: Decimal) -> Decimal:
    """What is left of today's limit. Never below zero."""
    return max(Decimal(0), daily_cap_usd - spent_last_24h)


def choose_unit_costs(
    *,
    company_samples: int,
    company_average: Decimal | None,
    slice_samples: int,
    slice_average: Decimal | None,
) -> UnitCosts:
    """The average cost of a company and of a slice, or the defaults.

    An average counts only with at least `MIN_SAMPLES` finished companies (or slices) behind it.
    With fewer, the default is used and the samples are 0 ("0: the default" in `UnitCosts`).
    Each of the two is decided on its own.
    """
    company_usd, company_used = DEFAULT_COMPANY_USD, 0
    if company_samples >= MIN_SAMPLES and company_average is not None:
        company_usd, company_used = company_average.quantize(MICRO, ROUND_HALF_UP), company_samples
    slice_usd, slice_used = DEFAULT_SLICE_USD, 0
    if slice_samples >= MIN_SAMPLES and slice_average is not None:
        slice_usd, slice_used = slice_average.quantize(MICRO, ROUND_HALF_UP), slice_samples
    return UnitCosts(
        company_usd=company_usd,
        slice_usd=slice_usd,
        company_samples=company_used,
        slice_samples=slice_used,
    )


def describe_basis(costs: UnitCosts) -> str:
    """Where the numbers come from, in plain words. A kind can use this for `basis`."""

    def part(usd: Decimal, samples: int, one: str, many: str) -> str:
        if samples:
            return f"US${usd:.2f} a {one}, the average of {samples} past {many}"
        return f"US${usd:.2f} a {one}, a default (fewer than {MIN_SAMPLES} past {many} to average)"

    company = part(costs.company_usd, costs.company_samples, "company", "companies")
    slice_ = part(costs.slice_usd, costs.slice_samples, "slice", "slices")
    return f"{company}; {slice_}"


def add_limits(
    estimate: RunEstimate, caps: RunCaps, daily_left_usd: Decimal, costs: UnitCosts
) -> RunEstimate:
    """The kind's estimate plus what only the engine knows.

    Sets the cap that applies, what is left of today's limit and `over_cap` (the worst case is
    above the cap). Adds a plain warning when the companies the params ask for are more than the
    run's limit, and when the worst case is above the run cap. Keeps the kind's own warnings and
    fills `basis` only if the kind left it empty.
    """
    warnings = list(estimate.warnings)
    asked = estimate.companies_expected
    if asked > caps.max_companies:
        warnings.append(
            f"{asked} companies, but the run limit is {caps.max_companies}. "
            f"The run researches at most {caps.max_companies} of them."
        )
    over_cap = estimate.cost_usd_high > caps.run_cap_usd
    if over_cap:
        worst = estimate.cost_usd_high.quantize(CENT, ROUND_UP)  # never shows less than it is
        warnings.append(
            f"The worst case is US${worst:.2f}, which is more than the run limit of "
            f"US${caps.run_cap_usd:.2f}. The run stops when it reaches the limit."
        )
    return estimate.model_copy(
        update={
            "warnings": list(dict.fromkeys(warnings)),  # no sentence twice
            "cap_usd": caps.run_cap_usd,
            "daily_left_usd": daily_left_usd,
            "over_cap": over_cap,
            "basis": estimate.basis or describe_basis(costs),
        }
    )


# --- Reads ---------------------------------------------------------------------------------------


async def spent_last_24h(session: AsyncSession) -> Decimal:
    """What every Claude request of every app cost in the last 24 hours (`core.searches`)."""
    total = await session.scalar(
        select(func.coalesce(func.sum(SearchLog.cost_usd), 0)).where(
            SearchLog.created_at >= func.now() - DAILY_WINDOW
        )
    )
    return Decimal(total or 0)


async def _average_cost(session: AsyncSession, app: str, *, slices: bool) -> tuple[int, Decimal]:
    """(how many, the average cost) of the most recent finished companies or slices of `app`.

    A company is a `job_id` of research steps (any step but discover), logged as the lead id. A
    slice is a `job_id` of discover steps. Its cost is the sum of every request logged under that
    `job_id`. Rows with no `job_id` are left out.
    """
    is_discover = SearchLog.step.startswith(DISCOVER_STEP, autoescape=True)
    per_job = (
        select(func.sum(SearchLog.cost_usd).label("cost"))
        .where(SearchLog.app == app, SearchLog.job_id.is_not(None))
        .where(is_discover if slices else ~is_discover)
        .group_by(SearchLog.job_id)
        .order_by(func.max(SearchLog.created_at).desc())
        .limit(SAMPLE_WINDOW)
        .subquery()
    )
    count, average = (
        await session.execute(select(func.count(), func.avg(per_job.c.cost)).select_from(per_job))
    ).one()
    return int(count), Decimal(average or 0)


async def load_unit_costs(session: AsyncSession, app: str) -> UnitCosts:
    """What a company and a slice of `app` usually cost, from the search log, else the defaults."""
    company_samples, company_average = await _average_cost(session, app, slices=False)
    slice_samples, slice_average = await _average_cost(session, app, slices=True)
    return choose_unit_costs(
        company_samples=company_samples,
        company_average=company_average,
        slice_samples=slice_samples,
        slice_average=slice_average,
    )


# --- The estimate --------------------------------------------------------------------------------


def _invalid(errors: list[FieldError], caps: RunCaps, daily_left_usd: Decimal) -> RunEstimate:
    return RunEstimate(
        valid=False, errors=errors, cap_usd=caps.run_cap_usd, daily_left_usd=daily_left_usd
    )


async def estimate_run(
    body: RunCreate,
    *,
    kinds: Mapping[KindKey, RunKind[Any]],
    session_factory: async_sessionmaker[AsyncSession],
    settings_provider: SettingsProvider,
) -> RunEstimate:
    """What a run would cost. An invalid body is `valid: false`, not an error. Raises
    Problem 404 only for an unknown app or mode."""
    kind = find_kind(kinds, body.app, body.mode)
    settings: Settings = await settings_provider()
    params, errors = try_parse_params(kind.params_model, body.params)
    caps = make_caps(settings)  # without the person's own limits, until the params are valid
    if params is not None:
        caps = make_caps(settings, kind.caps_override(params) if kind.caps_override else None)
        if kind.check is not None:
            try:
                kind.check(params, settings, caps)
            except Problem as problem:
                if problem.status != 422:
                    raise
                errors = field_errors_of(problem)

    async with session_factory() as session:
        left = daily_left(settings.daily_cap_usd, await spent_last_24h(session))
        if params is None or errors:
            return _invalid(errors, caps, left)
        costs = await load_unit_costs(session, body.app)

    context = EstimateContext(
        app=body.app,
        mode=body.mode,
        params=params,
        settings=settings,
        caps=caps,
        daily_left_usd=left,
        unit_costs=costs,
        session_factory=session_factory,
    )
    try:
        estimate = await kind.estimate(context)
    except Problem as problem:
        if problem.status != 422:
            raise
        return _invalid(field_errors_of(problem), caps, left)
    return add_limits(estimate, caps, left, costs)
