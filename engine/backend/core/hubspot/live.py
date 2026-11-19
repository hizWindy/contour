"""Finding a company in HubSpot itself by its name, and reading what is found into our copy
(PLAN-V23 T1-3 and T1-4). A project uses it when our copy has no company for the words a rep
said, and before adding a company, to show the ones like it. It never writes to HubSpot.

- **The search** is HubSpot's company search: each word said must start a word of the company's
  name (`CONTAINS_TOKEN`, with `*` after the word). The words are the name's core words (no Pty
  Ltd, Group, Australia ...), letters and digits, at most 6. When that finds nothing and there
  were two words or more, they are tried once more run together ("North Wind" may be
  Northwind). Each search is one free request, for at most 10 companies, with every field our
  copy keeps. How HubSpot splits a name into words is TBC.
- **Saving** what was read uses the sync's own code: HubSpot's pick lists for the labels (the
  caller reads them, one free request), our owners for the owners' names, then `company_rows`,
  `upsert_company_rows` and `replace_offices`. The writer's `refresh_copy` saves a company it
  wrote the same way.
"""

import re
from collections.abc import Sequence
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.hubspot.client import Filter, HubSpot, HubSpotObject, PropertyInfo
from core.hubspot.mapping import Converter, Lookups, Problems, company_rows, load_field_map
from core.hubspot.matching import core_tokens
from core.hubspot.models import HubSpotOwner
from core.hubspot.profiles import is_placeholder
from core.hubspot.service import replace_offices, upsert_company_rows

SEARCH_LIMIT: Final = 10  # the most companies one search gives
SEARCH_WORDS: Final = 6  # the most words of a name a search uses
WORD: Final = re.compile(r"[a-z0-9]{2,}")


def name_searches(text: str) -> list[list[Filter]]:
    """The searches for a name, in order: each core word starts a word of the name, then, for two
    words or more, the words run together. None for words that say nothing ("The Group")."""
    words = [word for word in core_tokens(text) if WORD.fullmatch(word)][:SEARCH_WORDS]
    if not words:
        return []
    searches = [[Filter("name", "CONTAINS_TOKEN", f"{word}*") for word in words]]
    if len(words) > 1:
        searches.append([Filter("name", "CONTAINS_TOKEN", f"{''.join(words)}*")])
    return searches


async def search_by_name(
    hubspot: HubSpot, text: str, *, limit: int = SEARCH_LIMIT
) -> list[HubSpotObject] | None:
    """HubSpot's companies with the words said in their name, at most `limit`, each read with
    every field our copy keeps. None when the words give nothing to search for. A search that
    finds something is the last."""
    searches = name_searches(text)
    if not searches:
        return None
    properties = load_field_map().company_properties()
    for filters in searches:
        page = await hubspot.search_objects(
            "companies", filters=filters, properties=properties, limit=limit
        )
        found = [record for record in page.results if not is_placeholder(record.text("name"))]
        if found:
            return found[:limit]
    return []


async def save_records(
    session: AsyncSession,
    records: Sequence[HubSpotObject],
    definitions: Sequence[PropertyInfo],
) -> list[str]:
    """Saves companies read from HubSpot into our copy, as the sync does. `definitions` are
    HubSpot's company fields (`hubspot.properties("companies")`), for the pick lists' labels.
    Commits. Returns the ids saved."""
    if not records:
        return []
    fields = load_field_map()
    owners = (await session.execute(select(HubSpotOwner.owner_id, HubSpotOwner.name))).all()
    convert = Converter(
        Lookups.build(
            owners=[(owner_id, name) for owner_id, name in owners],
            pipelines=[],
            company_fields=[item for item in definitions if item.choices],
            time_zone=None,
        ),
        Problems(),
    )
    rows = [company_rows(record, fields, convert) for record in records]
    saved = await upsert_company_rows(session, [row.company for row in rows], source="api")
    await replace_offices(
        session,
        [row.company.hubspot_id for row in rows],
        [office for row in rows for office in row.offices],
    )
    await session.commit()
    return saved
