"""History in Call logs (PLAN-V18 T1-7): `GET /call-notes?state=history`, and the filters `q`,
`outcome`, `since` and `until`, for any state.

- every one of my notes, in any status, the newest call first, paged with its total;
- another rep's notes never show, not even to an Admin; with sign-in off every note is open;
- `q`: each word must start a word of the company's name, the person's name, the note or the
  summary;
- `outcome`: one of HubSpot's six, or `none`;
- `since` and `until`: Melbourne days, both counted;
- the filters work for the other states too, and days the wrong way round are refused;
- a day before 1 January 2000 or after 31 December 2100 is a plain 422, not a 500 (PLAN-V18 M1);
- 2,000 notes come back in under 300 ms.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import time
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from apps.companies.tables import CallNote
from core.api.deps import settings_dependency
from tests.companies.helpers import add, person
from tests.companies.test_call_notes_api import NOTES, a_company, notes_settings
from tests.core.auth_world import World, sign_in

pytestmark = pytest.mark.integration
HISTORY_MS = 300  # TBC
LATE_ON_15 = datetime(2026, 11, 15, 12, 30, tzinfo=UTC)  # 11:30 pm on 15 Nov in Melbourne
EARLY_ON_16 = datetime(2026, 11, 15, 13, 30, tzinfo=UTC)  # 12:30 am on 16 Nov in Melbourne
BASE = datetime(2026, 11, 2, 0, 0, tzinfo=UTC)


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: call notes on, sign-in on. A test changes them."""
    chosen: dict[str, Any] = {}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@asynccontextmanager
async def browser_as(world: World, login: str) -> AsyncIterator[httpx.AsyncClient]:
    async with world.browser() as client:
        assert (await sign_in(client, login=login)).status_code == 200
        yield client


def a_note(
    made_by: uuid.UUID | None,
    called_at: datetime,
    said: str,
    *,
    status: str = "logged",
    company: tuple[str, str] = ("201", "Sample Logistics Pty Ltd"),
    person_name: str | None = None,
    summary: str = "",
    outcome: str | None = None,
) -> CallNote:
    return CallNote(
        made_by=made_by,
        company_key=company[0],
        company_name=company[1],
        person_name=person_name,
        text=said,
        source="typed",
        called_at=called_at,
        status=status,
        card={"call": {"summary": summary, "outcome": outcome}},
    )


async def listed(client: httpx.AsyncClient, **params: Any) -> dict[str, Any]:
    response = await client.get(NOTES, params={"state": "history", **params})
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


def said(page: dict[str, Any]) -> list[str]:
    """Each note's first word, which names it in these tests."""
    return [item["text"].split()[0] for item in page["items"]]


async def test_history_is_every_one_of_my_notes_newest_call_first(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    mia = (await person(world, "mia", apps=["companies"])).id
    sam = (await person(world, "sam", apps=["companies"])).id
    await person(world, "ada", apps=["companies"], role="admin")
    await add(
        world,
        a_note(mia, BASE + timedelta(days=1), "one", status="to_confirm"),
        a_note(mia, BASE + timedelta(days=3), "three", status="logged"),
        a_note(mia, BASE + timedelta(days=2), "two", status="failed"),
        a_note(mia, BASE + timedelta(days=4), "four", status="sending"),
        a_note(sam, BASE + timedelta(days=5), "sams"),
    )
    async with browser_as(world, "mia") as client:
        mine = await listed(client)
        paged = await listed(client, limit=2, offset=1)
        asked_for_everyone = await listed(client, mine="false")
    async with browser_as(world, "ada") as client:
        admin = await listed(client, mine="false")
    assert said(mine) == ["four", "three", "two", "one"]  # any status, the newest call first
    assert mine["total"] == 4
    assert (said(paged), paged["total"]) == (["three", "two"], 4)
    assert said(asked_for_everyone) == ["four", "three", "two", "one"]  # never Sam's
    assert admin["items"] == [] and admin["total"] == 0  # an Admin's history is her own too

    world.settings(auth_required=False)  # sign-in off, as on the laptop
    settings.update(auth_required=False)
    async with world.browser() as client:
        everyone = await listed(client)
    assert everyone["total"] == 5


@pytest.mark.parametrize(
    ("q", "found"),
    [
        ("sample", ["freight", "logistics", "jo", "lease"]),  # the companies' names
        ("freight", ["freight"]),
        ("jo", ["jo"]),  # the person, Jo Sample
        ("JO sam", ["jo"]),  # every word must match, in any case
        ("ends", ["lease"]),  # the note's own words
        ("floor", ["summary"]),  # the summary
        ("ease", []),  # it must start a word: "lease" doesn't count
        ("o'brien", ["quote"]),  # a mark inside a word is kept
        ("(jo)", ["jo"]),  # marks around a word are not
        ("100%", ["percent"]),
        ("$5", []),
    ],
)
async def test_the_search_looks_at_the_start_of_each_word(
    world: World, settings: dict[str, Any], q: str, found: list[str]
) -> None:
    await a_company(world)
    mia = (await person(world, "mia", apps=["companies"])).id
    northwind = ("lead:00000000-0000-0000-0000-000000000001", "Northwind")
    await add(
        world,
        a_note(
            mia, BASE + timedelta(hours=5), "freight", company=("202", "Sample Freight Pty Ltd")
        ),
        a_note(mia, BASE + timedelta(hours=4), "logistics"),
        a_note(mia, BASE + timedelta(hours=3), "jo", person_name="Jo Sample"),
        a_note(mia, BASE + timedelta(hours=2), "lease ends in June"),
        a_note(
            mia, BASE + timedelta(hours=1), "summary", company=northwind, summary="A floor plan."
        ),
        a_note(mia, BASE, "quote", company=northwind, summary="Met O'Brien."),
        a_note(
            mia, BASE - timedelta(hours=1), "percent", company=northwind, summary="Up 100% a year."
        ),
    )
    async with browser_as(world, "mia") as client:
        page = await listed(client, q=q)
    assert said(page) == found
    assert page["total"] == len(found)


async def test_the_outcome_and_the_days_filter_any_state(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    mia = (await person(world, "mia", apps=["companies"])).id
    await add(
        world,
        a_note(mia, LATE_ON_15, "late", outcome="Connected"),
        a_note(mia, EARLY_ON_16, "early", outcome="No answer"),
        a_note(mia, EARLY_ON_16 + timedelta(days=1), "none", status="to_confirm"),
        a_note(mia, EARLY_ON_16 + timedelta(days=2), "busy", status="to_confirm", outcome="Busy"),
    )
    async with browser_as(world, "mia") as client:
        connected = await listed(client, outcome="Connected")
        no_outcome = await listed(client, outcome="none")
        on_15 = await listed(client, since="2026-11-15", until="2026-11-15")
        from_16 = await listed(client, since="2026-11-16")
        until_16 = await listed(client, until="2026-11-16")
        to_confirm_busy = await listed(client, state="to_confirm", outcome="Busy")
        to_confirm_q = await listed(client, state="to_confirm", q="non")
        backwards = await client.get(
            NOTES, params={"state": "history", "since": "2026-11-16", "until": "2026-11-15"}
        )
        odd = await client.get(NOTES, params={"state": "history", "outcome": "Maybe"})
        long_q = await client.get(NOTES, params={"state": "history", "q": "x" * 201})
    assert said(connected) == ["late"]
    assert said(no_outcome) == ["none"]
    assert said(on_15) == ["late"]  # Melbourne days, not UTC ones
    assert said(from_16) == ["busy", "none", "early"]
    assert said(until_16) == ["early", "late"]
    assert said(to_confirm_busy) == ["busy"]
    assert said(to_confirm_q) == ["none"]
    assert (backwards.status_code, backwards.json()["code"]) == (422, "dates_out_of_order")
    assert backwards.json()["detail"] == "Pick a start day on or before the end day."
    assert odd.status_code == 422 and long_q.status_code == 422


@pytest.mark.parametrize(
    ("params", "fields"),
    [
        ({"since": "0001-01-01"}, ["query.since"]),  # was a 500
        ({"until": "9999-12-31"}, ["query.until"]),  # was a 500 too
        ({"since": "1999-12-31"}, ["query.since"]),  # the day before the first
        ({"until": "2101-01-01"}, ["query.until"]),  # the day after the last
        ({"since": "0001-01-01", "until": "9999-12-31"}, ["query.since", "query.until"]),
        ({"state": "to_confirm", "until": "9999-12-31"}, ["query.until"]),  # any state
    ],
)
async def test_a_day_outside_2000_to_2100_is_a_plain_422(
    world: World, settings: dict[str, Any], params: dict[str, str], fields: list[str]
) -> None:
    await person(world, "mia", apps=["companies"])
    async with browser_as(world, "mia") as client:
        response = await client.get(NOTES, params={"state": "history", **params})
    assert response.status_code == 422, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert (body["code"], body["title"], body["detail"]) == (
        "day_out_of_range",
        "That day is out of range",
        "Pick a day from 1 January 2000 to 31 December 2100.",
    )
    assert [error["field"] for error in body["errors"]] == fields


async def test_the_first_and_the_last_day_are_allowed(
    world: World, settings: dict[str, Any]
) -> None:
    await a_company(world)
    mia = (await person(world, "mia", apps=["companies"])).id
    await add(world, a_note(mia, BASE, "one"))
    async with browser_as(world, "mia") as client:
        whole = await listed(client, since="2000-01-01", until="2100-12-31")
        first = await listed(client, since="2000-01-01", until="2000-01-01")
        last = await listed(client, since="2100-12-31", until="2100-12-31")
    assert said(whole) == ["one"]
    assert first["total"] == 0 and last["total"] == 0


async def test_two_thousand_notes_come_back_fast(world: World, settings: dict[str, Any]) -> None:
    await a_company(world)
    mia = (await person(world, "mia", apps=["companies"])).id
    sam = (await person(world, "sam", apps=["companies"])).id
    async with world.factory() as db:
        for who, many in ((mia, 2_000), (sam, 1_000)):
            await db.execute(
                text(
                    """
                    INSERT INTO companies.call_notes
                        (id, made_by, company_key, company_name, person_name, text, source,
                         called_at, status, card)
                    SELECT gen_random_uuid(), :who, '201', 'Sample Logistics Pty Ltd',
                           'Jo Sample', 'Spoke about the lease, note ' || g, 'typed',
                           TIMESTAMPTZ '2026-01-01 09:00+11' + g * INTERVAL '3 hours',
                           (ARRAY['logged', 'to_confirm', 'failed'])[1 + g % 3],
                           jsonb_build_object('call', jsonb_build_object(
                               'summary', 'Wants a floor plan ' || g,
                               'outcome', (ARRAY['Connected', 'No answer'])[1 + g % 2]))
                    FROM generate_series(1, :many) AS g
                    """
                ),
                {"who": who, "many": many},
            )
        await db.commit()
        await db.execute(text("ANALYZE companies.call_notes"))
        await db.commit()
    timings: dict[str, float] = {}
    async with browser_as(world, "mia") as client:
        for params in (
            {"state": "history"},
            {"state": "history", "offset": "1500"},
            {"state": "history", "q": "lease floor"},
            {"state": "history", "outcome": "Connected", "since": "2026-03-01"},
        ):
            assert (await client.get(NOTES, params=params)).status_code == 200  # the warm-up
            took = []
            for _ in range(3):
                started = time.perf_counter()
                response = await client.get(NOTES, params=params)
                took.append((time.perf_counter() - started) * 1000)
                assert response.status_code == 200
            timings[str(params)] = min(took)
        first = (await client.get(NOTES, params={"state": "history"})).json()
    print(timings)  # the numbers go in the plan's Log
    assert first["total"] == 2_000 and len(first["items"]) == 50
    for asked, ms in timings.items():
        assert ms < HISTORY_MS, (asked, ms)
