"""The Companies page stays fast on a copy the size of Contour's HubSpot (PLAN-V10 B2, D1).

13,913 made-up companies (the 9 Nov copy), with offices, deals and 40,000 people. A page of the
list must come back in under 300 ms and the prep box's matches in under 150 ms (both TBC). Each is
timed three times after one warm-up, and the best time counts, so a busy laptop doesn't fail it.
"""

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from core.auth import admin
from tests.core.auth_world import FAST, GOOD, World, build_world, sign_in

pytestmark = pytest.mark.integration
API = "/api/v1/companies"
COMPANIES = 13_913
PEOPLE = 40_000
LIST_MS = 300  # TBC
SEARCH_MS = 150  # TBC


@pytest.fixture
def world(session_factory: Any) -> World:
    return build_world(session_factory)


async def fill(world: World) -> None:
    async with world.factory() as db:
        await db.execute(
            text(
                """
                INSERT INTO core.hubspot_companies
                    (hubspot_id, name, domain, city, industry, employees, owner,
                     last_contacted, source)
                SELECT 'f' || g,
                       'Company ' || lpad(g::text, 5, '0'),
                       'company' || g || '.com.au',
                       (ARRAY['Melbourne', 'Perth', 'Adelaide', 'Sydney'])[1 + g % 4],
                       'Industry ' || (g % 40),
                       10 + g % 900,
                       'Owner ' || (g % 12),
                       DATE '2024-01-01' + (g % 700),
                       'api'
                FROM generate_series(1, :companies) AS g
                """
            ),
            {"companies": COMPANIES},
        )
        await db.execute(
            text(
                """
                INSERT INTO core.hubspot_offices (hubspot_company_id, label, city, lease_expiry)
                SELECT 'f' || g, 'Office ' || g, 'Perth', DATE '2026-01-01' + (g % 2000)
                FROM generate_series(1, :companies) AS g
                WHERE g % 3 <> 0
                """
            ),
            {"companies": COMPANIES},
        )
        await db.execute(
            text(
                """
                INSERT INTO core.hubspot_deals (hubspot_deal_id, hubspot_company_id, name, stage)
                SELECT 'd' || g, 'f' || g, 'Deal ' || g,
                       (ARRAY['Lead', 'Closed lost', 'Ordered - Contract Signed', 'Dissolved'])
                           [1 + g % 4]
                FROM generate_series(1, :companies, 2) AS g
                """
            ),
            {"companies": COMPANIES},
        )
        await db.execute(
            text(
                """
                INSERT INTO core.hubspot_contacts (hubspot_id, hubspot_company_id, name)
                SELECT 'p' || g, 'f' || (1 + g % :companies), 'Person ' || g
                FROM generate_series(1, :people) AS g
                """
            ),
            {"companies": COMPANIES, "people": PEOPLE},
        )
        await db.commit()
        for table in ("hubspot_companies", "hubspot_offices", "hubspot_deals", "hubspot_contacts"):
            await db.execute(text(f"ANALYZE core.{table}"))


@asynccontextmanager
async def admin_browser(world: World) -> AsyncIterator[httpx.AsyncClient]:
    async with world.factory() as db:
        await admin.create_person(
            db,
            email="lena@example.test",
            username="lena",
            name="Lena",
            role="admin",
            apps=[],
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
    async with world.browser() as client:
        assert (await sign_in(client, login="lena")).status_code == 200
        yield client


async def best_ms(client: httpx.AsyncClient, path: str) -> float:
    assert (await client.get(path)).status_code == 200, path  # the warm-up
    times = []
    for _ in range(3):
        started = time.perf_counter()
        answer = await client.get(path)
        times.append((time.perf_counter() - started) * 1000)
        assert answer.status_code == 200, path
    return min(times)


async def test_a_page_and_the_prep_box_are_fast_on_a_full_copy(world: World) -> None:
    await fill(world)
    async with admin_browser(world) as client:
        assert (await client.get(API)).json()["total"] == COMPANIES
        timings = {
            path: await best_ms(client, path)
            for path in (
                API,
                f"{API}?sort=lease",
                f"{API}?sort=last_talk&offset=5000",
                f"{API}?q=company%2012",
                f"{API}?city=Perth&deal=open",
            )
        }
        search = await best_ms(client, f"{API}/search?q=person%201234")
    print({**timings, "search": search})  # the numbers go in the plan's Log
    for path, took in timings.items():
        assert took < LIST_MS, (path, took)
    assert search < SEARCH_MS, search
