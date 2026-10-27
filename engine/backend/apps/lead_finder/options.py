"""What the Start page offers (`GET /lead-finder/run-options`), built from the rules and the
settings in force. Nothing here calls Claude."""

from decimal import Decimal

from apps.lead_finder.geo import CITY_CENTRES
from apps.lead_finder.params import COMPANIES_MAX, COMPANIES_MIN, LeadFinderRunParams
from apps.lead_finder.rules import LeadFinderRules
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
    known = rules.queries.areas.get(city, {})
    return [
        AreaOption(id="cbd", label=AREA_LABELS["cbd"], suburbs=list(known.get("cbd", []))),
        AreaOption(id="inner", label=AREA_LABELS["inner"], suburbs=list(known.get("inner", []))),
        AreaOption(id="all", label=AREA_LABELS["all"], suburbs=[]),
    ]


def build_run_options(
    rules: LeadFinderRules, settings: Settings, daily_left_usd: Decimal
) -> RunOptions:
    cities = rules.criteria.cities
    city_options = [
        CityOption(
            name=name,
            kind=kind,
            lat=CITY_CENTRES[name][0],
            lng=CITY_CENTRES[name][1],
            areas=_areas(rules, name),
        )
        for kind, names in (("pass", cities.pass_), ("director_review", cities.director_review))
        for name in names
        if name in CITY_CENTRES
    ]
    triggers = rules.criteria.triggers
    defaults = LeadFinderRunParams()
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
        companies_limit=CompaniesLimit(min=COMPANIES_MIN, max=COMPANIES_MAX),
        caps=OptionCaps(
            run_cap_usd=caps.run_cap_usd,
            max_companies=caps.max_companies,
            company_cap_usd=caps.company_cap_usd,
            daily_left_usd=daily_left_usd,
        ),
        defaults=defaults,
    )
