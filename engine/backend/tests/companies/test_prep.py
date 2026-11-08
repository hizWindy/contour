"""Call prep (PLAN-V10 D2, D3, D5, E2) with a fake Claude that records every request:

- the facts pack has every fact with its source, and leaves out notes over 30 days old;
- a line with no real source is dropped, and a page counts only if the search returned it;
- a second prep within 7 days costs nothing, and Refresh makes a new one;
- the cap stops a prep;
- no company or person name goes to Claude while `hubspot_names_to_claude_ok` is off;
- no email address and no phone number is ever in a Claude request;
- a prep made with the Lead Finder's facts never reaches someone without its tick;
- the morning search ahead keeps to its cap and its skip rules.
"""

import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from apps.companies.jobs import SEARCH_AHEAD, search_ahead, start_search_ahead
from apps.companies.prep import AnswerLine, AnswerObjection, AnswerPage, PrepAnswer, PrepRunner
from apps.companies.tables import Prep
from core.api.deps import settings_dependency
from core.claude.client import Reply, Source, WebTools
from core.claude.pricing import Usage
from core.config import Settings
from core.hubspot.models import HubSpotCall, HubSpotCompany, HubSpotContact
from core.memory.models import EMBEDDING_DIM, MemoryItem
from core.schedules.jobs import JobContext, JobSkipped
from core.searches.models import SearchLog
from tests.companies.helpers import API, a_small_copy, add, company, deal, signed_in_as
from tests.core.auth_world import World
from tests.lead_finder.factories import FakeEmbedder

pytestmark = pytest.mark.integration
PREPS = f"{API}/preps"
NEWS_URL = "https://www.afr.com/abc-logistics-wins-contract"
EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")
LONG_NUMBER = re.compile(r"\d[\d\s().-]{6,}\d")


def line(text: str, *sources: str) -> AnswerLine:
    return AnswerLine(text=text, sources=list(sources))


def an_answer(**changes: Any) -> PrepAnswer:
    values: dict[str, Any] = {
        "still_there": "yes",
        "still_there_note": line("Jason is still Head of Operations.", "W1"),
        "news": [line("ABC Logistics won a A$40M contract in October.", "W1")],
        "opener": [line("Hi Jason, we spoke on 1 Oct about your Perth lease.", "F11")],
        "why_now": [
            line("The Perth lease ends within a year.", "F7"),
            line(
                "A line with no source.",
            ),
            line("A line that cites a page the search never returned.", "W9"),
        ],
        "questions": [line("Are you planning to renew or move?", "F7")],
        "if_they_say": [
            AnswerObjection(they_say="We're not ready yet.", answer=line("Fair enough.", "F7"))
        ],
        "goal": line("Book a site visit in Perth.", "F7"),
        "pages": [
            AnswerPage(
                id="W1",
                url=NEWS_URL,
                title="ABC Logistics wins contract",
                date="2026-10-20",
                summary="ABC Logistics won a A$40M freight contract with the WA government.",
            ),
            AnswerPage(
                id="W9",
                url="https://made-up.example/page",
                title="A page it never read",
                date="",
                summary="Something made up.",
            ),
        ],
    }
    values.update(changes)
    return PrepAnswer(**values)


class FakeClaude:
    """Answers each request from a list of (answer, cost, urls the search returned)."""

    def __init__(self, *replies: tuple[PrepAnswer | None, str, list[str]]) -> None:
        self.replies = list(replies)
        self.asked: list[dict[str, Any]] = []

    async def ask[T: BaseModel](
        self,
        *,
        system: str,
        prompt: str,
        form: type[T],
        web: WebTools | None = None,
        model: str | None = None,
        effort: str | None = None,
        max_continues: int | None = None,
    ) -> Reply[T]:
        self.asked.append({"system": system, "prompt": prompt, "web": web, "model": model})
        answer, cost, urls = self.replies.pop(0) if self.replies else (an_answer(), "0.08", [])
        return Reply(
            model=model or "claude-sonnet-5-5",
            stop_reason="end_turn",
            parsed=answer,  # type: ignore[arg-type]
            text="",
            sources=tuple(Source(url=url) for url in (urls if web else [])),
            queries=("abc logistics news",) if web else (),
            usage=Usage(web_searches=2 if web else 0),
            cost_usd=Decimal(cost),
            request_id=f"req-{len(self.asked)}",
        )


def prep_settings(**changes: Any) -> Settings:
    values: dict[str, Any] = {
        "prep_enabled": True,
        "hubspot_names_to_claude_ok": True,
        "auth_required": True,
    }
    values.update(changes)
    return Settings(_env_file=None, **values)


@pytest.fixture
def claude() -> FakeClaude:
    return FakeClaude()


@pytest.fixture
def runner(world: World, claude: FakeClaude) -> PrepRunner:
    made = PrepRunner(sessions=world.factory, claude=lambda: claude, embedder=FakeEmbedder)
    world.app.state.prep_runner = made
    return made


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see. A test changes them with `settings.update(...)`."""
    chosen: dict[str, Any] = {}
    world.app.dependency_overrides[settings_dependency] = lambda: prep_settings(**chosen)
    yield chosen


async def people_and_calls(world: World) -> None:
    await a_small_copy(world)
    await add(
        world,
        HubSpotContact(
            hubspot_id="c1",
            hubspot_company_id="101",
            name="Jason Reeds",
            first_name="Jason",
            last_name="Reeds",
            job_title="Head of Operations",
            phone="+61 8 9000 1234",
            email="jason.reeds@abclogistics.com.au",
        ),
        HubSpotCall(
            hubspot_id="k1",
            hubspot_company_id="101",
            hubspot_contact_id="c1",
            called_at=datetime(2026, 10, 1, 1, 0, tzinfo=UTC),
            duration_seconds=420,
            outcome="Connected",
            note=(
                "Spoke to Jason about the Perth lease. Email him at jason@abc.com.au or ring "
                "0412 345 678 after 2pm."
            ),
            owner="Levi",
        ),
    )
    async with world.factory() as db:
        row = await db.get(HubSpotCompany, "101")
        assert row is not None
        row.phone = "(08) 9000 0000"
        await db.commit()


async def ask_and_finish(client: Any, runner: PrepRunner, **body: Any) -> dict[str, Any]:
    started = await client.post(PREPS, json={"company_key": "101", **body})
    assert started.status_code in (200, 202), started.text
    await runner.wait()
    done: dict[str, Any] = (await client.get(f"{PREPS}/{started.json()['id']}")).json()
    return done


# --- D2: the facts pack ----------------------------------------------------------------------


async def test_the_facts_pack_has_every_fact_with_its_source(
    world: World, settings: dict[str, Any]
) -> None:
    await people_and_calls(world)
    now = datetime.now(UTC)
    await add(
        world,
        MemoryItem(
            app="lead_finder",
            kind="source_note",
            subject="ABC Logistics",
            content="ABC Logistics is hiring 40 people in Perth.",
            url="https://example.com/jobs",
            embedding=[0.0] * EMBEDDING_DIM,
            created_at=now - timedelta(days=2),
        ),
        MemoryItem(
            app="lead_finder",
            kind="source_note",
            subject="ABC Logistics",
            content="A note from two months ago.",
            embedding=[0.0] * EMBEDDING_DIM,
            created_at=now - timedelta(days=60),
        ),
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        pack = (await client.get(f"{API}/101/facts?contact_id=c1")).json()
    assert pack["company_name"] == "ABC Logistics"
    assert pack["person"]["name"] == "Jason Reeds"
    assert pack["phone"] == "+61 8 9000 1234"  # the person's own number, for the screen only
    assert pack["prep_enabled"] is True and pack["names_ok"] is True
    kinds = {fact["source"]["kind"] for fact in pack["facts"]}
    assert kinds == {"hubspot", "call", "memory"}  # no Lead Finder fact without its tick
    for fact in pack["facts"]:
        assert re.fullmatch(r"F\d+", fact["id"]) and fact["source"]["id"] == fact["id"]
        assert fact["source"]["label"]
    texts = " ".join(fact["text"] for fact in pack["facts"])
    assert "hiring 40 people" in texts
    assert "two months ago" not in texts  # over 30 days old
    assert "lease ends" in texts and "Head of Operations" in texts
    assert pack["last_call"]["outcome"] == "Connected"
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        with_leads = (await client.get(f"{API}/101/facts")).json()
    assert with_leads["person"] is None
    assert with_leads["phone"] == "(08) 9000 0000"  # the switchboard for a cold call
    assert "lead" in {fact["source"]["kind"] for fact in with_leads["facts"]}


# --- D3: the prep -------------------------------------------------------------------------------


async def test_a_prep_keeps_only_lines_with_a_real_source(
    world: World, settings: dict[str, Any], claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    claude.replies = [(an_answer(), "0.09", [NEWS_URL])]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        started = await client.post(PREPS, json={"company_key": "101", "contact_id": "c1"})
        assert started.status_code == 202
        assert started.json()["status"] == "searching"
        await runner.wait()
        prep = (await client.get(f"{PREPS}/{started.json()['id']}")).json()
    assert prep["status"] == "ready" and prep["stage"] == 3
    assert prep["person"]["name"] == "Jason Reeds"
    assert prep["web_checked"] is True and prep["made_by"] == "Mia"
    script = prep["script"]
    assert [item["text"] for item in script["why_now"]] == ["The Perth lease ends within a year."]
    assert script["dropped"] == 2  # no source, and a page the search never returned
    assert script["still_there"] == "yes"
    assert script["news"][0]["sources"] == ["W1"]
    web = [source for source in prep["sources"] if source["kind"] == "web"]
    assert [(source["id"], source["url"]) for source in web] == [("W1", NEWS_URL)]
    assert {source["id"] for source in prep["sources"]} >= {"W1", "F7"}
    # One request, with up to 3 searches, in the search log so the daily limit counts it.
    assert len(claude.asked) == 1
    assert claude.asked[0]["web"].max_searches == 3
    assert claude.asked[0]["model"] == "claude-sonnet-5-5"
    async with world.factory() as db:
        logged = (await db.scalars(select(SearchLog))).all()
        notes = (await db.scalars(select(MemoryItem).where(MemoryItem.app == "companies"))).all()
    assert [(row.app, row.step, row.cost_usd) for row in logged] == [
        ("companies", "prep:web", Decimal("0.090000"))
    ]
    assert [(note.url, note.subject) for note in notes] == [(NEWS_URL, "ABC Logistics")]


async def test_a_second_prep_within_7_days_costs_nothing(
    world: World, settings: dict[str, Any], claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first = await ask_and_finish(client, runner, contact_id="c1")
        again = await client.post(PREPS, json={"company_key": "101", "contact_id": "c1"})
        assert again.status_code == 200
        assert again.json()["id"] == first["id"] and again.json()["reused"] is True
        assert len(claude.asked) == 1
        fresh = await ask_and_finish(client, runner, contact_id="c1", refresh=True)
    assert fresh["id"] != first["id"]
    assert len(claude.asked) == 2
    # The web check is still fresh, so the new one is the smaller request, with no search.
    assert claude.asked[1]["web"] is None
    assert fresh["script"]["still_there"] == "not_checked"


async def test_the_cap_stops_a_prep(
    world: World, settings: dict[str, Any], claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    settings.update(prep_cap_usd=Decimal("0.10"))
    # The answer doesn't fit the form, and it already cost more than the cap: no second try.
    claude.replies = [(None, "0.12", [NEWS_URL])]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        prep = await ask_and_finish(client, runner, contact_id="c1")
    assert prep["status"] == "failed"
    assert "US$0.10 cap" in prep["error"]
    assert len(claude.asked) == 1


async def test_prep_off_says_so_and_the_facts_still_show(
    world: World, settings: dict[str, Any], runner: PrepRunner
) -> None:
    await people_and_calls(world)
    settings.update(prep_enabled=False)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        refused = await client.post(PREPS, json={"company_key": "101", "contact_id": "c1"})
        assert refused.status_code == 409 and refused.json()["code"] == "prep_off"
        pack = (await client.get(f"{API}/101/facts")).json()
    assert pack["prep_enabled"] is False and pack["facts"]


async def test_no_name_goes_to_claude_while_names_are_off(
    world: World, settings: dict[str, Any], claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    settings.update(hubspot_names_to_claude_ok=False)
    claude.replies = [
        (
            an_answer(opener=[line("Hi {person}, it's about {company}'s Perth lease.", "F7")]),
            "0.03",
            [],
        )
    ]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        prep = await ask_and_finish(client, runner, contact_id="c1")
    sent = claude.asked[0]["system"] + claude.asked[0]["prompt"]
    for name in ("ABC Logistics", "abclogistics", "Jason", "Reeds"):
        assert name.lower() not in sent.lower(), name
    assert "{company}" in sent and "{person}" in sent
    assert claude.asked[0]["web"] is None  # no names, so no web check
    # The screen shows the real names again.
    assert prep["script"]["opener"][0]["text"] == (
        "Hi Jason Reeds, it's about ABC Logistics's Perth lease."
    )
    assert prep["script"]["still_there"] == "not_checked"


async def test_no_email_or_phone_number_ever_goes_to_claude(
    world: World, settings: dict[str, Any], claude: FakeClaude, runner: PrepRunner
) -> None:
    """E2: the contact's email and number, and the ones inside a call note, never leave."""
    await people_and_calls(world)
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        await ask_and_finish(client, runner, contact_id="c1")
        await ask_and_finish(client, runner, cold=True)
    assert len(claude.asked) == 2
    for request in claude.asked:
        sent = request["system"] + request["prompt"]
        assert not EMAIL.search(sent), EMAIL.search(sent)
        for found in LONG_NUMBER.findall(sent):
            assert sum(ch.isdigit() for ch in found) < 8, found
        assert "Spoke to Jason about the Perth lease" in sent  # the note itself still goes


async def test_a_prep_with_lead_finder_facts_stays_with_its_tick(
    world: World, settings: dict[str, Any], claude: FakeClaude, runner: PrepRunner
) -> None:
    await people_and_calls(world)
    async with signed_in_as(world, "lena", ["companies", "lead_finder"]) as client:
        made = await ask_and_finish(client, runner, contact_id="c1")
    assert "Lead Finder" in claude.asked[0]["prompt"]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        assert (await client.get(f"{PREPS}/{made['id']}")).status_code == 404
        own = await ask_and_finish(client, runner, contact_id="c1")
    assert own["id"] != made["id"]  # not reused: it would show the Lead Finder's facts
    assert "Lead Finder" not in claude.asked[1]["prompt"]


async def test_my_preps_from_today_come_back_as_chips(
    world: World, settings: dict[str, Any], runner: PrepRunner
) -> None:
    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        await ask_and_finish(client, runner, contact_id="c1")
        await ask_and_finish(client, runner, cold=True)
        chips = (await client.get(f"{PREPS}/today")).json()
    assert [(chip["company_name"], chip["person_name"]) for chip in chips] == [
        ("ABC Logistics", None),
        ("ABC Logistics", "Jason Reeds"),
    ]
    async with signed_in_as(world, "sara", ["companies"]) as other:
        assert (await other.get(f"{PREPS}/today")).json() == []  # only my own


# --- D5: search ahead ---------------------------------------------------------------------------


async def test_search_ahead_keeps_to_its_cap_and_skip_rules(
    world: World, claude: FakeClaude, runner: PrepRunner
) -> None:
    await a_small_copy(world)
    # Two more companies with an open deal, so three are due: ABC Logistics, Kite and Lark.
    await add(world, company("105", "Kite Mining"), company("106", "Lark Foods"))
    await add(
        world,
        deal("d5", "105", "Lead"),
        deal("d6", "106", "Qualified Deal"),
        Prep(
            company_key="101",
            company_name="ABC Logistics",
            status="ready",
            created_at=datetime.now(UTC) - timedelta(days=2),
        ),  # prepped two days ago: skipped
    )
    claude.replies = [(an_answer(), "0.60", [NEWS_URL]), (an_answer(), "0.60", [NEWS_URL])]
    settings = prep_settings(search_ahead_cap_usd=Decimal("1"))
    morning = await search_ahead(world.app, settings)
    assert morning.skipped == 1
    assert morning.prepped == 2  # 0.60, then 0.60 more: the third would start over the cap
    assert morning.spent_usd == Decimal("1.2")
    async with world.factory() as db:
        preps = (await db.scalars(select(Prep).where(Prep.trigger == "search_ahead"))).all()
    assert {prep.company_key for prep in preps} == {"105", "106"}
    assert all(prep.made_by is None and prep.status == "ready" for prep in preps)
    claude.replies = [(an_answer(), "0.60", [NEWS_URL])]
    again = await search_ahead(world.app, settings)
    assert again.prepped == 0 and again.stopped is not None and "cap" in again.stopped


async def test_search_ahead_skips_the_weekend_and_waits_for_the_switch(world: World) -> None:
    saturday = datetime(2026, 11, 7, 20, 0, tzinfo=UTC)  # 7:00 am Sunday in Melbourne
    context = JobContext(app=world.app, schedule_id=uuid.uuid4(), settings={}, now=saturday)
    with pytest.raises(JobSkipped, match="weekend"):
        await start_search_ahead(context)
    monday = datetime(2026, 11, 8, 19, 30, tzinfo=UTC)  # 6:30 am Monday in Melbourne
    weekday = JobContext(app=world.app, schedule_id=context.schedule_id, settings={}, now=monday)
    with pytest.raises(JobSkipped, match="switched off"):
        await start_search_ahead(weekday)  # prep_enabled is off by default
    assert SEARCH_AHEAD == "companies.search_ahead"
