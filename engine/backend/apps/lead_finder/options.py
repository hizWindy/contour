"""What the Start page offers (`GET /lead-finder/run-options`), built from the rules and the
settings in force. Nothing here calls Claude."""

from decimal import Decimal

from apps.lead_finder.geo import CITY_CENTRES, NATIONAL_CENTRE
from apps.lead_finder.params import (
    COMPANIES_MAX,
    COMPANIES_MIN,
    SINCE_DAYS_CHOICES,
    TARGET_MIN,
    LeadFinderRunParams,
    RunSource,
)
from apps.lead_finder.rules import CITY_GROUPS, LeadFinderRules
from apps.lead_finder.run_sources import source_options
from apps.lead_finder.runs import MODES_NEEDING_APPROVAL, RUN_KINDS
from apps.lead_finder.schemas import (
    AreaOption,
    CityOption,
    CompaniesLimit,
    ModeOption,
    OptionCaps,
    RunOptions,
    SinceDaysOption,
    SourceOption,
    TargetOption,
    TopUpOption,
    TriggerOption,
)
from core.config import Settings
from core.runs.types import make_caps

AREA_LABELS = {"cbd": "CBD", "inner": "Inner suburbs", "all": "Whole city"}
# The numbers Start offers for "How many companies" (PLAN-V21 choice 1, TBC). A number above the
# run's company limit becomes the limit, so the most it allows is always one click away.
TARGET_PRESETS = (25, 50, 100)
TOP_UP_OFF = (
    "Needs Levi's OK for HubSpot company names to go to Claude. An admin switches it on, so "
    "nothing is added until then."
)


def target_option(settings: Settings, limit: int) -> TargetOption:
    """The target's bounds for a run with this company limit: from 5 (or the limit, when it is
    lower) to the limit, starting at `target_companies_default`."""
    low = min(TARGET_MIN, limit)
    return TargetOption(
        default=max(low, min(settings.target_companies_default, limit)),
        min=low,
        max=limit,
        presets=sorted({min(preset, limit) for preset in TARGET_PRESETS}),
    )


def top_up_option(settings: Settings) -> TopUpOption:
    """The top up adds HubSpot companies, so it needs Levi's OK for their names to go to Claude."""
    allowed = settings.hubspot_names_to_claude_ok
    return TopUpOption(default=True, allowed=allowed, message=None if allowed else TOP_UP_OFF)


def _areas(rules: LeadFinderRules, city: str) -> list[AreaOption]:
    """The parts of a city a person may pick. A part with no suburbs listed (a regional centre has
    only a CBD) is left out, so the page never offers an empty choice."""
    known = rules.queries.areas.get(city, {})
    parts = [
        AreaOption(id=area, label=AREA_LABELS[area], suburbs=list(known.get(area, [])))
        for area in ("cbd", "inner")
        if known.get(area)
    ]
    return [*parts, AreaOption(id="all", label=AREA_LABELS["all"], suburbs=[])]


def build_run_options(
    rules: LeadFinderRules,
    settings: Settings,
    daily_left_usd: Decimal,
    sources: dict[RunSource, SourceOption] | None = None,
) -> RunOptions:
    """`sources`: what `run_sources.live_source_options` found (it reads the database). Left out,
    the settings alone say which tool is ready."""
    cities = rules.criteria.cities
    # "Australia" comes first: one search for each sign for the whole country (PLAN-V16 T1-2). It
    # must be chosen alone, and its only area is the whole country.
    city_options = [
        CityOption(
            name=cities.national,
            kind="pass",
            group="national",
            lat=NATIONAL_CENTRE[0],
            lng=NATIONAL_CENTRE[1],
            areas=[AreaOption(id="all", label="Whole country", suburbs=[])],
        ),
        *(
            CityOption(
                name=name,
                kind="pass",
                group=group,
                lat=CITY_CENTRES[name][0],
                lng=CITY_CENTRES[name][1],
                areas=_areas(rules, name),
            )
            for group in CITY_GROUPS
            for name in cities.groups[group]
            if name in CITY_CENTRES
        ),
    ]
    triggers = rules.criteria.triggers
    defaults = LeadFinderRunParams()
    # The rivals' sign and the old office's are made by the code, never searched for
    searchable = {item.id for item in rules.criteria.searchable_triggers}
    trigger_options = [
        TriggerOption(
            id=item.id, label=item.label, group=group, default=item.id in defaults.triggers
        )
        for group, items in (
            ("main", triggers.main),
            ("other", triggers.other),
            ("weak", triggers.weak),
        )
        for item in items
        if item.id in searchable
    ]
    caps = make_caps(settings)
    return RunOptions(
        target_companies=target_option(settings, caps.max_companies),
        top_up=top_up_option(settings),
        cities=city_options,
        triggers=trigger_options,
        since_days=SinceDaysOption(choices=list(SINCE_DAYS_CHOICES), default=defaults.since_days),
        modes=[
            ModeOption(
                mode=kind.mode,
                title=kind.title,
                needs_approval=kind.mode in MODES_NEEDING_APPROVAL,
                approved=kind.mode not in MODES_NEEDING_APPROVAL
                or settings.hubspot_names_to_claude_ok,
            )
            for kind in RUN_KINDS
        ],
        watchlist_cities=list(rules.watchlist.count_cities),
        companies_limit=CompaniesLimit(min=COMPANIES_MIN, max=COMPANIES_MAX),
        caps=OptionCaps(
            run_cap_usd=caps.run_cap_usd,
            max_companies=caps.max_companies,
            company_cap_usd=caps.company_cap_usd,
            daily_left_usd=daily_left_usd,
        ),
        sources=sources if sources is not None else source_options(settings),
        defaults=defaults,
    )
