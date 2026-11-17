"""Where a discovery run looks for companies: the web, Property Daily and Arealytics (PLAN-V16 T1-8,
the contract part 2).

- **The choice** (`DiscoveryParams.sources`): which of the three to use. Left out, every source
  that is ready. The web is always ready. A tool is ready when its switch is on and it has a login.
  It only says where discovery looks: the research of each company still uses every tool that is
  switched on.
- **The run options** (`source_options`): each source, on or not, ready or not, and one plain
  sentence when it isn't, for the Start page.
- **The new emails first** (`read_new_emails`, PLAN-V21 T1-5): when the run picked Property Daily,
  it is ready, and our copy's last daily email is older than today, the run's plan reads the new
  emails before it looks at the feed (about 1 page a day, free), so a run doesn't depend on the
  job that reads them, which is switched off. A failure is one line in the feed, and the run goes
  on with our copy.
- **The feed** (`feed_candidates`): the new items of each tool the run picked, from our copy (free
  and fast), for the run's cities and signs and since `since_days`. Each item that has a sign is a
  company found, like one a web slice found. An item that is only a dampener (a fitout already given
  to a firm) is never a reason to look at a company. The merge then makes a company found by a tool
  and by the web one candidate.

**Two ways to ask whether a tool is ready.** The Start page asks `live_source_options`, which reads
`core.sources.reader.source_availability` (Track 2, joined at M1): it also knows a tool paused for
24 hours after a block. The checks that must stay pure (a run's start, `picked_tools`) read the
settings alone (`tool_readiness`): a paused tool still has our copy, and the feed reads only that.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from apps.lead_finder.params import DiscoveryParams, LeadFinderRunParams, RunSource
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sanitize import clean_company_name, one_line, safe_http_url
from apps.lead_finder.schemas import SourceOption
from apps.lead_finder.scoring import city_of
from apps.lead_finder.steps.discover import WHAT_HAPPENED_MAX, Found
from apps.lead_finder.steps.plan import is_national, run_cities
from core.api.errors import Problem
from core.config import Settings
from core.sources.reader import recent_items, source_availability
from core.sources.service import availability, get_sources
from core.sources.store import last_feed_day
from core.sources.types import SOURCE_IDS, FeedItem, SourceId

log = logging.getLogger(__name__)
MELBOURNE = ZoneInfo("Australia/Melbourne")
EMAILS_NOT_READ = (
    "Property Daily's new emails couldn't be read, so the run used the ones we already have."
)

FEED_SLICE: Final = "feed:{source}"  # the slice id of a company a tool's feed found
SOURCE_WORDS: Final[dict[RunSource, str]] = {
    "web": "The web",
    "property_daily": "Property Daily",
    "arealytics": "Arealytics",
}
# Track 2's words (core/sources/service.py), so the Start page and Admin say the same
OFF_SENTENCE = "Property Daily is switched off. An Admin can switch it on."
NO_LOGIN_SENTENCE = "Property Daily has no login yet. An Admin needs to add one."
AREALYTICS_SENTENCE = "Arealytics isn't connected: it refused automated access."
SOURCE_NOT_READY = "source_not_ready"


@dataclass(frozen=True)
class Readiness:
    on: bool
    ready: bool
    sentence: str | None  # why it isn't ready, for a person. None when it is


def _from_settings(settings: Settings, tool: SourceId) -> Readiness:
    """A tool is ready when its switch is on and it has a login. Arealytics has no connector in
    PLAN-V16 (its site refused automated access, T2-2), so it is never ready."""
    if tool == "arealytics":
        return Readiness(on=settings.arealytics_enabled, ready=False, sentence=AREALYTICS_SENTENCE)
    if not settings.property_daily_enabled:
        return Readiness(on=False, ready=False, sentence=OFF_SENTENCE)
    if settings.property_daily_username is None or settings.property_daily_password is None:
        return Readiness(on=True, ready=False, sentence=NO_LOGIN_SENTENCE)
    return Readiness(on=True, ready=True, sentence=None)


def tool_readiness(settings: Settings) -> dict[RunSource, Readiness]:
    """Each source: the web is always ready, and each tool by its switch and its login."""
    found: dict[RunSource, Readiness] = {"web": Readiness(on=True, ready=True, sentence=None)}
    for tool in SOURCE_IDS:
        found[tool] = _from_settings(settings, tool)
    return found


def source_options(settings: Settings) -> dict[RunSource, SourceOption]:
    """The three sources for the Start page (`GET /lead-finder/run-options`), by id."""
    return {
        source: SourceOption(on=readiness.on, ready=readiness.ready, message=readiness.sentence)
        for source, readiness in tool_readiness(settings).items()
    }


async def live_source_options(
    session: AsyncSession, settings: Settings
) -> dict[RunSource, SourceOption]:
    """The three sources for the Start page, from Track 2's own availability: the switch, the
    login, and a pause after a block, each with its sentence."""
    found: dict[RunSource, SourceOption] = {"web": SourceOption(on=True, ready=True, message=None)}
    live = await source_availability(session, settings)
    for tool in SOURCE_IDS:
        state = live.get(tool)
        if state is None:
            fallback = _from_settings(settings, tool)
            found[tool] = SourceOption(
                on=fallback.on, ready=fallback.ready, message=fallback.sentence
            )
        else:
            found[tool] = SourceOption(on=state.on, ready=state.ready, message=state.sentence)
    return found


def picked_tools(
    params: DiscoveryParams | LeadFinderRunParams, settings: Settings
) -> list[SourceId]:
    """The tools whose feed the run reads: the ones it names, or every ready one when it names
    none. A tool it names must be ready (`check_sources`)."""
    ready = tool_readiness(settings)
    if params.sources is None:
        return [tool for tool in SOURCE_IDS if ready[tool].ready]
    return [tool for tool in SOURCE_IDS if tool in params.sources]


def check_sources(params: DiscoveryParams, settings: Settings) -> None:
    """Raises a 422 `source_not_ready` when the run names a tool that isn't ready, with the tool's
    own sentence. Pure: the run manager and the estimate both call it."""
    if params.sources is None:
        return
    ready = tool_readiness(settings)
    late = [source for source in params.sources if not ready[source].ready]
    if not late:
        return
    sentences = " ".join(ready[source].sentence or "" for source in late).strip()
    names = " and ".join(SOURCE_WORDS[source] for source in late)
    raise Problem(
        422,
        "A source isn't ready",
        f"{sentences} Untick {names}, or start the run when it is ready.",
        code=SOURCE_NOT_READY,
        errors=[{"field": "body.params.sources", "message": f"{names} isn't ready"}],
    )


# --- The feed -----------------------------------------------------------------------------------


def _date_of(item: FeedItem) -> date | None:
    """The sign's date: the lease end for a lease, else when it happened, else when the tool
    published it."""
    if item.sign_id == "lease_ending" and item.lease_end is not None:
        return item.lease_end
    return item.happened_on or item.published_on


def feed_found(
    items: Sequence[FeedItem],
    params: DiscoveryParams | LeadFinderRunParams,
    rules: LeadFinderRules,
) -> list[Found]:
    """The feed items as companies found, like a web slice's: a usable name, a sign the run looks
    for, a plain link, and a city of the run (any of our places for all of Australia). Each tool's
    items keep their order. Pure."""
    known = {item.id for item in rules.criteria.triggers.every}
    wanted = set(params.triggers) & known
    national = is_national(params, rules)
    cities = set(run_cities(params, rules))
    found: list[Found] = []
    for item in items:
        name = clean_company_name(item.company)
        sign = item.sign_id
        if name is None or sign is None or sign not in wanted or not safe_http_url(item.url):
            continue
        place = next(
            (
                metro
                for text in (item.city, item.address)
                if text and (metro := city_of(text, rules))
            ),
            None,
        )
        if place is not None and place not in cities:
            continue  # not one of the run's places
        if place is None and not national:
            continue  # a run of named places needs a place it can check
        when = _date_of(item)
        found.append(
            Found(
                name=name,
                website=None,
                city=place,
                trigger_id=sign,
                what_happened=one_line(item.summary, WHAT_HAPPENED_MAX),
                date=when.isoformat() if when else None,
                url=item.url,
                published=item.published_on.isoformat() if item.published_on else None,
                slice_id=FEED_SLICE.format(source=item.source),
            )
        )
    return found


async def read_new_emails(
    factory: async_sessionmaker[AsyncSession], settings: Settings, now: datetime
) -> str | None:
    """Reads Property Daily's new daily emails into our copy, before the run looks at its feed
    (PLAN-V21 T1-5): only when the tool is ready (on, with a login, and not paused after a block)
    and our copy's last email is older than today in Melbourne. Free: about 1 page a day. Returns
    one sentence for the run's feed when the read failed, else None. Never raises."""
    async with factory() as session:
        ready = (await availability(session, settings))["property_daily"].ready
        last = await last_feed_day(session, "property_daily")
    if not ready or (last is not None and last >= now.astimezone(MELBOURNE).date()):
        return None
    try:
        await get_sources().feed(settings)
    except Exception as error:  # a block, a login problem, no browser: our copy still works
        log.warning("run_feed_read_failed", extra={"kind": type(error).__name__})
        return EMAILS_NOT_READ
    return None


async def feed_candidates(
    session: AsyncSession,
    params: DiscoveryParams | LeadFinderRunParams,
    rules: LeadFinderRules,
    tools: Sequence[SourceId],
    now: datetime,
) -> list[Found]:
    """The companies the picked tools' feeds found for this run, from our copy only (free). An
    empty list when it picks none."""
    if not tools:
        return []
    since = now - timedelta(days=params.since_days)
    national = is_national(params, rules)
    places = [rules.criteria.cities.national] if national else run_cities(params, rules)
    items = await recent_items(session, places, since)
    return feed_found([item for item in items if item.source in tools], params, rules)
