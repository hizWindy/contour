"""What the Data tab hides (PLAN-V26 choice 17, TBC with Levi): email addresses and phone numbers,
like `j•••@northwind.com.au` and `••• 123`, wherever they are in a value, and anything that looks
like a key (`core.logs.redact`) or a passcode in a link. Pure code.

It hides when in doubt. A phone number is any run of 8 or more digits, however it is written, so a
meeting id or another long number in free text is hidden too. Dates, times, money written with
commas, years, IP addresses and UUIDs stay. A column that holds only ids (`is_plain`) keeps its
numbers.

`RISKY` is the same idea for the database, only wider: search and sort treat a value it matches as
empty, so neither can be used to guess what is hidden.

A cell is hidden first and cut afterwards, so a cut never leaves half an address showing.
"""

import json
import re
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final
from uuid import UUID

from core.data.spec import Mask
from core.logs import redact

DOTS: Final = "•••"
CELL_MAX: Final = 300  # a longer value is cut to this, with "…"

# Columns of ids and machine facts: their digits are never a phone number.
PLAIN_KEYS: Final = frozenset({"id", "ip", "user_agent", "key", "seq", "slug"})

# --- The same address, written so a page or a link hides it --------------------------------------

_AS_AT = re.compile(r"%40|&#0*64;|&#x0*40;|&commat;|\s*[\[({]\s{0,3}at\s{0,3}[\])}]\s*", re.I)
_AS_SPACE = re.compile(r"&nbsp;|&#0*160;|&#x0*a0;|%20", re.I)
_PASSCODE = re.compile(
    r"(?P<name>[?&](?:pwd|passcode|password|token|key|secret)=)[^&\s\"'<>]+", re.I
)

# --- Email addresses -----------------------------------------------------------------------------

_LOCAL = r"\w.+'&#!$%*=?^~`{|}-"
# It can start only where a run of address characters starts, and never gives any back, so a long
# run with no @ is read once.
_EMAIL = re.compile(
    rf"(?<![{_LOCAL}])(?P<first>[{_LOCAL}])[{_LOCAL}]*+[ \t]{{0,3}}+@[ \t]{{0,3}}+"
    r"(?P<domain>[\w-]{1,63}(?:\.[\w-]{1,63}){0,8}\.[^\W\d_]{2,24})"
)
_SAID_EMAIL = re.compile(
    r"(?<![\w.-])(?P<first>\w)[\w+'-]{0,40}(?:\s{1,3}dot\s{1,3}[\w+'-]{1,40}){0,4}"
    r"\s{1,3}at\s{1,3}(?P<domain>[\w-]{1,40}(?:\s{1,3}dot\s{1,3}[\w-]{1,40}){1,4})",
    re.I,
)

# --- Numbers -------------------------------------------------------------------------------------

_OCTET = r"(?:25[0-5]|2[0-4]\d|1?\d?\d)"
_BETWEEN = r"[\s()./\-\u2010-\u2015\u2212]{0,4}"  # what may sit between a phone number's digits
_KEPT = "|".join(
    (
        r"(?<![0-9a-fA-F])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}",  # a UUID
        # A day, and its time: 2028-03-31, 2026-11-04T01:00:00.123+00:00
        r"(?<!\d)(?:19|20)\d\d[-/.](?:0[1-9]|1[0-2])[-/.](?:0[1-9]|[12]\d|3[01])(?!\d)"
        r"(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:\d\d)?)?",
        r"(?<!\d)(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d\d(?!\d)",
        # Two years, like 2026-2027, with no more digits after them.
        r"(?<!\d)(?:19|20)\d\d\s?[-/\u2013]\s?(?:19|20)\d\d(?![\s()./-]*\d)",
        # Money with commas, like 12,500,000. Never in a mobile's shape (412,345,678).
        r"(?<![\d+])(?!4\d\d,\d{3},\d{3}(?!,))[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?(?!\d)",
        rf"(?<![\d.])(?:{_OCTET}\.){{3}}{_OCTET}(?!\.?\d)",  # an IP address
    )
)
_PHONE = "|".join(
    (
        # An Australian number with commas between its digits.
        r"(?<!\d)(?:\+\s?61|0[2-478])(?:[\s,.-]{0,2}\d){8}(?!\d)",
        rf"(?<!\d)[+(]?\d(?:{_BETWEEN}\d){{7,}}",  # 8 or more digits
        r"(?<!\d)13(?:[\s.-]?\d\d){2}(?!\d)",  # 13 22 33
        r"(?<![\d,])4\d\d,\d{3},\d{3}(?![\d,])",  # a mobile with commas and no 0
    )
)
_NUMBER = re.compile(rf"(?P<keep>{_KEPT})|(?P<phone>{_PHONE})")

# For Postgres (`~*`): every value `hide_contacts` would change, and some more.
RISKY: Final = (
    r"(@|%40|&#0*64;|&#x0*40;|&commat;|[[({][[:space:]]*at[[:space:]]*[])}]"
    r"|[[:space:]]dot[[:space:]]"
    r"|([0-9]([^0-9[:alpha:]]|&nbsp;|&#0*160;|&#x0*a0;|%20){0,10}){8}"
    r"|13([[:space:].-]?[0-9][0-9]){2}"
    r"|sk-|pat-|(pwd|passcode|password|token|key|secret)=)"
)


def is_plain(key: str) -> bool:
    """A column of ids or machine facts, where a long number is never a phone."""
    return key in PLAIN_KEYS or key.endswith(("_id", "_key"))


def hide_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    return f"{DOTS} {digits[-3:]}" if len(digits) >= 6 else DOTS


def _as_email(found: re.Match[str]) -> str:
    return f"{found['first']}{DOTS}@{found['domain']}"


def _as_said_email(found: re.Match[str]) -> str:
    domain = re.sub(r"\s+dot\s+", ".", found["domain"], flags=re.I)
    return f"{found['first']}{DOTS}@{domain}"


def hide_email(value: str) -> str:
    hidden, found = _EMAIL.subn(_as_email, _AS_AT.sub("@", value))
    return hidden if found else DOTS


def hide_contacts(value: str, *, numbers: bool = True) -> str:
    """The text with every email address and phone number hidden, and keys and passcodes out.
    `numbers` false is for a column of ids."""
    text = _PASSCODE.sub(lambda found: f"{found['name']}{DOTS}", redact(value))
    text = _AS_SPACE.sub(" ", _AS_AT.sub("@", text))
    text = _SAID_EMAIL.sub(_as_said_email, _EMAIL.sub(_as_email, text))
    if not numbers:
        return text
    return _NUMBER.sub(lambda found: found["keep"] or hide_phone(found["phone"]), text)


def _mask_for(key: str) -> Mask | None:
    name = key.lower()
    if "phone" in name or "mobile" in name:
        return "phone"
    return "email" if "email" in name else None


def _hidden(value: Any, mask: Mask | None, *, numbers: bool = True) -> Any:
    """`value` with what must be hidden hidden, at any depth."""
    if isinstance(value, Mapping):
        shown = {}
        for key, item in value.items():
            name = str(key)
            shown[hide_contacts(name)] = _hidden(
                item, mask or _mask_for(name), numbers=numbers and not is_plain(name)
            )
        return shown
    if isinstance(value, list | tuple):
        return [_hidden(item, mask, numbers=numbers) for item in value]
    if value is None or isinstance(value, bool):
        return value
    if mask == "phone":
        return hide_phone(str(value)) if str(value).strip() else value
    if isinstance(value, str):
        if mask == "email" and value.strip():
            return hide_email(value)
        return hide_contacts(value, numbers=numbers)
    return value


def cell(value: Any, mask: Mask | None = None, *, plain: bool = False) -> str | None:
    """One value, as the Data tab shows it. `plain`: the column holds ids (`is_plain`)."""
    if value is None:
        return None
    if mask is None:
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if isinstance(value, datetime | date):
            return value.isoformat()
        if isinstance(value, int | float | Decimal | UUID):
            return str(value)
    hidden = _hidden(value, mask, numbers=not plain)
    if isinstance(hidden, str):
        text = hidden
    else:
        text = json.dumps(hidden, ensure_ascii=False, default=str)
    return text if len(text) <= CELL_MAX else text[:CELL_MAX] + "…"
