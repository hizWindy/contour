"""Learned names through their routes (PLAN-V23 T1-2, the contract's part 2):

- a pair is saved once, for the whole team, with who taught it;
- the same words for two companies keep both, and a sixth company isn't kept;
- words that are the company's own name, case and spaces aside, teach nothing and aren't kept;
- an Admin lists and removes a pair; a Viewer can't save one, staff can't list or remove, and
  nobody signed in gets 401;
- an email address or a phone number in the words is refused, and so is a company that isn't
  open to this person.

Made-up companies and people only: "North Wind" taught as Northwind.
"""

from typing import Any

import httpx
import pytest

from apps.companies.tables import LearnedName
from tests.companies.helpers import API, add, company
from tests.companies.test_assistant_api import rep
from tests.core.auth_world import World, all_rows

pytestmark = pytest.mark.integration
LEARNED = f"{API}/assistant/learned"


async def a_copy(world: World) -> None:
    await add(
        world,
        company("301", "Northwind Pty Ltd", city="Perth"),
        company("302", "Northwind Freight Australia", city="Melbourne"),
        company("303", "Sample Logistics Pty Ltd"),
    )


async def teach(
    client: httpx.AsyncClient, heard: str, company_key: str, *, status: int = 204
) -> httpx.Response:
    response = await client.post(LEARNED, json={"heard": heard, "company_key": company_key})
    assert response.status_code == status, response.text
    return response


async def pairs(world: World) -> list[tuple[str, str, str]]:
    rows: list[LearnedName] = await all_rows(world, LearnedName)
    return sorted((row.heard, row.heard_key, row.company_key) for row in rows)


async def test_a_pair_is_saved_once_with_who_taught_it(world: World) -> None:
    await a_copy(world)
    async with rep(world) as mia:
        await teach(mia, "North Wind", "301")
        await teach(mia, "  north   WIND ", "301")  # the same words, case and spaces aside
    async with rep(world, "lee") as lee:
        await teach(lee, "North Wind", "301")  # someone else: still one pair, the first kept
    assert await pairs(world) == [("North Wind", "north wind", "301")]
    async with rep(world, "boss", role="admin") as boss:
        listed = await boss.get(LEARNED)
    assert listed.status_code == 200, listed.text
    [item] = listed.json()["items"]
    assert listed.json()["total"] == 1
    assert (item["heard"], item["company_key"], item["company_name"], item["taught_by"]) == (
        "North Wind",
        "301",
        "Northwind Pty Ltd",
        "Mia Sample",
    )


async def test_the_same_words_for_two_companies_keep_both_and_a_sixth_is_not_kept(
    world: World,
) -> None:
    await a_copy(world)
    await add(world, *(company(str(310 + n), f"Sample Number {n}") for n in range(4)))
    async with rep(world) as mia:
        await teach(mia, "North Wind", "301")
        await teach(mia, "North Wind", "302")
        for n in range(3):
            await teach(mia, "North Wind", str(310 + n))  # five companies for these words
        await teach(mia, "North Wind", "313")  # a sixth: not kept
    kept = [key for _, _, key in await pairs(world)]
    assert sorted(kept) == ["301", "302", "310", "311", "312"]


async def test_the_company_s_own_name_teaches_nothing(world: World) -> None:
    await a_copy(world)
    async with rep(world) as mia:
        await teach(mia, "northwind pty ltd", "301")  # its name, in another case
        await teach(mia, " Northwind  Pty Ltd ", "301")  # its name, other spaces
        await teach(mia, "Northwind", "301")  # not its whole name: kept
    assert await pairs(world) == [("Northwind", "northwind", "301")]


async def test_an_admin_lists_and_removes_a_pair(world: World) -> None:
    await a_copy(world)
    async with rep(world) as mia:
        await teach(mia, "North Wind", "301")
        await teach(mia, "Sample Logistic", "303")
    async with rep(world, "boss", role="admin") as boss:
        listed = (await boss.get(LEARNED, params={"limit": 1})).json()
        assert listed["total"] == 2 and len(listed["items"]) == 1
        newest = listed["items"][0]
        assert newest["heard"] == "Sample Logistic"  # the newest first
        gone = await boss.delete(f"{LEARNED}/{newest['id']}")
        again = await boss.delete(f"{LEARNED}/{newest['id']}")
    assert gone.status_code == 204, gone.text
    assert again.status_code == 404
    assert (again.json()["code"], again.json()["detail"]) == (
        "learned_not_found",
        "It may have been removed already. Reload the list.",
    )
    assert await pairs(world) == [("North Wind", "north wind", "301")]


async def test_who_may_teach_list_and_remove(world: World) -> None:
    await a_copy(world)
    async with rep(world, "vic", role="viewer") as viewer:
        refused = await viewer.post(LEARNED, json={"heard": "North Wind", "company_key": "301"})
    async with rep(world, "cora", features=["companies.companies"]) as no_tick:
        no_feature = await no_tick.post(LEARNED, json={"heard": "North Wind", "company_key": "301"})
    async with rep(world) as staff:
        await teach(staff, "North Wind", "301")
        listed = await staff.get(LEARNED)
        [row] = await all_rows(world, LearnedName)
        removed = await staff.delete(f"{LEARNED}/{row.id}")
    async with world.browser() as nobody:
        signed_out = await nobody.get(LEARNED)
    assert (refused.status_code, refused.json()["code"]) == (403, "viewer_read_only")
    assert (no_feature.status_code, no_feature.json()["code"]) == (403, "feature_not_allowed")
    for response in (listed, removed):
        assert (response.status_code, response.json()["code"]) == (403, "admin_only")
    assert (signed_out.status_code, signed_out.json()["code"]) == (401, "auth_required")
    assert len(await pairs(world)) == 1


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        ({"heard": "Jo on 0412 345 678", "company_key": "301"}, 422, "contact_details"),
        ({"heard": "jo@sample.example", "company_key": "301"}, 422, "contact_details"),
        ({"heard": "North Wind", "company_key": "999"}, 404, "company_not_found"),
        ({"heard": "North Wind", "company_key": "lead:not-a-lead"}, 404, "company_not_found"),
        ({"heard": "", "company_key": "301"}, 422, None),
        ({"heard": "x" * 81, "company_key": "301"}, 422, None),
        ({"heard": "North Wind", "company_key": "301", "more": 1}, 422, None),
    ],
)
async def test_the_checks_before_a_pair_is_kept(
    world: World, body: dict[str, Any], status: int, code: str | None
) -> None:
    await a_copy(world)
    async with rep(world) as mia:
        response = await mia.post(LEARNED, json=body)
    assert response.status_code == status, response.text
    if code is not None:
        assert response.json()["code"] == code
    assert await pairs(world) == []


async def test_words_that_say_nothing_teach_nothing(world: World) -> None:
    await a_copy(world)
    async with rep(world) as mia:
        await teach(mia, "   ", "301")  # nothing left once tidied
        await teach(mia, "'s", "301")
    assert await pairs(world) == []
