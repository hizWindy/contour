"""Only Contour's own addresses get a pre-read (PLAN-V17 T2-14, choice 10).

Until M5: replaced by core.email.internal.only_internal (Track 1's T1-10), which has the same
signature and the same rules. At the join, the one import in meeting_send.py changes, and this
file goes.
"""

from collections.abc import Iterable

from core.email.sender import is_address


def only_internal(addresses: Iterable[str], domains: Iterable[str]) -> tuple[list[str], list[str]]:
    """The addresses on one of `domains` (allowed: in lower case, each once), and the rest
    (refused: as given, without the spaces around them).

    The domain must match exactly, so "jo@contourinteriors.com.au.evil.com" and a sub-domain like
    "jo@mail.contourinteriors.com.au" are refused. Upper case is fine. Something that isn't an
    address is refused. An empty list allows nothing, so nothing is sent.
    """
    ours = {domain.strip().lower() for domain in domains if domain.strip()}
    allowed: list[str] = []
    refused: list[str] = []
    for given in addresses:
        address = given.strip()
        if not address:
            continue
        _, at, domain = address.lower().rpartition("@")
        if at and is_address(address) and domain in ours:
            if address.lower() not in allowed:
                allowed.append(address.lower())
        elif address not in refused:
            refused.append(address)
    return allowed, refused
