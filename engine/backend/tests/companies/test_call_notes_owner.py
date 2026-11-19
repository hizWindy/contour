"""Who hears of a call in HubSpot (PLAN-V23 T2-2): the company's owner gets an FYI task when
someone else's call on their company lands. With a fake writer (what each send asks for), and once
with core's real writer and a fake HubSpot (what HubSpot gets):

- a call on someone else's company asks for one FYI task for its owner, worded as choice 8 says;
- none for the owner's own call, a company with no owner, an owner who left, a logged meeting, or
  with the switch off;
- only the send that carries the call asks for it, so a resend of what didn't land makes no
  second one;
- PLAN-V23 T3-2, staff with no HubSpot user: a follow-up with nobody in "For" is refused (409
  `no_hubspot_user`) and nothing is sent; their call has no owner and starts "Logged by Jo
  Sample, Designer, in Contour."; a linked account's call has no such line;
- each follow-up says whose it is (`owner_id`), so the website sends the list back as it came:
  two teammates with one name stay apart, and a change to one follow-up leaves the other's
  teammate alone;
- the Call logs tick reads the team list, to pick a follow-up's teammate; neither tick is still a
  403, and a Viewer still needs the Meetings tick.

Made-up companies and people only (Sample Logistics Pty Ltd, Mia Sample, Sam Sample).
"""

import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Any

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.note_batch import ActivityWriter, Caller, NoteSender, logged_by
from apps.companies.notes import CardCall, CardTask, NoteCard
from apps.companies.schemas import CallNoteTaskIn
from core.api.deps import settings_dependency
from core.auth import admin
from core.auth.features import Feature
from core.config import Settings
from core.hubspot.activities import FyiIn
from core.hubspot.client import HubSpot
from core.hubspot.models import HubSpotCompany, HubSpotOwner
from tests.companies.helpers import API, add
from tests.companies.test_call_notes_api import NOTES, a_company, log_call, notes_settings, set_note
from tests.companies.test_call_notes_batch import FAKE_HUBSPOT, FakeWriter, confirm, one
from tests.companies.test_today import signed_in
from tests.core.auth_world import FAST, GOOD, World, sign_in
from tests.core.hubspot_fake import FakeHubSpot as CoreHubSpot
from tests.core.test_hubspot_activities import REFUSED

pytestmark = pytest.mark.integration
SITE = "https://hq.contour.example"
TODAY = date(2026, 11, 4)  # the world's clock: 8 pm on Wednesday 4 Nov 2026, Melbourne time
LINK = f"{SITE}/companies/201"  # Sample Logistics' page: its Call history shows the call
SUMMARY = "Jo wants a floor plan for level 3."
FLOOR_PLAN = CardTask(
    id="t1", subject="Send the floor plan", due=date(2026, 11, 6), due_words="Friday", kind="email"
)


@pytest.fixture
def chosen(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes and the sender see: call notes on, writing on, the site's
    address. A test changes them."""
    values: dict[str, Any] = {"hubspot_write_enabled": True, "app_url": SITE}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**values)
    yield values


def a_sender(
    world: World, chosen: dict[str, Any], writer: ActivityWriter, hubspot: HubSpot
) -> NoteSender:
    @asynccontextmanager
    async def provide() -> AsyncIterator[HubSpot | None]:
        yield hubspot

    async def settings(session: AsyncSession) -> Settings:
        return notes_settings(**chosen)

    world.app.state.hubspot_provider = lambda: hubspot
    made = NoteSender(
        sessions=world.factory,
        hubspot=provide,
        writer=writer,
        clock=lambda: world.clock.now,
        settings=settings,
    )
    world.app.state.note_sender = made
    return made


@pytest.fixture
def fake() -> FakeWriter:
    return FakeWriter()


@pytest.fixture
def sender(world: World, fake: FakeWriter, chosen: dict[str, Any]) -> NoteSender:
    return a_sender(world, chosen, fake.writer(), FAKE_HUBSPOT)


async def owned_by(world: World, owner_id: str | None) -> None:
    """Sample Logistics Pty Ltd (201) in our copy belongs to this HubSpot owner."""
    async with world.factory() as db:
        await db.execute(
            update(HubSpotCompany)
            .where(HubSpotCompany.hubspot_id == "201")
            .values(owner_id=owner_id)
        )
        await db.commit()


async def a_copy(world: World, owner: str | None = "o2") -> None:
    """Sample Logistics Pty Ltd, owned by Sam Sample (o2). The rep Mia Sample is o1."""
    await a_company(world)
    await add(world, HubSpotOwner(owner_id="o2", name="Sam Sample"))
    await owned_by(world, owner)


def a_card(*tasks: CardTask) -> dict[str, Any]:
    return NoteCard(
        call=CardCall(summary=SUMMARY, outcome="Connected"), tasks=list(tasks)
    ).model_dump(mode="json")


async def a_call_sent(world: World, sender: NoteSender, *, owner: str | None = "o1") -> None:
    """Mia logs a call with Sample Logistics and sends it."""
    async with signed_in(world, "mia", owner=owner) as (client, _):
        note = await log_call(client)
        await set_note(world, note["id"], card=a_card())
        await confirm(client, note)
        await sender.wait()


# --- What a send asks for ---------------------------------------------------------------------


async def test_a_call_on_someone_elses_company_asks_for_one_fyi_task_for_its_owner(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_copy(world)
    await a_call_sent(world, sender)

    (request,) = fake.previews
    assert request.owner_id == "o1"  # Mia's call
    assert request.fyi == FyiIn(
        owner_id="o2",
        subject="FYI: Mia Sample logged a call with Sample Logistics Pty Ltd",
        body=f"{SUMMARY}\n\nSee the call on Sample Logistics Pty Ltd in Contour: {LINK}",
        due=TODAY,
    )


async def test_a_call_with_no_summary_quotes_how_its_note_starts(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        note = await log_call(client, text="Rang Jo on 0400 000 000 about the lease.")
        await confirm(client, note)
        await sender.wait()
    (request,) = fake.previews
    assert request.fyi is not None
    first, link = request.fyi.body.split("\n\n")
    assert first.startswith("Rang Jo on") and "0400" not in first  # never a phone number
    assert link.endswith(LINK)


@pytest.mark.parametrize(
    ("owner", "why"),
    [("o1", "the owner's own call"), (None, "no owner"), ("o9", "an owner who left HubSpot")],
)
async def test_no_fyi_task_for(
    world: World, fake: FakeWriter, sender: NoteSender, owner: str | None, why: str
) -> None:
    await a_copy(world, owner=owner)
    await add(world, HubSpotOwner(owner_id="o9", name="Old Sample", archived=True))
    await a_call_sent(world, sender)
    (request,) = fake.previews
    assert request.call is not None and request.fyi is None, why


async def test_no_fyi_task_with_the_switch_off(
    world: World, fake: FakeWriter, sender: NoteSender, chosen: dict[str, Any]
) -> None:
    chosen["notify_owner_calls"] = False
    await a_copy(world)
    await a_call_sent(world, sender)
    (request,) = fake.previews
    assert request.call is not None and request.fyi is None


async def test_no_fyi_task_for_a_logged_meeting(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        note = await log_call(client)
        await set_note(world, note["id"], source="transcript", card=a_card())
        await confirm(client, note)
        await sender.wait()
    (request,) = fake.previews
    assert (request.call, request.note is not None, request.fyi) == (None, True, None)


async def test_only_the_send_that_carries_the_call_asks_for_it(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    """The call is refused the first time, so the FYI task never went (the writer makes it once
    the call lands); the send again carries the call, and asks again."""
    await a_copy(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        note = await log_call(client)
        await set_note(world, note["id"], card=a_card())
        fake.refuse_call.add(uuid.UUID(note["id"]))
        await confirm(client, note)
        await sender.wait()
        assert (await one(client, note))["status"] == "failed"
        fake.refuse_call.clear()
        retried = await client.post(f"{NOTES}/{note['id']}/retry")
        assert retried.status_code == 202, retried.text
        await sender.wait()
        assert (await one(client, note))["status"] == "logged"
    first, second = fake.previews
    assert first.fyi is not None and second.fyi == first.fyi


# --- What HubSpot gets, with core's real writer --------------------------------------------------


async def test_the_owner_gets_one_fyi_task_and_a_resend_makes_no_second(
    world: World, chosen: dict[str, Any]
) -> None:
    """Mia's call lands, her follow-up is refused, Sam (the owner) gets one FYI task. Sending
    again carries only the follow-up: Sam gets no second one."""
    hubspot = CoreHubSpot()
    hubspot.grant_writes()
    hubspot.add_company("201", name="Sample Logistics Pty Ltd")
    hubspot.fail["create_tasks"] = [REFUSED]  # the follow-up, the first time
    sender = a_sender(world, chosen, ActivityWriter(), hubspot)
    await a_company(world)
    await add(world, HubSpotOwner(owner_id="302", name="Sam Sample"))
    await owned_by(world, "302")
    async with signed_in(world, "mia", owner="301") as (client, _):
        note = await log_call(client)
        # HubSpot's ids are digits: the made-up person c201 would be refused before sending.
        await set_note(world, note["id"], card=a_card(FLOOR_PLAN), contact_id=None)
        await confirm(client, note)
        await sender.wait()
        first = await one(client, note)
        retried = await client.post(f"{NOTES}/{note['id']}/retry")
        assert retried.status_code == 202, retried.text
        await sender.wait()
        second = await one(client, note)

    assert (first["status"], second["status"]) == ("partial", "logged")
    assert len(hubspot.call_log) == 1
    by_subject = {task.properties["hs_task_subject"] or "": task for task in hubspot.tasks.values()}
    assert sorted(by_subject) == [
        "FYI: Mia Sample logged a call with Sample Logistics Pty Ltd",
        "Send the floor plan",
    ]  # one FYI task, though the note went twice
    fyi = by_subject["FYI: Mia Sample logged a call with Sample Logistics Pty Ltd"]
    assert fyi.properties["hubspot_owner_id"] == "302"
    assert (fyi.companies, fyi.contacts, fyi.deals) == (("201",), (), ())
    assert (fyi.properties["hs_task_reminders"] or "").isdigit()
    assert by_subject["Send the floor plan"].properties["hubspot_owner_id"] == "301"


# --- Staff with no HubSpot user (PLAN-V23 T3-2) --------------------------------------------------


def test_who_logged_a_call_reads_with_the_position_when_there_is_one() -> None:
    assert logged_by(Caller("Jo Sample", "Designer")) == (
        "Logged by Jo Sample, Designer, in Contour."
    )
    assert logged_by(Caller("Jo Sample", None)) == "Logged by Jo Sample in Contour."
    assert logged_by(Caller("Jo Sample", "  ")) == "Logged by Jo Sample in Contour."


@asynccontextmanager
async def as_jo(
    world: World, *, position: str | None = "Designer"
) -> AsyncIterator[httpx.AsyncClient]:
    """Jo Sample, signed in: a designer with no HubSpot user, and the Call logs tick."""
    async with world.factory() as db:
        await admin.create_person(
            db,
            email="jo.sample@example.test",
            username="josample",
            name="Jo Sample",
            position=position,
            role="staff",
            features=["companies.call_logs"],
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
            no_hubspot_user=True,
        )
    async with world.browser() as client:
        assert (await sign_in(client, login="josample")).status_code == 200
        yield client


async def test_a_follow_up_with_nobody_in_for_is_refused_for_someone_with_no_hubspot_user(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    await a_copy(world)
    async with as_jo(world) as client:
        note = await log_call(client)
        await set_note(world, note["id"], card=a_card(FLOOR_PLAN))
        refused = await client.post(f"{NOTES}/confirm", json={"ids": [note["id"]]})
        failed = FLOOR_PLAN.model_copy(update={"state": "failed"})
        await set_note(world, note["id"], status="failed", card=a_card(failed))
        not_again = await client.post(f"{NOTES}/{note['id']}/retry")
        assert fake.previews == []  # nothing was sent, or even previewed
        for_sam = FLOOR_PLAN.model_copy(update={"owner_id": "o2"})
        await set_note(world, note["id"], status="to_confirm", card=a_card(for_sam))
        await confirm(client, note)
        await sender.wait()

    for answer in (refused, not_again):
        assert (answer.status_code, answer.json()["code"]) == (409, "no_hubspot_user")
        assert answer.json()["title"] == "A follow-up needs a teammate"
        assert answer.json()["detail"] == "Who should do this follow-up? Pick a teammate."
    (request,) = fake.previews  # once a teammate is in For, it goes
    assert [task.owner_id for task in request.tasks] == ["o2"]


def as_it_came(task: dict[str, Any]) -> dict[str, Any]:
    """A follow-up from a note's answer, sent back as the website sends it when another one on the
    card changes: every field the edit takes, as it came."""
    return {name: task[name] for name in CallNoteTaskIn.model_fields}


async def test_two_teammates_with_one_name_stay_apart_when_one_follow_up_changes(
    world: World, fake: FakeWriter, sender: NoteSender
) -> None:
    """The website sends a card's whole follow-up list back when one changes, and each follow-up
    says whose it is (`owner_id`). Jo's follow-ups for two Sam Samples stay apart, a change to
    one leaves the other's teammate alone, and the send has a teammate for each."""
    await a_copy(world)  # Sam Sample is o2
    await add(world, HubSpotOwner(owner_id="o3", name="Sam Sample"))  # a second Sam Sample
    async with as_jo(world) as client:
        note = await log_call(client)
        path = f"{NOTES}/{note['id']}"
        made = await client.patch(
            path,
            json={
                "tasks": [
                    {"subject": "Send the floor plan", "due": "2026-11-06", "owner_id": "o2"},
                    {"subject": "Book a site visit", "due": "2026-11-09", "owner_id": "o3"},
                ]
            },
        )
        assert made.status_code == 200, made.text
        sent_back = [as_it_came(task) for task in made.json()["tasks"]]
        sent_back[0]["subject"] = "Send the floor plan and the lease"
        edited = await client.patch(path, json={"tasks": sent_back})
        assert edited.status_code == 200, edited.text
        await confirm(client, note)
        await sender.wait()

    before = [(task["owner"], task["owner_id"]) for task in made.json()["tasks"]]
    assert before == [("Sam Sample", "o2"), ("Sam Sample", "o3")]
    after = [(task["id"], task["subject"], task["owner_id"]) for task in edited.json()["tasks"]]
    assert after == [
        ("t1", "Send the floor plan and the lease", "o2"),
        ("t2", "Book a site visit", "o3"),
    ]
    (request,) = fake.previews  # no 409 `no_hubspot_user`: each still has its teammate
    assert [(task.subject, task.owner_id) for task in request.tasks] == [
        ("Send the floor plan and the lease", "o2"),
        ("Book a site visit", "o3"),
    ]


async def test_the_call_logs_tick_reads_the_team_list_to_pick_a_follow_ups_teammate(
    world: World,
) -> None:
    """Choice 15: Jo's follow-up needs a teammate from the team list, and Jo starts with the Call
    logs tick only (choice 13). Nobody else gains it: neither tick is still a 403, and a Viewer,
    who can't add a follow-up, still needs the Meetings tick."""
    await a_copy(world)  # Lee Sample (o1) and Sam Sample (o2)
    async with as_jo(world) as client:
        jo = await client.get(f"{API}/team")
    others: dict[str, tuple[str, list[Feature]]] = {
        "pat": ("staff", ["companies.companies", "companies.call_prep"]),  # neither tick
        "vic": ("viewer", ["companies.call_logs"]),
        "val": ("viewer", ["companies.meetings"]),
    }
    answers: dict[str, httpx.Response] = {}
    for login, (role, features) in others.items():
        async with signed_in(world, login, owner=None, role=role, features=features) as (client, _):
            answers[login] = await client.get(f"{API}/team")

    assert jo.status_code == 200, jo.text
    assert jo.json() == [
        {"owner_id": "o1", "name": "Lee Sample", "has_account": False, "is_me": False},
        {"owner_id": "o2", "name": "Sam Sample", "has_account": False, "is_me": False},
    ]
    for login in ("pat", "vic"):  # as before
        refused = answers[login].json()
        assert (answers[login].status_code, refused["code"]) == (403, "feature_not_allowed"), login
        assert refused["detail"].startswith("You don't have access to Meetings."), login
    assert answers["val"].status_code == 200, answers["val"].text  # as before


async def test_a_call_by_someone_with_no_hubspot_user_has_no_owner_and_says_who_logged_it(
    world: World, chosen: dict[str, Any]
) -> None:
    """With core's real writer: Jo's call has no owner in HubSpot, and its text starts with who
    logged it; Sam, the company's owner, hears of it. Mia's call, linked, has no such line."""
    hubspot = CoreHubSpot()
    hubspot.grant_writes()
    hubspot.add_company("201", name="Sample Logistics Pty Ltd")
    sender = a_sender(world, chosen, ActivityWriter(), hubspot)
    await a_company(world)
    await add(world, HubSpotOwner(owner_id="302", name="Sam Sample"))
    await owned_by(world, "302")
    async with as_jo(world) as client:
        jos = await log_call(client)
        await set_note(world, jos["id"], card=a_card(), contact_id=None)
        await confirm(client, jos)
        await sender.wait()
        assert (await one(client, jos))["status"] == "logged"
    async with signed_in(world, "mia", owner="301") as (client, _):
        mias = await log_call(client)
        await set_note(world, mias["id"], card=a_card(), contact_id=None)
        await confirm(client, mias)
        await sender.wait()

    calls = {call.properties.get("hubspot_owner_id"): call for call in hubspot.call_log.values()}
    assert set(calls) == {None, "301"}  # Jo's has no owner; Mia's is hers
    jo_call, mia_call = calls[None], calls["301"]
    assert (jo_call.properties["hs_call_body"] or "").startswith(
        f"<p>Logged by Jo Sample, Designer, in Contour.</p><p>{SUMMARY}</p>"
    )
    assert "Logged by" not in (mia_call.properties["hs_call_body"] or "")
    subjects = sorted(task.properties["hs_task_subject"] or "" for task in hubspot.tasks.values())
    assert subjects == [
        "FYI: Jo Sample logged a call with Sample Logistics Pty Ltd",
        "FYI: Mia Sample logged a call with Sample Logistics Pty Ltd",
    ]


async def test_with_no_position_the_line_says_less(world: World, chosen: dict[str, Any]) -> None:
    hubspot = CoreHubSpot()
    hubspot.grant_writes()
    hubspot.add_company("201", name="Sample Logistics Pty Ltd")
    sender = a_sender(world, chosen, ActivityWriter(), hubspot)
    await a_company(world)
    async with as_jo(world, position=None) as client:
        note = await log_call(client)
        await set_note(world, note["id"], card=a_card(), contact_id=None)
        await confirm(client, note)
        await sender.wait()
    (call,) = hubspot.call_log.values()
    assert (call.properties["hs_call_body"] or "").startswith(
        "<p>Logged by Jo Sample in Contour.</p>"
    )
