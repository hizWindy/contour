"""Where a lead is on the map. Every coordinate here is APPROXIMATE.

The engine never asks a map service. A lead's place is the centre of its suburb (from the table
below), or the centre of its city if the suburb isn't known, plus a small stable shift taken
from the lead's id, so leads in the same place don't sit exactly on top of each other. A pin
is good for "which part of the city", not for "which building", and the website says so.

The numbers are public geographic facts, rounded to about 100 metres. Each suburb is the
middle of the area as people use the name. `St Kilda Road` is the middle of that stretch.
The suburbs are the ones in rules/queries.yaml `areas`; a test checks that none is missing.
"""

import hashlib
import re
import uuid

Point = tuple[float, float]  # (latitude, longitude)

CITY_CENTRES: dict[str, Point] = {
    "Melbourne": (-37.8136, 144.9631),
    "Adelaide": (-34.9285, 138.6007),
    "Perth": (-31.9505, 115.8605),
    "Sydney": (-33.8688, 151.2093),
    # All of Australia (PLAN-V16 T1-2): the other places in criteria.yaml `cities`
    "Brisbane": (-27.4698, 153.0251),
    "Canberra": (-35.2809, 149.1300),
    "Hobart": (-42.8821, 147.3272),
    "Darwin": (-12.4634, 130.8456),
    "Gold Coast": (-27.9680, 153.4130),  # Southport, the business centre
    "Newcastle": (-32.9283, 151.7817),
    "Sunshine Coast": (-26.6590, 153.0900),  # Maroochydore
    "Wollongong": (-34.4278, 150.8931),
    "Geelong": (-38.1499, 144.3617),
    "Townsville": (-19.2590, 146.8169),
    "Cairns": (-16.9186, 145.7781),
    "Toowoomba": (-27.5598, 151.9507),
    "Ballarat": (-37.5622, 143.8503),
    "Bendigo": (-36.7570, 144.2794),
    "Launceston": (-41.4332, 147.1441),
    "Mackay": (-21.1411, 149.1861),
}

# The middle of the country, for the "All of Australia" choice on the Start page. It is not a place
# a lead can be in, so it is not in CITY_CENTRES.
NATIONAL_CENTRE: Point = (-25.2744, 133.7751)

SUBURB_CENTRES: dict[str, dict[str, Point]] = {
    "Melbourne": {
        "Melbourne CBD": (-37.8136, 144.9631),
        "Docklands": (-37.8166, 144.9460),
        "Southbank": (-37.8250, 144.9650),
        "St Kilda Road": (-37.8350, 144.9770),
        "Richmond": (-37.8230, 144.9980),
        "Cremorne": (-37.8300, 144.9930),
        "Collingwood": (-37.8040, 144.9880),
        "South Melbourne": (-37.8330, 144.9560),
    },
    "Adelaide": {
        "Adelaide CBD": (-34.9285, 138.6007),
        "North Adelaide": (-34.9060, 138.5940),
        "Kent Town": (-34.9195, 138.6150),
        "Keswick": (-34.9440, 138.5780),
        "Mile End": (-34.9230, 138.5760),
    },
    "Perth": {
        "Perth CBD": (-31.9505, 115.8605),
        "West Perth": (-31.9460, 115.8420),
        "East Perth": (-31.9560, 115.8730),
        "Subiaco": (-31.9480, 115.8250),
        "Northbridge": (-31.9460, 115.8560),
    },
    "Sydney": {
        "Sydney CBD": (-33.8688, 151.2093),
        "North Sydney": (-33.8390, 151.2070),
        "Barangaroo": (-33.8610, 151.2020),
        "Pyrmont": (-33.8700, 151.1950),
        "Surry Hills": (-33.8830, 151.2110),
    },
    "Brisbane": {
        "Brisbane CBD": (-27.4698, 153.0251),
        "Fortitude Valley": (-27.4575, 153.0360),
        "South Brisbane": (-27.4810, 153.0170),
        "Milton": (-27.4690, 153.0050),
    },
    "Canberra": {"Canberra CBD": (-35.2809, 149.1300)},
    "Hobart": {"Hobart CBD": (-42.8821, 147.3272)},
    "Darwin": {"Darwin CBD": (-12.4634, 130.8456)},
    "Gold Coast": {
        "Southport": (-27.9680, 153.4130),
        "Surfers Paradise": (-28.0023, 153.4300),
    },
    "Newcastle": {"Newcastle CBD": (-32.9283, 151.7817)},
    "Sunshine Coast": {"Maroochydore": (-26.6590, 153.0900)},
    "Wollongong": {"Wollongong CBD": (-34.4278, 150.8931)},
    "Geelong": {"Geelong CBD": (-38.1499, 144.3617)},
    "Townsville": {"Townsville CBD": (-19.2590, 146.8169)},
    "Cairns": {"Cairns CBD": (-16.9186, 145.7781)},
    "Toowoomba": {"Toowoomba CBD": (-27.5598, 151.9507)},
    "Ballarat": {"Ballarat CBD": (-37.5622, 143.8503)},
    "Bendigo": {"Bendigo CBD": (-36.7570, 144.2794)},
    "Launceston": {"Launceston CBD": (-41.4332, 147.1441)},
    "Mackay": {"Mackay CBD": (-21.1411, 149.1861)},
}

# The shift, in degrees: about 220 m at a suburb, about 1.1 km when only the city is known.
SUBURB_JITTER = 0.002
CITY_JITTER = 0.010


def _fold(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def jitter(key: str | uuid.UUID, spread: float) -> Point:
    """A stable shift in latitude and longitude, each within +/- `spread` degrees.

    The same key always gives the same shift, on every run and every machine.
    """
    digest = hashlib.sha256(str(key).encode("utf-8")).digest()
    lat = int.from_bytes(digest[0:4], "big") / 2**32  # 0 up to (not including) 1
    lng = int.from_bytes(digest[4:8], "big") / 2**32
    return ((lat * 2 - 1) * spread, (lng * 2 - 1) * spread)


def find_suburb(city: str, suburb: str | None) -> Point | None:
    """The centre of a known suburb of `city`, or None.

    The text can be longer than the name ("Docklands VIC", "Collins St, Southbank"): a known
    suburb name inside it is found, longest name first, as whole words.
    """
    if not suburb:
        return None
    known = SUBURB_CENTRES.get(city, {})
    text = _fold(suburb)
    folded = {_fold(name): point for name, point in known.items()}
    if text in folded:
        return folded[text]
    for name in sorted(folded, key=len, reverse=True):
        if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text):
            return folded[name]
    return None


def approximate_point(city: str | None, suburb: str | None, key: str | uuid.UUID) -> Point | None:
    """Where to pin a lead: (latitude, longitude), approximate. None if its city isn't known.

    `key` is the lead's id, so the shift is the same every time.
    """
    if city is None:
        return None
    centre = CITY_CENTRES.get(city)
    if centre is None:
        return None
    suburb_centre = find_suburb(city, suburb)
    base, spread = (suburb_centre, SUBURB_JITTER) if suburb_centre else (centre, CITY_JITTER)
    shift_lat, shift_lng = jitter(key, spread)
    return (round(base[0] + shift_lat, 5), round(base[1] + shift_lng, 5))
