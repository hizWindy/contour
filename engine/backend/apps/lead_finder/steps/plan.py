"""Plan a discovery run: its slices, the watchlist batches and the size check. Pure code.

A slice is one trigger in one city. A discovery run makes one Claude request for each slice
(`steps/discover.py`). The plan needs only the run's params and the rules: no settings, no
database, no Claude. So it is quick to test, and the same params always give the same slices in
the same order (cities first, in the order the person gave them, then triggers).

`check_discovery_size` is the `RunKind.check` function for the discovery mode. It refuses a run
whose slices, each held at the slice reserve, would not fit in the share of the run cap that
discovery may use (422 `discovery_too_large`). It counts sweep 1 only: a later sweep runs only while
discovery's money lasts (PLAN-V21 T1-4).

**Sweeps** (PLAN-V21 T1-3). A run a person starts may search its signs up to four times, each time
in a new way, while it has fewer companies than its target: the signs' own searches (sweep 1),
Levi's source groups for them (2), the signs by sector group (3) and the signs by area (4).
`make_slices(params, rules, sweep)` gives one slice for each city and sign in every sweep; the
sweep only changes the searches its request suggests (`sweep_searches`).
"""

import re
import uuid
from collections.abc import Sequence
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from apps.lead_finder.params import AreaId, DiscoveryParams, LeadFinderRunParams
from apps.lead_finder.rules import SWEEP_IDS, LeadFinderRules, SweepId, load_rules
from core.api.errors import Problem
from core.config import Settings
from core.runs.schemas import RunCaps

WATCHLIST_BATCH_SIZE = 20  # companies in one batch of the watchlist (TBC with Levi)
AREA_WORDS: dict[AreaId, str] = {"cbd": "CBD", "inner": "inner suburbs", "all": "whole city"}
SWEEPS_MAX = len(SWEEP_IDS)  # 4: the signs, the source groups, by sector and by area


class Slice(BaseModel):
    """One trigger in one city: the unit of discovery. JSON-simple, so it can sit in the graph
    state and travel as a `Send` payload (`slice.model_dump()` and `Slice.model_validate(d)`)."""

    model_config = ConfigDict(frozen=True)

    id: str  # like "melbourne:lease_ending". Once in a run, and the same on a resume.
    trigger_id: str
    city: str
    area: AreaId
    label: str  # for people, like "Melbourne (CBD): lease ending"
    # PLAN-V21 T1-3: which sweep it is in, 1 to 4. Sweeps 2 to 4 add ":sweep<n>" to the id and the
    # sweep's words to the label, like "Melbourne: lease ending (by area)".
    sweep: int = 1

    @property
    def sweep_id(self) -> SweepId:
        return SWEEP_IDS[self.sweep - 1]


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _label(city: str, area: AreaId, trigger_id: str) -> str:
    place = city if area == "all" else f"{city} ({AREA_WORDS[area]})"
    return f"{place}: {trigger_id.replace('_', ' ')}"


def sweep_label(rules: LeadFinderRules, sweep: int) -> str:
    """A sweep in plain words, from queries.yaml (`sweeps.labels`), like "By area"."""
    sweep_id = SWEEP_IDS[sweep - 1]
    return rules.queries.sweeps.labels.get(sweep_id) or sweep_id.capitalize()


def sweeps_for(most: int) -> int:
    """How many sweeps a run may make: `most` (the setting), from 1 to 4."""
    return max(1, min(most, SWEEPS_MAX))


def is_national(params: DiscoveryParams | LeadFinderRunParams, rules: LeadFinderRules) -> bool:
    """True for the all-of-Australia choice (PLAN-V16 T1-2): `cities` is the national name alone."""
    return rules.criteria.cities.national in params.cities


def run_cities(params: DiscoveryParams | LeadFinderRunParams, rules: LeadFinderRules) -> list[str]:
    """The places a run's companies may be in. The cities it names, or every place the rules list
    for the national search (the research then finds each company's city)."""
    if is_national(params, rules):
        return rules.criteria.cities.every
    return list(params.cities)


def web_picked(params: DiscoveryParams | LeadFinderRunParams) -> bool:
    """True when discovery searches the web (PLAN-V16 T1-8): `sources` is left out, or names it."""
    return params.sources is None or "web" in params.sources


def make_slices(
    params: DiscoveryParams | LeadFinderRunParams, rules: LeadFinderRules, sweep: int = 1
) -> list[Slice]:
    """Cities x triggers, city by city, for one sweep (1 to 4, PLAN-V21 T1-3). `params.area`
    narrows a city's focus (see `focus_places`); a city it doesn't list is searched whole. A run
    whose `sources` leave out the web has no slices: its companies come from the property tools'
    feed (`run_sources.py`). Every sweep has the same cities and signs: only its searches differ.

    The national choice (`cities: ["Australia"]`, PLAN-V16 T1-2) is one slice for each sign, not
    one for each city: 20 places x 6 signs would be 120 searches. Its searches say "Australia" in
    place of the city, and the answer form asks Claude which city each company's office is in.

    The params are already checked, so a city or trigger the rules don't know is a bug in the
    caller and raises ValueError.
    """
    if not 1 <= sweep <= SWEEPS_MAX:
        raise ValueError(f"A run has sweeps 1 to {SWEEPS_MAX}, not {sweep}")
    known_triggers = {item.id for item in rules.criteria.triggers.every}
    national = rules.criteria.cities.national
    slices: list[Slice] = []
    if not web_picked(params):
        return slices
    words = "" if sweep == 1 else f" ({sweep_label(rules, sweep).lower()})"
    suffix = "" if sweep == 1 else f":sweep{sweep}"
    for city in params.cities:
        if city != national and city not in rules.queries.areas:
            raise ValueError(f"The rules have no areas for the city {city!r}")
        area: AreaId = "all" if city == national else params.area.get(city, "all")
        for trigger_id in params.triggers:
            if trigger_id not in known_triggers:
                raise ValueError(f"The rules have no trigger {trigger_id!r}")
            slices.append(
                Slice(
                    id=f"{_slug(city)}:{trigger_id}{suffix}",
                    trigger_id=trigger_id,
                    city=city,
                    area=area,
                    label=_label(city, area, trigger_id) + words,
                    sweep=sweep,
                )
            )
    return slices


def slice_job_id(run_id: uuid.UUID, slice_: Slice) -> uuid.UUID:
    """The `job_id` of a slice in the search log: the same slice of the same run always gets
    the same id, so a resume logs under it again. `core.searches.job_id` is a UUID."""
    return uuid.uuid5(run_id, f"slice:{slice_.id}")


def focus_places(rules: LeadFinderRules, city: str, area: AreaId) -> list[str]:
    """The places discovery is told to focus on (queries.yaml `areas`).

    `cbd` and `inner` give that list. `all` gives both lists, CBD first. A city with no places
    for the area gives the city's own name, so the focus is never empty.
    """
    places = rules.queries.areas.get(city, {})
    cbd, inner = places.get("cbd", []), places.get("inner", [])
    chosen = cbd if area == "cbd" else inner if area == "inner" else [*cbd, *inner]
    return list(dict.fromkeys(chosen)) or [city]


def area_text(rules: LeadFinderRules, city: str, area: AreaId) -> str:
    """What `{area}` becomes in a search template: the city for `all`, else the places."""
    return city if area == "all" else ", ".join(focus_places(rules, city, area))


def sweep_places(rules: LeadFinderRules, slice_: Slice) -> list[str]:
    """What `{area}` becomes in sweep 4, one search each (PLAN-V21 T1-3): the CBD, then the inner
    suburbs, as the city's area allows. A part with no places is left out, and a city with none
    at all is searched by name. For all of Australia: each priority city by name."""
    if slice_.city == rules.criteria.cities.national:
        return list(rules.criteria.cities.groups["priority"])
    places = rules.queries.areas.get(slice_.city, {})
    parts: tuple[AreaId, ...] = ("cbd", "inner") if slice_.area == "all" else (slice_.area,)
    found = [", ".join(places[part]) for part in parts if part != "all" and places.get(part)]
    return found or [slice_.city]


def sweep_searches(rules: LeadFinderRules, slice_: Slice, values: dict[str, object]) -> list[str]:
    """The searches a slice's request suggests, filled in (PLAN-V21 T1-3):

    1. the sign's own searches (`discovery`);
    2. Levi's source groups for the sign, then the sign's own line in `sweeps.sources`;
    3. each sector group, through `sweeps.sectors`;
    4. each place, through `sweeps.areas`.

    `values` holds what every template may use ({city}, {area}, {year}, {month_year} and an empty
    {company}); this adds {sector} and {terms} where a sweep needs them. Nothing here comes from
    what a search found, so a page can't steer another search.
    """
    sign = slice_.trigger_id
    wording = rules.queries.sweeps
    if slice_.sweep == 1:
        return [template.format(**values) for template in rules.queries.discovery[sign]]
    if slice_.sweep == 2:
        templates = [
            *(t for group in rules.queries.groups_for_sign(sign) for t in group.discovery),
            *wording.sources.get(sign, []),
        ]
        return [template.format(**values) for template in templates]
    terms = wording.terms.get(sign) or sign.replace("_", " ")
    if slice_.sweep == 3:
        return [
            template.format(**{**values, "sector": group.words, "terms": terms})
            for group in wording.sector_groups
            for template in wording.sectors
        ]
    return [
        template.format(**{**values, "area": place, "terms": terms})
        for place in sweep_places(rules, slice_)
        for template in wording.areas
    ]


def watchlist_batches[T](items: Sequence[T], size: int = WATCHLIST_BATCH_SIZE) -> list[list[T]]:
    """The watchlist cut into batches of `size` (20), in the same order."""
    if size < 1:
        raise ValueError("A batch needs at least 1 item")
    return [list(items[start : start + size]) for start in range(0, len(items), size)]


# --- The size check -------------------------------------------------------------------------


def _usd(value: Decimal) -> str:
    return f"US${value:.2f}"


def discovery_reserve_usd(slices: int, settings: Settings) -> Decimal:
    """The money discovery could hold if every slice cost its full reserve."""
    return slices * settings.slice_reserve_usd


def check_discovery_size(
    params: DiscoveryParams | LeadFinderRunParams,
    settings: Settings,
    caps: RunCaps,
    rules: LeadFinderRules | None = None,
) -> None:
    """Raises a 422 `discovery_too_large` when the slices don't fit the discovery share.

    The rule: slices x `slice_reserve_usd` must not exceed `caps.discovery_cap_usd` (the share of
    the run cap that discovery may use). Pure: no await and no database, so the run manager and
    the estimate can both call it. It is the `check` of the discovery `RunKind`.
    """
    count = len(make_slices(params, rules or load_rules()))
    reserve = settings.slice_reserve_usd
    needed = discovery_reserve_usd(count, settings)
    room = caps.discovery_cap_usd
    if needed <= room:
        return
    fit = int(room // reserve) if reserve > 0 else 0
    what = (
        f"At most {fit} fit. Choose fewer cities or triggers, or raise the run limit in Settings."
        if fit >= 1
        else "Not even one fits. Raise the run limit in Settings."
    )
    detail = (
        f"This run would make {count} discovery searches. Each can cost up to {_usd(reserve)}, "
        f"so up to {_usd(needed)} in all. Discovery may spend {_usd(room)} of the run's "
        f"{_usd(caps.run_cap_usd)} limit. {what}"
    )
    message = f"{count} searches is too many (the most that fit is {fit}). Choose fewer."
    raise Problem(
        422,
        "The run is too big",
        detail,
        code="discovery_too_large",
        errors=[
            {"field": "body.params.cities", "message": message},
            {"field": "body.params.triggers", "message": message},
        ],
    )
