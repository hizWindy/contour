"""The team email (PLAN-V22 T1-5), through its routes, with a log sender in place of the email
service (nothing leaves this computer):

- an email to a teammate and a typed address goes once, with every value escaped, a link to the
  company, "Sent by {name} from Contour HQ", and replies to the rep's own Contour address;
- a repeated key sends once; an outside address refuses the whole send and names it; a teammate
  with no account (or no Contour address) can't be picked, with why; no sender set up gives 409;
  30 a day a person holds, and a send that failed doesn't count;
- the checks before an email, a Viewer and nobody signed in.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import update

from apps.companies.team_email import NOT_SET_UP, TeamEmailBook
from core.api.deps import settings_dependency
from core.auth import admin
from core.auth.models import User
from core.email.sender import Email, EmailError, LogSender, Sent
from core.hubspot.models import HubSpotOwner
from tests.companies.helpers import API, add, company
from tests.companies.test_assistant_api import COMPANIES, account
from tests.companies.test_call_notes_api import notes_settings
from tests.companies.test_today import signed_in
from tests.core.auth_world import FAST, GOOD, World, sign_in

pytestmark = pytest.mark.integration
EMAIL = f"{API}/assistant/email"
PREVIEW = f"{API}/assistant/email/preview"
# START is 8 pm on Wednesday 4 Nov 2026 in Melbourne: 4 hours to midnight.


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """Contour's addresses are example.test here. A test changes the settings."""
    chosen: dict[str, Any] = {
        "meeting_forms_enabled": True,
        "internal_email_domains": ["example.test"],
    }
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def sender(world: World) -> LogSender:
    made = LogSender()
    world.app.state.email_sender = made
    return made


class Breaks(LogSender):
    """A sender that fails the first email, then sends."""

    def __init__(self) -> None:
        super().__init__()
        self.tries = 0

    async def deliver(self, email: Email, key: str) -> Sent:
        self.tries += 1
        if self.tries == 1:
            raise EmailError("The email service took too long", "It didn't answer in time.")
        return await super().deliver(email, key)


async def outside_account(world: World, login: str, name: str, owner: str | None = None) -> User:
    """An account whose own address isn't a Contour one."""
    async with world.factory() as db:
        user = await admin.create_person(
            db,
            email=f"{login}@elsewhere.example",
            username=login,
            name=name,
            role="staff",
            features=COMPANIES,
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
        if owner is not None:
            await db.execute(
                update(User)
                .where(User.id == user.id)
                .values(hubspot_owner_id=owner, hubspot_owner_matched_by="person")
            )
            await db.commit()
    return user


async def a_team(world: World) -> None:
    """Mia (o1, signs in), Lee Sample (o2, an account), Lee Other (o3, no account), Jo Teammate
    (o4, an account with an outside address) and Old Sample (o9, left HubSpot)."""
    await add(
        world,
        company("201", "Sample Logistics Pty Ltd"),
        HubSpotOwner(owner_id="o1", name="Mia Sample"),
        HubSpotOwner(owner_id="o2", name="Lee Sample"),
        HubSpotOwner(owner_id="o3", name="Lee Other"),
        HubSpotOwner(owner_id="o4", name="Jo Teammate"),
        HubSpotOwner(owner_id="o9", name="Old Sample", archived=True),
    )
    await account(world, "lee", owner="o2")
    await outside_account(world, "joteam", "Jo Teammate", owner="o4")


def an_email(**more: Any) -> dict[str, Any]:
    return {
        "owner_ids": ["o2"],
        "emails": ["Sam@Example.test"],
        "subject": "The Sample Logistics floor plan",
        "body": "Hi Lee,\n\nThe plan is <ready>. Ring jo@client.example.\n\nThanks",
        "company_key": "201",
        **more,
    }


async def post(
    client: httpx.AsyncClient, body: dict[str, Any], key: str = "card-1"
) -> httpx.Response:
    return await client.post(EMAIL, json=body, headers={"Idempotency-Key": key})


# --- Sending --------------------------------------------------------------------------------------


async def test_an_email_goes_once_escaped_signed_and_replies_to_the_rep(
    world: World, settings: dict[str, Any], sender: LogSender
) -> None:
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        sent = await post(client, an_email())
    assert sent.status_code == 201, sent.text
    found = sent.json()
    assert found["people"] == [
        {"owner_id": "o2", "name": "Lee Sample", "address": "lee@example.test"},
        {"owner_id": None, "name": None, "address": "sam@example.test"},
    ]
    assert found["company"] == {"key": "201", "name": "Sample Logistics Pty Ltd"}
    assert (found["reply_to_me"], found["can_send"], found["sends_left"]) == (True, True, 29)
    assert found["sent_at"] == "2026-11-04T09:00:00Z"
    [email] = sender.sent
    assert email.to == ["lee@example.test", "sam@example.test"]
    assert email.reply_to == "mia@example.test"
    assert email.subject == "The Sample Logistics floor plan"
    assert email.text.startswith("Hi Lee,\n\nThe plan is <ready>. Ring [email left out].")
    assert email.text.endswith("Sent by Mia Sample from Contour HQ")
    assert "Sample Logistics Pty Ltd in Contour: " in email.text and "/companies/201" in email.text
    assert email.html is not None
    assert "<p>The plan is &lt;ready&gt;. Ring [email left out].</p>" in email.html
    assert ">Sample Logistics Pty Ltd in Contour</a>" in email.html
    assert email.html.endswith("<p><em>Sent by Mia Sample from Contour HQ</em></p>")
    assert "jo@client.example" not in email.text + email.html  # no client address goes out


async def test_a_repeated_key_sends_once(
    world: World, settings: dict[str, Any], sender: LogSender
) -> None:
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        first = await post(client, an_email())
        again = await post(client, an_email(subject="Something else"))
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()  # the first send, as it went
    assert len(sender.sent) == 1


async def test_the_preview_shows_the_email_and_sends_nothing(
    world: World, settings: dict[str, Any], sender: LogSender
) -> None:
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        preview = await client.post(PREVIEW, json=an_email())
    assert preview.status_code == 200, preview.text
    found = preview.json()
    assert (found["sent_at"], found["sends_left"], found["waiting_for"]) == (None, 30, None)
    assert found["text"].endswith("Sent by Mia Sample from Contour HQ")
    assert sender.sent == []


# --- What refuses a send --------------------------------------------------------------------------


async def test_an_outside_address_refuses_the_whole_send_and_names_it(
    world: World, settings: dict[str, Any], sender: LogSender
) -> None:
    await a_team(world)
    body = an_email(emails=["sam@example.test", "jo@outside.example"])
    async with signed_in(world, "mia", owner="o1") as (client, _):
        refused = await post(client, body)
        previewed = await client.post(PREVIEW, json=body)
    for answer in (refused, previewed):
        assert (answer.status_code, answer.json()["code"]) == (422, "outside_address")
        assert answer.json()["detail"] == (
            "Emails from the Assistant go to Contour people only. Remove jo@outside.example to "
            "send."
        )
    assert sender.sent == []


@pytest.mark.parametrize(
    ("owner", "code", "detail"),
    [
        (
            "o3",
            "no_account",
            "Lee Other has no Contour account, so they can't get this email. Pick someone else.",
        ),
        (
            "o4",
            "no_account",
            "Jo Teammate's account has no Contour email address, so they can't get this email. "
            "Pick someone else.",
        ),
        ("o9", "owner_not_found", "They may have left HubSpot. Pick teammates from the list."),
        ("o7", "owner_not_found", "They may have left HubSpot. Pick teammates from the list."),
    ],
)
async def test_a_teammate_who_cant_get_it_cant_be_picked_with_why(
    world: World,
    settings: dict[str, Any],
    sender: LogSender,
    owner: str,
    code: str,
    detail: str,
) -> None:
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        refused = await post(client, an_email(owner_ids=["o2", owner]))
    assert (refused.status_code, refused.json()["code"]) == (422, code)
    assert refused.json()["detail"] == detail
    assert sender.sent == []


async def test_no_sender_set_up_gives_409_and_the_preview_says_so(
    world: World, settings: dict[str, Any]
) -> None:
    settings["email_provider"] = "resend"  # and no key: email isn't set up
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        preview = await client.post(PREVIEW, json=an_email())
        refused = await post(client, an_email())
        after = await client.post(PREVIEW, json=an_email())
    assert (preview.json()["can_send"], preview.json()["waiting_for"]) == (False, NOT_SET_UP)
    assert (refused.status_code, refused.json()["code"]) == (409, "email_not_set_up")
    assert refused.json()["detail"] == (
        "Email isn't set up yet, so nothing was sent. Your email stays on the card: send it once "
        "email is set up, or copy it."
    )
    assert after.json()["sends_left"] == 30  # nothing was counted


async def test_30_a_day_holds_and_a_failed_send_doesnt_count(
    world: World, settings: dict[str, Any]
) -> None:
    breaks = Breaks()
    world.app.state.email_sender = breaks
    world.app.state.team_email = TeamEmailBook(per_day=2)
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        failed = await post(client, an_email(), key="k1")
        assert (failed.status_code, failed.json()["code"]) == (502, "email_failed")
        assert (await post(client, an_email(), key="k1")).status_code == 201  # tried again
        assert (await post(client, an_email(), key="k2")).status_code == 201
        over = await post(client, an_email(), key="k3")
        assert (over.status_code, over.json()["code"]) == (429, "too_many_emails")
        assert over.headers["Retry-After"] == str(4 * 60 * 60)  # until Melbourne's midnight
        assert (await post(client, an_email(), key="k1")).status_code == 200  # the first, again
        assert (await client.post(PREVIEW, json=an_email())).json()["sends_left"] == 0
        world.clock.advance(hours=4)  # midnight in Melbourne: a new day
        assert (await sign_in(client, login="mia")).status_code == 200  # 4 hours idle: again
        assert (await post(client, an_email(), key="k3")).status_code == 201
    assert len(breaks.sent) == 3


# --- The checks, and who may ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "status", "code"),
    [
        ({"subject": "   "}, 422, "subject_empty"),
        ({"body": " \n "}, 422, "body_empty"),
        ({"owner_ids": [], "emails": []}, 422, "no_one"),
        ({"emails": [f"p{n}@example.test" for n in range(20)]}, 422, "too_many_recipients"),
        ({"company_key": "lead:5b0f7e9e-1111-2222-3333-444455556666"}, 422, "not_in_hubspot"),
        ({"company_key": "999"}, 404, "company_not_found"),
    ],
)
async def test_the_checks_before_an_email(
    world: World,
    settings: dict[str, Any],
    sender: LogSender,
    change: dict[str, Any],
    status: int,
    code: str,
) -> None:
    await a_team(world)
    async with signed_in(world, "mia", owner="o1") as (client, _):
        for answer in (
            await post(client, an_email(**change)),
            await client.post(PREVIEW, json=an_email(**change)),
        ):
            assert (answer.status_code, answer.json()["code"]) == (status, code)
        no_key = await client.post(EMAIL, json=an_email())
    assert no_key.status_code == 422  # a send needs its Idempotency-Key
    assert sender.sent == []


async def test_no_reply_to_when_my_own_address_isnt_contours(
    world: World, settings: dict[str, Any], sender: LogSender
) -> None:
    await a_team(world)
    await outside_account(world, "kim", "Kim Teammate")
    async with world.browser() as client:
        signed = await client.post("/api/v1/auth/login", json={"login": "kim", "password": GOOD})
        assert signed.status_code == 200
        sent = await post(client, an_email())
    assert sent.json()["reply_to_me"] is False
    assert sender.sent[0].reply_to is None
    assert sender.sent[0].text.endswith("Sent by Kim Teammate from Contour HQ")


async def test_a_viewer_and_nobody_signed_in_are_refused(
    world: World, settings: dict[str, Any], sender: LogSender
) -> None:
    await a_team(world)
    async with signed_in(world, "vic", owner="o1", role="viewer") as (client, _):
        for path in (PREVIEW, EMAIL):
            refused = await client.post(path, json=an_email(), headers={"Idempotency-Key": "k"})
            assert (refused.status_code, refused.json()["code"]) == (403, "viewer_read_only")
    async with world.browser() as nobody:
        for path in (PREVIEW, EMAIL):
            refused = await nobody.post(path, json=an_email(), headers={"Idempotency-Key": "k"})
            assert (refused.status_code, refused.json()["code"]) == (401, "auth_required")
    assert sender.sent == []


def test_the_book_counts_by_the_melbourne_day() -> None:
    book = TeamEmailBook(per_day=1)
    day = timedelta(days=1)
    today = date(2026, 11, 4)
    assert book.take("mia", today) and not book.take("mia", today)
    assert book.take("lee", today)  # each person has their own
    book.give_back("mia", today)
    assert book.left("mia", today) == 1 and book.left("mia", today + day) == 1
