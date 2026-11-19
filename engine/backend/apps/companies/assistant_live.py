"""HubSpot itself, when our copy has no company for the words a rep said (PLAN-V23 T1-3, choice
5), and the companies like a new one before it is added (T1-4): one free search of HubSpot's
companies by name (core's `live.search_by_name`), ranked by code, and what it finds read into our
copy at once (`live.save_records`), so the card can use it. Nothing is written to HubSpot.

- **Not searched** (the caller answers as before, with nothing to add): HubSpot isn't connected,
  it didn't answer within 8 seconds (TBC), or the words give nothing to search for.
- **Ranked:** a name that is the words exactly (or the words run together, "North Wind" for
  Northwind) is the only one when there is one; else the closest names first (the close-name
  score), then the shortest. At most 5.
- No database connection is held while HubSpot answers. Log lines hold counts only, never the
  words.
"""

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.client import HubSpotError, HubSpotObject, PropertyInfo
from core.hubspot.connection import hubspot_set_up, open_hubspot
from core.hubspot.live import save_records, search_by_name
from core.hubspot.matching import clean_name, close_name_score

log = logging.getLogger(__name__)

LIVE_SECONDS: Final = 8.0  # the longest wait for HubSpot's search and its pick lists (TBC)
MOST: Final = 5  # the most companies kept: a card's choices


@dataclass(frozen=True)
class LiveFound:
    """What HubSpot's own search gave: whether HubSpot was searched (it answered), the companies
    found, best first, now in our copy, and whether HubSpot was asked but didn't answer."""

    searched: bool
    keys: tuple[str, ...] = ()
    failed: bool = False


NOT_SEARCHED: Final = LiveFound(searched=False)
FAILED: Final = LiveFound(searched=False, failed=True)


def ranked(
    records: Sequence[HubSpotObject], words: str, fuzzy_min: int, most: int = MOST
) -> list[HubSpotObject]:
    """The best first: the one whose name is the words (or the words run together), else the
    closest names, then the shortest. At most `most`."""
    joined = "".join(words.split())
    wanted = {clean_name(words), clean_name(joined)}

    def name_of(record: HubSpotObject) -> str:
        return record.text("name") or ""

    exact = [record for record in records if clean_name(name_of(record)) in wanted]
    if len(exact) == 1:
        return exact

    def order(record: HubSpotObject) -> tuple[bool, int, int, str]:
        name = name_of(record)
        score = max(
            close_name_score(words, name, fuzzy_min) or 0,
            close_name_score(joined, name, fuzzy_min) or 0,
        )
        return (clean_name(name) not in wanted, -score, len(name), record.id.zfill(32))

    return sorted(records, key=order)[:most]


async def live_search(
    session: AsyncSession, app: FastAPI, words: str, *, fuzzy_min: int, most: int = MOST
) -> LiveFound:
    """HubSpot's companies for the words, best first, read into our copy. `NOT_SEARCHED` when
    HubSpot isn't connected or the words give nothing to search for, `FAILED` when it didn't
    answer. The caller's transaction ends first: it only read."""
    if not hubspot_set_up(app):
        return NOT_SEARCHED
    if session.in_transaction():
        await session.rollback()  # no connection waits on HubSpot
    best: list[HubSpotObject] = []
    definitions: list[PropertyInfo] = []
    try:
        async with asyncio.timeout(LIVE_SECONDS), open_hubspot(app) as hubspot:
            if hubspot is None:
                return NOT_SEARCHED
            found = await search_by_name(hubspot, words)
            if found is None:
                return NOT_SEARCHED
            best = ranked(found, words, fuzzy_min, most)
            if best:
                definitions = await hubspot.properties("companies")
    except (HubSpotError, TimeoutError) as error:
        log.warning("assistant_live_search_failed", extra={"error": type(error).__name__})
        return FAILED
    try:
        saved = set(await save_records(session, best, definitions))
    except SQLAlchemyError as error:
        await session.rollback()
        log.warning("assistant_live_search_not_saved", extra={"error": type(error).__name__})
        return FAILED
    log.info("assistant_live_search", extra={"found": len(best)})
    return LiveFound(searched=True, keys=tuple(r.id for r in best if r.id in saved))
