"""Sending a pre-read (PLAN-V17 T2-14), with a made-up meeting, a fake activity writer and an email
sender that keeps what it would send:

- the preview: the email as it would arrive, escaped, and the people, each with why;
- an outside address refuses the whole send, naming it; the two blanks must be filled first;
- a send and its retry email once; an edit makes it a draft again, and the new words go once;
- each state of the copy in HubSpot: saved, waiting (writing off: the email still goes), off (the
  company isn't in HubSpot) and failed, which Send tries again without a second email.

Made-up companies and people only (Sample Logistics Pty Ltd, Lee Sample).
"""

import asyncio
import dataclasses
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import meeting_send
from apps.companies.meeting_send import COPY_FAILED, COPY_FAULT, LEAD_ONLY
from apps.companies.note_batch import ActivityWriter
from apps.companies.tables import MeetingForm
from core.api.deps import settings_dependency
from core.config import Settings
from core.email.sender import Email, Provider, Sent
from core.hubspot.activities import ActivityRequest
from core.hubspot.client import HubSpot
from core.hubspot.models import HubSpotWrite
from core.hubspot.writer import WriteOut
from tests.companies.helpers import API, add, deal, signed_in_as
from tests.companies.test_call_notes_api import a_company, notes_settings
from tests.companies.test_call_notes_batch import out_of, plan_of, step
from tests.companies.test_meeting_form import Meetings, melbourne
from tests.core.auth_world import World

pytestmark = pytest.mark.integration
FORMS = f"{API}/meetings/forms"
SITE = "https://hq.contour.example"
LEE = "lee@contour.example"


class FakeHubSpot:
    """Stands in for the HubSpot client: the fake writer never calls it."""

    writes_allowed = True

    async def aclose(self) -> None:
        return None


@dataclass
class KeptSender:
    """An email sender that keeps each email and its key, and sends nothing."""

    provider: Provider = "log"
    sent: list[tuple[Email, str]] = field(default_factory=list)

    async def deliver(self, email: Email, key: str) -> Sent:
        self.sent.append((email, key))
        return Sent(provider="log", id=key, to_count=len(email.to))


@dataclass
class CopyWriter:
    """Core's activity writer, made up: it saves a real write row for each copy (the form points
    at its write), and ends it as the test says."""

    outcome: str = "done"
    breaks: bool = False
    requests: list[ActivityRequest] = field(default_factory=list)

    def writer(self) -> ActivityWriter:
        return ActivityWriter(
            preview=self.preview, apply=self.apply, resolve=self.resolve, owner_of=self.owner_of
        )

    async def owner_of(self, session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
        return "o1" if user_id is not None else None

    async def preview(
        self, session: AsyncSession, hubspot: HubSpot, request: ActivityRequest
    ) -> WriteOut:
        self.requests.append(request)
        row = HubSpotWrite(
            id=uuid.uuid4(),
            app=request.app,
            subject=request.subject,
            status="previewed",
            plan=plan_of(request.company_id, []),
            result={},
            hubspot_company_id=request.company_id,
            hubspot_url=None,
            error=None,
        )
        session.add(row)
        await session.commit()
        return out_of(row)

    async def apply(self, session: AsyncSession, hubspot: HubSpot, write_id: uuid.UUID) -> WriteOut:
        if self.breaks:
            raise RuntimeError("a made-up break")
        row = await session.get(HubSpotWrite, write_id)
        assert row is not None
        row.status = self.outcome
        row.result = {
            "steps": [step("note", self.outcome if self.outcome != "partial" else "failed")]
        }
        await session.commit()
        return out_of(row)

    async def resolve(
        self, session: AsyncSession, write_id: uuid.UUID, name: str, landed: bool
    ) -> WriteOut:
        raise AssertionError("a pre-read's copy has no step to settle")


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: Meetings on, Contour's domain made up, writing on."""
    chosen: dict[str, Any] = {
        "meeting_forms_enabled": True,
        "internal_email_domains": ["contour.example"],
        "app_url": SITE,
        "hubspot_write_enabled": True,
    }
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@dataclass
class Sending:
    emails: KeptSender
    copies: CopyWriter


@pytest.fixture
def sending(world: World, settings: dict[str, Any]) -> Sending:
    """The meeting's owner (o1) is Lee Sample here. HubSpot is set up."""

    async def lee(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return ("Lee Sample", LEE) if owner_id == "o1" else None

    world.app.state.meeting_source = dataclasses.replace(Meetings().source(), rep_of_owner=lee)
    world.app.state.hubspot_provider = FakeHubSpot
    made = Sending(KeptSender(), CopyWriter())
    world.app.state.email_sender = made.emails
    world.app.state.activity_writer = made.copies.writer()
    return made


def a_draft(**more: Any) -> MeetingForm:
    """A pre-read ready to send, for the made-up meeting 9101, with things HTML must escape."""
    values: dict[str, Any] = {
        "meeting_id": "9101",
        "company_key": "201",
        "company_name": "Sample Logistics Pty Ltd",
        "title": "Fit-out walk-through",
        "starts_at": melbourne(5, 10),
        "ends_at": melbourne(5, 11),
        "where": "in_person",
        "status": "draft",
        "facts": [
            {"label": "When", "value": "Thu 5 Nov 2026, 10:00 am", "source": "HubSpot meeting"},
            {"label": "Staff", "value": "About 120", "source": "HubSpot company"},
        ],
        "summaries": {
            "what_they_do": {
                "text": "They move freight. <script>alert(1)</script>",
                "by": "ai",
                "sources": [],
            },
            "what_we_know": {
                "text": "The Perth lease ends in 2028.\nThey want more room.",
                "by": "person",
                "sources": [],
            },
            "talks_so_far": {"text": "We met on 2 Nov.", "by": "ai", "sources": []},
        },
        "next_step": "Book a site visit & a <b>quote</b>",
        "going": "Lee Sample",
    }
    values.update(more)
    return MeetingForm(**values)


async def a_saved_draft(world: World, **more: Any) -> MeetingForm:
    await a_company(world)
    await add(world, deal("d1", "201", "Proposal"))
    form = a_draft(**more)
    await add(world, form)
    return form


async def send(client: httpx.AsyncClient, form: MeetingForm, *to: str) -> httpx.Response:
    return await client.post(f"{FORMS}/{form.id}/send", json={"to": list(to)})


# --- The preview ----------------------------------------------------------------------------------


async def test_the_preview_shows_the_email_and_who_would_get_it(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        added = ["sam@contour.example", "jo@sample.example", "LEE@contour.example"]
        response = await client.post(f"{FORMS}/{form.id}/preview", json={"to": added})
    assert response.status_code == 200, response.text
    found = response.json()
    assert found["people"] == [
        {
            "name": "Lee Sample",
            "email": LEE,
            "why": "on the meeting",
            "ticked": True,
            "allowed": True,
        },
        {
            "name": None,
            "email": "sam@contour.example",
            "why": "added by you",
            "ticked": True,
            "allowed": True,
        },
        {
            "name": None,
            "email": "jo@sample.example",
            "why": "added by you",
            "ticked": True,
            "allowed": False,
        },
    ]
    assert found["subject"] == "Pre-read: Sample Logistics Pty Ltd, Thu 5 Nov 2026, 10:00 am"
    text = found["text"]
    assert "What they do (Written by AI)\nThey move freight." in text
    assert "What we know about the project\nThe Perth lease ends in 2028." in text  # the rep's
    assert "The talks so far (Written by AI)" in text
    assert "Ideal next step\nBook a site visit & a <b>quote</b>" in text
    assert f"Sample Logistics Pty Ltd in Contour: {SITE}/companies/201" in text
    page = found["html"]
    assert "<script>" not in page and "&lt;script&gt;alert(1)&lt;/script&gt;" in page
    assert "Book a site visit &amp; a &lt;b&gt;quote&lt;/b&gt;" in page
    assert page.count("<em>(Written by AI)</em>") == 2
    assert "The Perth lease ends in 2028.<br>They want more room." in page
    assert f'href="{SITE}/companies/201"' in page
    assert sending.emails.sent == []  # a preview sends nothing


# --- Refusals -------------------------------------------------------------------------------------


async def test_an_outside_address_refuses_the_whole_send(world: World, sending: Sending) -> None:
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        refused = await send(client, form, LEE, "jo@sample.example", "x@contour.example.evil.com")
        after = (await client.get(f"{FORMS}/{form.id}")).json()
    assert (refused.status_code, refused.json()["code"]) == (422, "outside_address")
    assert refused.json()["detail"] == (
        "A pre-read goes to Contour addresses only, so nothing was sent. Take out: "
        "jo@sample.example, x@contour.example.evil.com."
    )
    assert sending.emails.sent == [] and after["status"] == "draft"


async def test_the_two_blanks_must_be_filled_before_it_goes(world: World, sending: Sending) -> None:
    form = await a_saved_draft(world, going=None)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        refused = await send(client, form, LEE)
    assert (refused.status_code, refused.json()["code"]) == (422, "blanks_empty")
    assert refused.json()["detail"] == "Fill in the ideal next step and who is going, then send it."
    assert sending.emails.sent == []


# --- Sending once ---------------------------------------------------------------------------------


async def test_a_send_and_its_retry_email_once_and_new_words_go_once_more(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first = await send(client, form, LEE, "SAM@contour.example")
        retry = await send(client, form, LEE, "SAM@contour.example")
        edited = await client.patch(f"{FORMS}/{form.id}", json={"going": "Lee Sample and Mia"})
        again = await send(client, form, LEE)
    assert first.status_code == retry.status_code == again.status_code == 200, first.text
    sent = first.json()
    assert sent["status"] == "sent" and sent["sent_by"] == "Mia" and sent["sent_at"] is not None
    assert sent["sent_to"] == [
        {"name": None, "email": LEE},
        {"name": None, "email": "sam@contour.example"},
    ]
    assert sent["hubspot_copy"] == {"state": "saved", "sentence": None}
    assert retry.json() == sent  # the same words went already: nobody is emailed again
    assert edited.json()["status"] == "draft"  # new words: a draft again
    keys = [key for _, key in sending.emails.sent]
    assert keys == [f"meeting-form:{form.id}:1", f"meeting-form:{form.id}:2"]
    email, _ = sending.emails.sent[0]
    assert email.to == [LEE, "sam@contour.example"]
    assert email.html is not None and "&lt;script&gt;" in email.html
    assert again.json()["status"] == "sent"
    assert len(sending.copies.requests) == 2  # one copy for each version sent


async def test_two_presses_at_once_email_once(world: World, sending: Sending) -> None:
    """Send lets go of the row's lock while the email goes. A second press in that moment must
    not email again, even on a sender with no idempotency of its own (like the log sender)."""
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first, second = await asyncio.gather(send(client, form, LEE), send(client, form, LEE))
    answers = sorted([first.status_code, second.status_code])
    assert answers in ([200, 200], [200, 409]), (first.text, second.text)
    if answers == [200, 409]:
        refused = first if first.status_code == 409 else second
        assert refused.json()["code"] == "form_sending"
    assert len(sending.emails.sent) == 1  # one email, whichever way the two met


# --- The copy in HubSpot --------------------------------------------------------------------------


async def test_the_copy_in_hubspot_is_a_note_on_the_company_and_its_deal(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        sent = (await send(client, form, LEE)).json()
    [request] = sending.copies.requests
    assert (request.app, request.subject) == ("companies", f"meeting_form:{form.id}:1")
    assert (request.company_id, request.deal_id, request.owner_id) == ("201", "d1", "o1")
    assert (request.call, request.tasks, request.fields) == (None, [], [])
    assert request.note is not None
    assert request.note.body.startswith("Pre-read for the meeting with Sample Logistics Pty Ltd")
    assert sent["hubspot_copy"] == {"state": "saved", "sentence": None}
    async with world.factory() as db:
        row = await db.get(MeetingForm, form.id)
        assert row is not None and row.hubspot_write_id is not None


@pytest.mark.parametrize(
    ("change", "state", "sentence"),
    [
        ({"hubspot_write_enabled": False}, "waiting", "Waiting for HubSpot write access."),
        ({"outcome": "failed"}, "failed", COPY_FAILED),
        ({"breaks": True}, "failed", COPY_FAULT),
    ],
    ids=["writing_off", "hubspot_refused", "our_side_broke"],
)
async def test_the_email_goes_whatever_happens_to_the_copy(
    world: World,
    settings: dict[str, Any],
    sending: Sending,
    change: dict[str, Any],
    state: str,
    sentence: str,
) -> None:
    form = await a_saved_draft(world)
    if "hubspot_write_enabled" in change:
        settings.update(change)
    else:
        for name, value in change.items():
            setattr(sending.copies, name, value)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        sent = (await send(client, form, LEE)).json()
        # Send again: no second email, and the copy is tried once more. Now it lands.
        settings.update(hubspot_write_enabled=True)
        sending.copies.outcome, sending.copies.breaks = "done", False
        again = (await send(client, form, LEE)).json()
    assert sent["status"] == "sent"
    assert sent["hubspot_copy"] == {"state": state, "sentence": sentence}
    assert len(sending.emails.sent) == 1
    assert again["hubspot_copy"] == {"state": "saved", "sentence": None}


async def test_a_company_not_in_hubspot_gets_no_copy(world: World, sending: Sending) -> None:
    await a_company(world)
    form = a_draft(meeting_id=None, company_key=f"lead:{uuid.uuid4()}", status="sent")
    await add(world, form)
    async with world.factory() as db:
        found = await meeting_send.copy_in_hubspot(
            db,
            form,
            app=world.app,
            settings=Settings(_env_file=None, hubspot_write_enabled=True),
            writer=sending.copies.writer(),
        )
    assert found == ("off", LEAD_ONLY, None)
    assert sending.copies.requests == []


async def test_a_draft_that_isnt_ready_cant_be_sent(world: World, sending: Sending) -> None:
    form = await a_saved_draft(world, status="failed")
    async with signed_in_as(world, "mia", ["companies"]) as client:
        refused = await send(client, form, LEE)
    assert (refused.status_code, refused.json()["code"]) == (409, "form_not_ready")
    assert sending.emails.sent == []
