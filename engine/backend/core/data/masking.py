"""What the Data tab hides (PLAN-V26 choice 17, TBC with Levi): email addresses and phone numbers,
like `j•••@northwind.com.au` and `••• 123`, wherever they are in a value, and anything that looks
like a key (`core.logs.redact`). Pure code.

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

_EMAIL = re.compile(
    r"(?P<first>[\w.+'-])[\w.+'-]{0,63}@(?P<domain>[\w-]{1,63}(?:\.[\w-]{1,63}){1,10})"
)
# A date and an id are matched first and kept, so neither is read as a phone number. Then an
# Australian number (+61 or 0, 1300 and 1800, or 8 digits that start 6 to 9), or a foreign one
# that starts with +.
_NUMBER = re.compile(
    r"(?P<keep>\d{4}[-/.]\d{2}[-/.]\d{2}|(?<!\d)\d{1,2}[-/.]\d{1,2}[-/.]\d{4}(?!\d)"
    r"|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"|(?<![\w+])(?P<phone>"
    r"\+\s?61[\s()./-]*(?:0[\s()./-]*)?[2-478](?:[\s()./-]*\d){8}"
    r"|\(?0[2-478]\)?(?:[\s()./-]*\d){8}"
    r"|1[38]00(?:[\s.-]?\d){6}"
    r"|\+(?!\s?61)\d(?:[\s()./-]*\d){7,13}"
    r"|[6-9]\d{3}[\s-]\d{4}"
    r")(?!\w)"
)


def hide_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    return f"{DOTS} {digits[-3:]}" if len(digits) >= 6 else DOTS


def hide_email(value: str) -> str:
    hidden, found = _EMAIL.subn(lambda m: f"{m['first']}{DOTS}@{m['domain']}", value)
    return hidden if found else DOTS


def hide_contacts(value: str) -> str:
    """The text with every email address and phone number hidden, and keys taken out."""
    text = _EMAIL.sub(lambda m: f"{m['first']}{DOTS}@{m['domain']}", redact(value))
    return _NUMBER.sub(lambda m: m["keep"] or hide_phone(m["phone"]), text)


def _mask_for(key: str) -> Mask | None:
    name = key.lower()
    if "phone" in name or "mobile" in name:
        return "phone"
    return "email" if "email" in name else None


def _hidden(value: Any, mask: Mask | None) -> Any:
    """`value` with what must be hidden hidden, at any depth."""
    if isinstance(value, Mapping):
        return {str(key): _hidden(item, mask or _mask_for(str(key))) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_hidden(item, mask) for item in value]
    if value is None or isinstance(value, bool):
        return value
    if mask == "phone":
        return hide_phone(str(value)) if str(value).strip() else value
    if isinstance(value, str):
        if mask == "email" and value.strip():
            return hide_email(value)
        return hide_contacts(value)
    return value


def cell(value: Any, mask: Mask | None = None) -> str | None:
    """One value, as the Data tab shows it."""
    if value is None:
        return None
    if mask is None:
        if isinstance(value, bool):
            return "Yes" if value else "No"
        if isinstance(value, datetime | date):
            return value.isoformat()
        if isinstance(value, int | float | Decimal | UUID):
            return str(value)
    hidden = _hidden(value, mask)
    text = hidden if isinstance(hidden, str) else json.dumps(hidden, ensure_ascii=False)
    return text if len(text) <= CELL_MAX else text[:CELL_MAX] + "…"
