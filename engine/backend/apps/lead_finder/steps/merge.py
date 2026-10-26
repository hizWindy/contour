"""Merge: the same company found more than once becomes one. Pure code.

Two companies are the same company when ANY of these holds, and "the same" carries over (if A is
B and B is C, all three are one):

1. they have the same website domain;
2. their names are the same after cleaning (`clean_name`: case, punctuation and Pty Ltd gone);
3. their names are close by the rule of the HubSpot match (`names_are_close`:
   `token_set_ratio >= match_fuzzy_min` AND the core-name guard), AND they have the same city when
   both know it. An unknown city on either side never blocks.

Every signal is kept. So "Unyte" and "Unyte Health" are one company when they share a domain, and
stay apart when nothing but a shared first word says so (the core-name guard: "Apex" is not "Apex
Plumbing"). A name that cleans to nothing never matches another name.

The result does not depend on the order the companies came in. Slices finish in any order, so
the input is sorted first, and the answer is sorted by name.
"""

from collections import Counter
from collections.abc import Iterable, Sequence

from pydantic import BaseModel, ConfigDict

from apps.lead_finder.context import Signal
from apps.lead_finder.steps.discover import Found
from apps.lead_finder.tables import company_key
from core.hubspot.matching import clean_name, names_are_close

FUZZY_MIN_DEFAULT = 90  # settings.match_fuzzy_min


class Merged(BaseModel):
    """One company, with everything discovery found about it. JSON-simple, so it can sit in the
    graph state (`merged.model_dump()` and `Merged.model_validate(d)`)."""

    model_config = ConfigDict(frozen=True)

    name: str  # the name to research: the most used, else the shortest, else the first A to Z
    key: str  # `company_key(name)`
    website: str | None  # the domain most often found
    city: str | None  # the city most often found
    names: list[str]  # every name it was found under, `name` first
    signals: list[Signal]  # every signal found, each once, in a fixed order

    @property
    def keys(self) -> list[str]:
        """The `company_key` of every name, so a lead saved under another name is still found."""
        return list(dict.fromkeys(company_key(name) for name in self.names))


def _same_city(a: str | None, b: str | None) -> bool:
    return a is None or b is None or a.casefold() == b.casefold()


class _Groups:
    """Union-find over the positions of a list."""

    def __init__(self, size: int) -> None:
        self._parent = list(range(size))

    def find(self, item: int) -> int:
        while self._parent[item] != item:
            self._parent[item] = self._parent[self._parent[item]]
            item = self._parent[item]
        return item

    def join(self, a: int, b: int) -> None:
        root_a, root_b = self.find(a), self.find(b)
        if root_a != root_b:
            self._parent[max(root_a, root_b)] = min(root_a, root_b)


def _order(found: Found) -> tuple[str, ...]:
    """A fixed order for the input, so the answer never depends on which slice finished first."""
    return (
        found.name.casefold(),
        found.name,
        found.trigger_id,
        found.url,
        found.date or "",
        found.published or "",
        found.what_happened,
        found.website or "",
        found.city or "",
        found.slice_id,
    )


def _most_common(values: Iterable[str]) -> str | None:
    """The value found most often. A tie goes to the first one A to Z."""
    counts = Counter(values)
    if not counts:
        return None
    return min(counts, key=lambda value: (-counts[value], value))


def _best_name(names: Sequence[str]) -> str:
    """The most used name; on a tie the shortest cleaned one (the plainest form, which is what
    a CRM record most likely holds), then the first A to Z."""
    counts = Counter(names)
    return min(
        counts,
        key=lambda name: (-counts[name], len(clean_name(name) or name), name.casefold(), name),
    )


def _signals(group: Sequence[Found]) -> list[Signal]:
    unique = {found.signal for found in group}  # a signal found twice, exactly, is one
    return sorted(
        unique,
        key=lambda s: (s.trigger_id, s.url, s.date or "", s.published or "", s.what_happened),
    )


def merge(candidates: Iterable[Found], fuzzy_min: int = FUZZY_MIN_DEFAULT) -> list[Merged]:
    """One `Merged` for each company, sorted by name. Pass `settings.match_fuzzy_min`."""
    items = sorted(candidates, key=_order)
    groups = _Groups(len(items))
    cleaned = [clean_name(item.name) for item in items]
    # 1 and 2: the same domain, or the same cleaned name. A name that cleans to nothing is only
    # ever "the same" as an identical name.
    first_with: dict[str, int] = {}
    for position, item in enumerate(items):
        for token in (
            f"domain:{item.website}" if item.website else None,
            f"name:{cleaned[position] or '~' + item.name.casefold()}",
        ):
            if token is None:
                continue
            if token in first_with:
                groups.join(first_with[token], position)
            else:
                first_with[token] = position
    # 3: close names with the same city. The text rule is the one the HubSpot match uses
    # (`names_are_close`). It is worked out once for each pair of distinct names, then applied to
    # every pair of companies that carry them.
    names = sorted({item.name for item in items})
    close: dict[str, set[str]] = {name: set() for name in names}
    for index, name in enumerate(names):
        for other in names[index + 1 :]:
            if names_are_close(name, other, fuzzy_min):
                close[name].add(other)
                close[other].add(name)
    for position, item in enumerate(items):
        for later in range(position + 1, len(items)):
            if (
                items[later].name in close[item.name]
                and groups.find(position) != groups.find(later)
                and _same_city(item.city, items[later].city)
            ):
                groups.join(position, later)

    members: dict[int, list[Found]] = {}
    for position, item in enumerate(items):
        members.setdefault(groups.find(position), []).append(item)
    merged: list[Merged] = []
    for group in members.values():
        name = _best_name([found.name for found in group])
        others = sorted({found.name for found in group} - {name}, key=lambda n: (n.casefold(), n))
        merged.append(
            Merged(
                name=name,
                key=company_key(name),
                website=_most_common(found.website for found in group if found.website),
                city=_most_common(found.city for found in group if found.city),
                names=[name, *others],
                signals=_signals(group),
            )
        )
    return sorted(merged, key=lambda m: (m.name.casefold(), m.name))
