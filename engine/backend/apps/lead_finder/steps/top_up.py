"""The top up of a short discovery run from the HubSpot watchlist (PLAN-V21 T1-6, choice 3).

When the sweeps are done and a run a person started still has fewer companies than its target, it
adds companies from the watchlist in its places, in the watchlist's own order (most likely first),
up to its target and its company limit. Each is researched like a HubSpot watchlist run: its name,
city and website go to Claude, so the caller adds none while `hubspot_names_to_claude_ok` is off.

It skips what a run skips (`choose.decide`, through `decide_batch`): a company with an open deal, a
lead made in the last `memory_fresh_days`, or one sent or rejected. It also skips a name the
research would refuse, so the next company takes its place. It reads the watchlist from our HubSpot
copy and asks no one: free.
"""

from collections.abc import Awaitable, Callable, Collection, Sequence
from typing import Any

from sqlalchemy import select

from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.sanitize import clean_company_name
from apps.lead_finder.steps.plan import watchlist_batches
from apps.lead_finder.steps.state import CompanyTask
from apps.lead_finder.tables import company_key
from apps.lead_finder.watchlist import load_watchlist
from core.hubspot.models import HubSpotCompany
from core.runs.types import RunContext

type DecideBatch = Callable[
    [RunContext[Any], LeadFinderRules, list[CompanyTask], str], Awaitable[list[CompanyTask]]
]


def watch_task(
    name: str, city: str | None, website: str | None, hubspot_id: str, today: str
) -> CompanyTask:
    """One watchlist company as a company to research, like a watchlist run's."""
    return CompanyTask(
        name=name,
        city=city,
        website=website,
        origin="hubspot",
        hubspot_id=hubspot_id,
        is_test=False,
        recheck=False,
        signals=[],
        today=today,
    )


async def top_up_tasks(
    ctx: RunContext[Any],
    rules: LeadFinderRules,
    need: int,
    *,
    cities: Sequence[str],
    national: bool,
    taken: Collection[str],
    today: str,
    decide_batch: DecideBatch,
) -> list[CompanyTask]:
    """Up to `need` watchlist companies in the run's places (`cities`; every place for all of
    Australia), most likely first, that aren't `taken` (the companies the run already chose, by
    `company_key`) and that `decide_batch` keeps. The watchlist is checked in batches of 20, so a
    long one costs only the reads it needs."""
    if need <= 0:
        return []
    places = set(cities)
    async with ctx.session() as session:
        found = await load_watchlist(session, rules, include_unlikely=True, include_director=False)
        # A name the research would refuse (like "Acme + Co") can't take a place: the next one does
        items = [
            item
            for item in found.items
            if (national or item.city in places)
            and company_key(item.name) not in taken
            and clean_company_name(item.name) is not None
        ]
        ids = [item.hubspot_id for item in items]
        domains = dict(
            (
                await session.execute(
                    select(HubSpotCompany.hubspot_id, HubSpotCompany.domain).where(
                        HubSpotCompany.hubspot_id.in_(ids)
                    )
                )
            ).all()
        )
    added: list[CompanyTask] = []
    seen = set(taken)
    for batch in watchlist_batches(items):
        tasks = []
        for item in batch:
            key = company_key(item.name)
            if key in seen:
                continue
            seen.add(key)
            tasks.append(
                watch_task(
                    item.name, item.city, domains.get(item.hubspot_id), item.hubspot_id, today
                )
            )
        if not tasks:
            continue
        for task in await decide_batch(ctx, rules, tasks, today):
            added.append(task)
            if len(added) >= need:
                return added
    return added
