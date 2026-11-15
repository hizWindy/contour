"""Only Contour addresses (PLAN-V17 T1-10): a pre-read goes to the Contour team, never outside.

`only_internal(addresses, domains)` splits a list of addresses into the ones allowed and the
ones refused. An address is allowed only when it is one plain address whose domain is exactly
one of `domains` (the setting `internal_email_domains`), compared in lower case.

Everything else is refused, so a near miss can't slip through:
- a look-alike: `contourinteriors.com.au.evil.com`, `evil-contourinteriors.com.au`,
  `contourinteriors.com`, or a letter from another alphabet that looks the same;
- a sub-domain: `mail.contourinteriors.com.au` (not on the list, so not ours to trust);
- anything that isn't one plain address: two @, a space, a display name, angle brackets.

A blank entry is skipped: it isn't an address, so there is nothing to name. An allowed address
comes back in lower case, each once. A refused one comes back as typed, so the page can name it.
"""

import re
from collections.abc import Iterable
from typing import NamedTuple

# The part before the @: the characters a plain address may have, with no space, quote, comma,
# angle bracket or second @. Dots may not start, end or double up.
_LOCAL = re.compile(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*")


class Checked(NamedTuple):
    """Two lists, so it also reads as (allowed, refused), the shape Track 2's stand-in had."""

    allowed: list[str]
    refused: list[str]


def only_internal(addresses: Iterable[str], domains: Iterable[str]) -> Checked:
    """The addresses whose domain is exactly one of `domains`, and the rest. Each list is read
    once, so a generator is fine."""
    ours = {domain.strip().lower() for domain in domains if domain.strip()}
    allowed: dict[str, None] = {}
    refused: dict[str, None] = {}
    for raw in addresses:
        address = raw.strip()
        if not address:
            continue
        local, at, domain = address.rpartition("@")
        if at and _LOCAL.fullmatch(local) and domain.lower() in ours:
            allowed[address.lower()] = None
        else:
            refused[address] = None
    return Checked(list(allowed), list(refused))
