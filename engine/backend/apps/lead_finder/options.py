"""What the Start page offers (`GET /lead-finder/run-options`), built from the rules and the
settings in force. Nothing here calls Claude."""

from decimal import Decimal

from apps.lead_finder.geo import CITY_CENTRES, NATIONAL_CENTRE
from apps.lead_finder.params import COMPANIES_MAX, COMPANIES_MIN, LeadFinderRunParams
from apps.lead_finder.rules import CITY_GROUPS, LeadFinderRules
from apps.lead_finder.runs import MODES_NEEDING_APPROVAL, RUN_KINDS
from apps.lead_finder.schemas import (
    AreaOption,
    CityOption,
    CompaniesLimit,
    ModeOption,
    OptionCaps,
    RunOptions,
    SinceDaysOption,
    TriggerOption,
)
from core.config import Settings
from core.runs.types import make_caps

AREA_LABELS = {"cbd": "CBD", "inner": "Inner suburbs", "all": "Whole city"}


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
    rules: LeadFinderRules, settings: Settings, daily_left_usd: Decimal
) -> RunOptions:
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
        cities=city_options,
        triggers=trigger_options,
        since_days=SinceDaysOption(choices=[7, 30], default=defaults.since_days),
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
        defaults=defaults,
    )
