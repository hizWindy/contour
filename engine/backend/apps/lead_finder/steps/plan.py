"""Plan a discovery run: its slices, the watchlist batches and the size check. Pure code.

A slice is one trigger in one city. A discovery run makes one Claude request for each slice
(`steps/discover.py`). The plan needs only the run's params and the rules: no settings, no
database, no Claude. So it is quick to test, and the same params always give the same slices in
the same order (cities first, in the order the person gave them, then triggers).

`check_discovery_size` is the `RunKind.check` function for the discovery mode. It refuses a run
whose slices, each held at the slice reserve, would not fit in the share of the run cap that
discovery may use (422 `discovery_too_large`).
"""

import re
import uuid
from collections.abc import Sequence
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from apps.lead_finder.params import AreaId, DiscoveryParams, LeadFinderRunParams
from apps.lead_finder.rules import LeadFinderRules, load_rules
from core.api.errors import Problem
from core.config import Settings
from core.runs.schemas import RunCaps

WATCHLIST_BATCH_SIZE = 20  # companies in one batch of the watchlist (TBC with Levi)
AREA_WORDS: dict[AreaId, str] = {"cbd": "CBD", "inner": "inner suburbs", "all": "whole city"}


class Slice(BaseModel):
    """One trigger in one city: the unit of discovery. JSON-simple, so it can sit in the graph
    state and travel as a `Send` payload (`slice.model_dump()` and `Slice.model_validate(d)`)."""

    model_config = ConfigDict(frozen=True)

    id: str  # like "melbourne:lease_ending". Once in a run, and the same on a resume.
    trigger_id: str
    city: str
    area: AreaId
    label: str  # for people, like "Melbourne (CBD): lease ending"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _label(city: str, area: AreaId, trigger_id: str) -> str:
    place = city if area == "all" else f"{city} ({AREA_WORDS[area]})"
    return f"{place}: {trigger_id.replace('_', ' ')}"


def make_slices(
    params: DiscoveryParams | LeadFinderRunParams, rules: LeadFinderRules
) -> list[Slice]:
    """Cities x triggers, city by city. `params.area` narrows a city's focus (see
    `focus_places`); a city it doesn't list is searched whole.

    The params are already checked, so a city or trigger the rules don't know is a bug in the
    caller and raises ValueError.
    """
    known_triggers = {item.id for item in rules.criteria.triggers.every}
    slices: list[Slice] = []
    for city in params.cities:
        if city not in rules.queries.areas:
            raise ValueError(f"The rules have no areas for the city {city!r}")
        area: AreaId = params.area.get(city, "all")
        for trigger_id in params.triggers:
            if trigger_id not in known_triggers:
                raise ValueError(f"The rules have no trigger {trigger_id!r}")
            slices.append(
                Slice(
                    id=f"{_slug(city)}:{trigger_id}",
                    trigger_id=trigger_id,
                    city=city,
                    area=area,
                    label=_label(city, area, trigger_id),
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
