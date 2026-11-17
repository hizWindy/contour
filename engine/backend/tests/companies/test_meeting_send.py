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
from datetime import UTC, date, datetime
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies import meeting_send
from apps.companies.meeting_send import (
    COPY_FAILED,
    COPY_FAULT,
    COPY_UNSURE,
    LEAD_ONLY,
    MEETING_NOTE,
)
from apps.companies.note_batch import ActivityWriter
from apps.companies.tables import MeetingForm
from core.api.deps import settings_dependency
from core.config import Settings
from core.email.sender import Email, Provider, Sent
from core.hubspot.activities import BODY_MAX_CHARS, ActivityRequest
from core.hubspot.client import HubSpot
from core.hubspot.models import HubSpotOwner, HubSpotWrite
from core.hubspot.writer import WriteOut
from tests.companies.helpers import API, add, deal, person, signed_in_as
from tests.companies.test_call_notes_api import a_company, notes_settings
from tests.companies.test_call_notes_batch import out_of, plan_of, status_of, step
from tests.companies.test_meeting_form import WALK_THROUGH, Meetings, melbourne
from tests.core.auth_world import World, sign_in

pytestmark = pytest.mark.integration
FORMS = f"{API}/meetings/forms"
SITE = "https://hq.contour.example"
LEE = "lee@contour.example"
SAM = "sam@contour.example"


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
    steps: list[tuple[str, str]] = field(default_factory=list)  # (name, status), if set
    fail_owners: set[str] = field(default_factory=set)
    requests: list[ActivityRequest] = field(default_factory=list)
    applies: list[uuid.UUID] = field(default_factory=list)
    _plans: dict[uuid.UUID, list[str]] = field(default_factory=dict)

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
        row_id = uuid.uuid4()
        self._plans[row_id] = [t.owner_id for t in request.tasks if t.owner_id]
        row = HubSpotWrite(
            id=row_id,
            app=request.app,
            subject=request.subject,
            status="previewed",
            plan={
                **plan_of(request.company_id, []),
                "request": request.model_dump(mode="json"),
            },
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
        self.applies.append(write_id)
        row = await session.get(HubSpotWrite, write_id)
        assert row is not None
        if self.steps:
            steps_out = [step(name, status) for name, status in self.steps]
            row.status = self.outcome
        elif self.fail_owners:
            owners = self._plans.get(write_id, [])
            steps_out = [
                step(f"task:{idx}", "failed" if oid in self.fail_owners else "done")
                for idx, oid in enumerate(owners, start=1)
            ]
            steps_out.append(step("note", "done"))
            row.status = status_of(steps_out)
        else:
            owners = self._plans.get(write_id, [])
            task_status = "done" if self.outcome in ("done", "partial") else self.outcome
            steps_out = [step(f"task:{idx}", task_status) for idx, _ in enumerate(owners, start=1)]
            note_status = self.outcome if self.outcome != "partial" else "failed"
            steps_out.append(step("note", note_status))
            row.status = self.outcome
        row.result = {"steps": steps_out}
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


async def send(
    client: httpx.AsyncClient,
    form: MeetingForm,
    *to: str,
    owner_ids: list[str] | None = None,
    email_them: bool = False,
) -> httpx.Response:
    body: dict[str, Any] = {"emails": list(to), "email_them": email_them}
    if owner_ids is not None:
        body["owner_ids"] = owner_ids
    return await client.post(f"{FORMS}/{form.id}/send", json=body)


# --- The preview ----------------------------------------------------------------------------------


async def test_the_preview_shows_the_email_and_who_would_get_it(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        added = ["sam@contour.example", "jo@sample.example", "LEE@contour.example"]
        response = await client.post(f"{FORMS}/{form.id}/preview", json={"emails": added})
    assert response.status_code == 200, response.text
    found = response.json()
    assert found["people"] == [
        {
            "owner_id": "o1",
            "name": "Lee Sample",
            "address": LEE,
            "task": True,
            "email": True,
            "why": "on the meeting",
            "already": None,
            "ticked": True,
            "allowed": True,
        },
        {
            "owner_id": None,
            "name": None,
            "address": "sam@contour.example",
            "task": False,
            "email": True,
            "why": "added by you",
            "already": None,
            "ticked": True,
            "allowed": True,
        },
        {
            "owner_id": None,
            "name": None,
            "address": "jo@sample.example",
            "task": False,
            "email": False,
            "why": "added by you",
            "already": None,
            "ticked": False,  # it can't get it, so it isn't ticked
            "allowed": False,
        },
    ]
    assert found["subject"] == "Pre-read: Sample Logistics Pty Ltd, Thu 5 Nov 2026, 10:00 am"
    assert (
        found["task_subject"]
        == "Pre-read: Fit-out walk-through with Sample Logistics Pty Ltd, Thu 5 Nov"
    )
    assert found["task_due"] == "2026-11-04"
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


async def test_an_address_longer_than_any_email_is_refused(world: World, sending: Sending) -> None:
    """Each address is at most 254 characters, so a long one is refused before any check reads
    it (T2-16): a check on a very long one could hold up the backend."""
    form = await a_saved_draft(world)
    long = "a" * 250 + "@contour.example"
    async with signed_in_as(world, "mia", ["companies"]) as client:
        previewed = await client.post(f"{FORMS}/{form.id}/preview", json={"emails": [long]})
        refused = await send(client, form, LEE, long)
    assert (previewed.status_code, refused.status_code) == (422, 422)
    assert sending.emails.sent == []


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
    assert [
        {k: r[k] for k in ("owner_id", "name", "address", "task", "email")} for r in sent["sent_to"]
    ] == [
        {"owner_id": None, "name": None, "address": LEE, "task": "none", "email": True},
        {
            "owner_id": None,
            "name": None,
            "address": "sam@contour.example",
            "task": "none",
            "email": True,
        },
    ]
    assert all(r["at"] is not None for r in sent["sent_to"])
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


# --- The joins at the PLAN-V17 merge (M5) ---------------------------------------------------------


async def test_the_preview_ticks_every_contour_person_on_the_meeting(
    world: World, sending: Sending
) -> None:
    """The meeting's owner and the other people HubSpot lists on it (when in HubSpot's owners or
    Contour), each once. One with no account gets task only (no email even if switched on)."""
    meetings = Meetings()
    meetings.meetings[0] = WALK_THROUGH.model_copy(
        update={"attendee_owner_ids": ["o2", "o1", "o3"]}
    )

    async def reps(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return {"o1": ("Lee Sample", LEE), "o2": ("Sam Sample", SAM)}.get(owner_id)

    await add(
        world,
        HubSpotOwner(owner_id="o2", name="Sam Sample", archived=False),
        HubSpotOwner(owner_id="o3", name="Jo Outside", archived=False),
    )
    world.app.state.meeting_source = dataclasses.replace(meetings.source(), rep_of_owner=reps)
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        response = await client.post(
            f"{FORMS}/{form.id}/preview", json={"emails": [SAM], "email_them": False}
        )
    assert response.status_code == 200, response.text
    people = [
        (p["owner_id"], p["name"], p["address"], p["task"], p["email"], p["why"], p["ticked"])
        for p in response.json()["people"]
    ]
    assert people == [
        ("o1", "Lee Sample", None, True, False, "on the meeting", True),
        ("o2", "Sam Sample", SAM, True, True, "on the meeting", True),
        ("o3", "Jo Outside", None, True, False, "on the meeting", True),
    ]


@pytest.mark.parametrize(
    ("switch", "typed", "note"),
    [(True, False, MEETING_NOTE), (False, False, None), (True, True, None)],
    ids=["switch_on", "switch_off", "typed_meeting"],
)
async def test_the_preview_says_when_the_copy_also_goes_on_the_meeting(
    world: World,
    sending: Sending,
    settings: dict[str, Any],
    switch: bool,
    typed: bool,
    note: str | None,
) -> None:
    """Send adds the copy to the meeting's internal notes only for a HubSpot meeting while the
    switch is on, and the Send dialog says so in one line."""
    settings["meeting_note_on_meeting"] = switch
    form = await a_saved_draft(world, **({"meeting_id": None} if typed else {}))
    async with signed_in_as(world, "mia", ["companies"]) as client:
        response = await client.post(f"{FORMS}/{form.id}/preview", json={"emails": [LEE]})
    assert response.status_code == 200, response.text
    assert response.json()["meeting_note"] == note


def test_a_lead_only_company_says_nothing_about_the_meeting() -> None:
    """No copy is saved for a company that isn't in HubSpot, so nothing goes on the meeting."""
    switched_on = Settings(_env_file=None, meeting_note_on_meeting=True)
    assert (
        meeting_send.goes_on_meeting(a_draft(company_key=f"lead:{uuid.uuid4()}"), switched_on)
        is False
    )
    assert meeting_send.goes_on_meeting(a_draft(), switched_on) is True


@pytest.mark.parametrize(
    ("typed", "meeting_id"),
    [(False, "9101"), (True, None)],
    ids=["hubspot_meeting", "typed_meeting"],
)
async def test_the_copy_names_its_meeting(
    world: World, sending: Sending, typed: bool, meeting_id: str | None
) -> None:
    """Core adds the note to the meeting only while its switch is on, and reads it again then."""
    form = await a_saved_draft(world, **({"meeting_id": None} if typed else {}))
    async with signed_in_as(world, "mia", ["companies"]) as client:
        assert (await send(client, form, LEE)).status_code == 200
    [request] = sending.copies.requests
    assert request.meeting_id == meeting_id


@pytest.mark.parametrize(
    ("steps", "outcome", "state", "sentence"),
    [
        ([("note", "done"), ("meeting", "failed")], "partial", "saved", None),
        ([("note", "uncertain")], "uncertain", "failed", COPY_UNSURE),
    ],
    ids=["meeting_step_failed", "note_unsure"],
)
async def test_the_copy_is_saved_once_the_note_on_the_company_is(
    world: World,
    sending: Sending,
    steps: list[tuple[str, str]],
    outcome: str,
    state: str,
    sentence: str | None,
) -> None:
    """The copy is the note on the company. A failed meeting step makes the write partial, but
    the note is saved, so the copy says saved."""
    sending.copies.outcome = outcome
    sending.copies.steps = steps
    form = await a_saved_draft(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        sent = (await send(client, form, LEE)).json()
    assert sent["hubspot_copy"] == {"state": state, "sentence": sentence}


# --- PLAN-V19 T1-7 & T1-8: team, HubSpot tasks, email_them, retry and send to more ----------------


async def _seed_team(world: World) -> tuple[Any, Any]:
    async with world.factory() as db:
        await db.merge(HubSpotOwner(owner_id="o2", name="Sam Sample", archived=False))
        await db.merge(HubSpotOwner(owner_id="o1", name="Lee Sample", archived=False))
        await db.merge(HubSpotOwner(owner_id="o3", name="Jo Sample", archived=False))
        await db.merge(HubSpotOwner(owner_id="o9", name="Archived Rep", archived=True))
        await db.commit()
    lee = await person(world, "lee", apps=["companies"])
    sam = await person(world, "sam", apps=["companies"])
    async with world.factory() as db:
        lee_row = await db.get(type(lee), lee.id)
        sam_row = await db.get(type(sam), sam.id)
        assert lee_row is not None and sam_row is not None
        lee_row.name = "Lee Sample"
        lee_row.hubspot_owner_id = "o1"
        lee_row.hubspot_owner_matched_by = "person"
        sam_row.name = "Sam Sample"
        sam_row.hubspot_owner_id = "o2"
        sam_row.hubspot_owner_matched_by = "person"
        await db.commit()
    return lee, sam


async def test_team_list_returns_active_owners_sorted_without_emails(
    world: World, sending: Sending
) -> None:
    await _seed_team(world)
    async with world.browser() as client:
        assert (await sign_in(client, login="lee")).status_code == 200
        response = await client.get(f"{API}/team")
    assert response.status_code == 200, response.text
    rows = response.json()
    assert rows == [
        {"owner_id": "o3", "name": "Jo Sample", "has_account": False, "is_me": False},
        {"owner_id": "o1", "name": "Lee Sample", "has_account": True, "is_me": True},
        {"owner_id": "o2", "name": "Sam Sample", "has_account": True, "is_me": False},
    ]
    assert "@" not in response.text


async def test_team_list_returns_503_when_database_fails(
    world: World, sending: Sending, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.hubspot import owners as hubspot_owners

    async def boom(*args: object, **kwargs: object) -> list[Any]:
        raise RuntimeError("db dropped")

    async with signed_in_as(world, "mia", ["companies"]) as client:
        monkeypatch.setattr(hubspot_owners, "active_owners", boom)
        response = await client.get(f"{API}/team")
    assert (response.status_code, response.json()["code"]) == (503, "team_unavailable")


async def test_retry_saves_partial_success_before_raising_502(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)

    async def reps(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return {"o1": ("Lee Sample", LEE), "o2": ("Sam Sample", SAM)}.get(owner_id)

    world.app.state.meeting_source = dataclasses.replace(Meetings().source(), rep_of_owner=reps)
    sending.copies.fail_owners = {"o2", "o3"}
    async with signed_in_as(world, "mia", ["companies"]) as client:
        sent = (await send(client, form, owner_ids=["o1", "o2", "o3"], email_them=False)).json()
        assert [(r["owner_id"], r["task"]) for r in sent["sent_to"]] == [
            ("o1", "sent"),
            ("o2", "failed"),
            ("o3", "failed"),
        ]
        # Force retry onto a partial failure (o2 succeeds, o3 still fails)
        sending.copies.fail_owners = {"o3"}
        retry = await client.post(f"{FORMS}/{form.id}/tasks/retry")
        assert (retry.status_code, retry.json()["code"]) == (502, "task_failed")
        assert retry.json()["detail"] == "Jo Sample's HubSpot task didn't go."
        after = (await client.get(f"{FORMS}/{form.id}")).json()
        assert [(r["owner_id"], r["task"]) for r in after["sent_to"]] == [
            ("o1", "sent"),
            ("o2", "sent"),
            ("o3", "failed"),
        ]


async def test_task_only_send_skips_email_and_batches_one_request(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)

    async def reps(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return {"o1": ("Lee Sample", LEE), "o2": ("Sam Sample", SAM)}.get(owner_id)

    world.app.state.meeting_source = dataclasses.replace(Meetings().source(), rep_of_owner=reps)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        response = await send(client, form, owner_ids=["o1", "o2", "o3"], email_them=False)
    assert response.status_code == 200, response.text
    sent = response.json()
    assert sending.emails.sent == []  # default email_them=False sends no emails
    assert [
        (r["owner_id"], r["name"], r["task"], r["email"], r["address"]) for r in sent["sent_to"]
    ] == [
        ("o1", "Lee Sample", "sent", False, None),
        ("o2", "Sam Sample", "sent", False, None),
        ("o3", "Jo Sample", "sent", False, None),
    ]
    assert len(sending.copies.requests) == 1  # single HubSpot write (1 company + 3 tasks + 1 note)
    req = sending.copies.requests[0]
    assert len(req.tasks) == 3
    assert [t.owner_id for t in req.tasks] == ["o1", "o2", "o3"]
    assert all(
        t.subject == "Pre-read: Fit-out walk-through with Sample Logistics Pty Ltd, Thu 5 Nov"
        for t in req.tasks
    )
    assert all(t.due == date(2026, 11, 4) for t in req.tasks)
    assert req.note is not None


async def test_send_with_tasks_and_email_emails_only_accounts(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)

    async def reps(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return {"o1": ("Lee Sample", LEE), "o2": ("Sam Sample", SAM)}.get(owner_id)

    world.app.state.meeting_source = dataclasses.replace(Meetings().source(), rep_of_owner=reps)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        response = await send(client, form, owner_ids=["o1", "o2", "o3"], email_them=True)
    assert response.status_code == 200, response.text
    sent = response.json()
    assert len(sending.emails.sent) == 1
    assert sending.emails.sent[0][0].to == [LEE, SAM]  # o3 has no account -> task only
    assert [(r["owner_id"], r["task"], r["email"], r["address"]) for r in sent["sent_to"]] == [
        ("o1", "sent", True, LEE),
        ("o2", "sent", True, SAM),
        ("o3", "sent", False, None),
    ]


async def test_task_only_refuses_when_hubspot_writing_is_off(
    world: World, settings: dict[str, Any], sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)
    settings["hubspot_write_enabled"] = False
    async with signed_in_as(world, "mia", ["companies"]) as client:
        refused = await send(client, form, owner_ids=["o1"], email_them=False)
    assert (refused.status_code, refused.json()["code"]) == (409, "hubspot_writes_off")


async def test_partial_task_failure_and_retry_tasks_without_email(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)

    async def reps(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return {"o1": ("Lee Sample", LEE), "o2": ("Sam Sample", SAM)}.get(owner_id)

    world.app.state.meeting_source = dataclasses.replace(Meetings().source(), rep_of_owner=reps)
    sending.copies.fail_owners = {"o3"}
    async with signed_in_as(world, "mia", ["companies"]) as client:
        sent_resp = await send(client, form, owner_ids=["o1", "o3"], email_them=True)
        assert sent_resp.status_code == 200, sent_resp.text
        sent = sent_resp.json()
        assert len(sending.emails.sent) == 1
        assert [(r["owner_id"], r["task"], r["email"]) for r in sent["sent_to"]] == [
            ("o1", "sent", True),
            ("o3", "failed", False),
        ]

        # First retry fails too -> 502 task_failed naming Jo Sample; zero emails sent
        still_bad = await client.post(f"{FORMS}/{form.id}/tasks/retry")
        assert (still_bad.status_code, still_bad.json()["code"]) == (502, "task_failed")
        assert "Jo Sample's HubSpot task didn't go." in still_bad.json()["detail"]
        assert len(sending.emails.sent) == 1

        # Second retry succeeds -> existing write finishes and task flips to sent
        sending.copies.fail_owners = set()
        fixed = await client.post(f"{FORMS}/{form.id}/tasks/retry")
        assert fixed.status_code == 200, fixed.text
        assert [(r["owner_id"], r["task"], r["email"]) for r in fixed.json()["sent_to"]] == [
            ("o1", "sent", True),
            ("o3", "sent", False),
        ]
        assert len(sending.emails.sent) == 1  # zero emails on retry
        assert len(sending.copies.requests) == 1  # re-applied the same HubSpotWrite!


async def test_send_to_more_only_reaches_new_people_and_updates_list_row(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)

    async def reps(session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return {"o1": ("Lee Sample", LEE), "o2": ("Sam Sample", SAM)}.get(owner_id)

    world.app.state.meeting_source = dataclasses.replace(Meetings().source(), rep_of_owner=reps)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first = await send(client, form, owner_ids=["o1"], email_them=True)
        assert first.status_code == 200, first.text
        first_at = first.json()["sent_to"][0]["at"]

        world.clock.advance(minutes=30)
        preview_more = await client.post(
            f"{FORMS}/{form.id}/preview",
            json={
                "owner_ids": ["o1", "o2"],
                "emails": ["alex@contour.example"],
                "email_them": True,
            },
        )
        assert preview_more.status_code == 200, preview_more.text
        by_name = {p["name"] or p["address"]: p for p in preview_more.json()["people"]}
        assert by_name["Lee Sample"]["already"] == first_at
        assert by_name["Lee Sample"]["ticked"] is False
        assert by_name["Sam Sample"]["already"] is None
        assert by_name["Sam Sample"]["ticked"] is True

        second = await send(
            client, form, "alex@contour.example", owner_ids=["o1", "o2"], email_them=True
        )
        assert second.status_code == 200, second.text
        sent2 = second.json()
        assert sent2["sent_to"][0]["at"] == first_at  # Lee kept original timestamp
        assert [(r["owner_id"], r["task"], r["email"], r["address"]) for r in sent2["sent_to"]] == [
            ("o1", "sent", True, LEE),
            ("o2", "sent", True, SAM),
            (None, "none", True, "alex@contour.example"),
        ]
        assert len(sending.emails.sent) == 2
        assert sending.emails.sent[1][0].to == [SAM, "alex@contour.example"]  # Lee skipped!
        assert f"meeting-form:{form.id}:1:more:" in sending.emails.sent[1][1]
        assert len(sending.copies.requests[1].tasks) == 1
        assert sending.copies.requests[1].tasks[0].owner_id == "o2"

        rows = (await client.get(f"{API}/meetings")).json()
        state = rows["items"][0]["form"]
        assert state["sent_count"] == 3
        assert state["sent_names"] == ["Lee Sample", "Sam Sample"]  # capped at 2
        assert state["sent_at"] is not None


async def test_send_validation_refusals(world: World, sending: Sending) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        empty = await client.post(f"{FORMS}/{form.id}/send", json={"owner_ids": [], "emails": []})
        archived = await send(client, form, owner_ids=["o9"])
        too_many = await client.post(
            f"{FORMS}/{form.id}/send",
            json={"emails": [f"u{i}@contour.example" for i in range(20)], "owner_ids": ["o1"]},
        )
    assert (empty.status_code, empty.json()["code"]) == (422, "no_one")
    assert (archived.status_code, archived.json()["code"]) == (422, "owner_not_found")
    assert (too_many.status_code, too_many.json()["code"]) == (422, "too_many_recipients")


def test_task_due_skips_weekends_and_never_past() -> None:
    now = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)  # Mon 2 Nov in Melbourne
    monday_meeting = a_draft(starts_at=datetime(2026, 11, 9, 0, 0, tzinfo=UTC))  # Mon 9 Nov Melb
    assert meeting_send.task_due(monday_meeting, now) == date(2026, 11, 6)  # Fri 6 Nov

    past_meeting = a_draft(starts_at=datetime(2026, 11, 1, 0, 0, tzinfo=UTC))
    assert meeting_send.task_due(past_meeting, now) == date(2026, 11, 2)  # clamped to today


def test_task_body_keeps_contour_links_when_truncated() -> None:
    long_summary = "Freight freight freight. " * 4000
    form = a_draft(
        summaries={
            "what_they_do": {"text": long_summary, "by": "ai", "sources": []},
            "what_we_know": {"text": "Warehouse move.", "by": "person", "sources": []},
            "talks_so_far": {"text": "Called last week.", "by": "ai", "sources": []},
        }
    )
    settings = Settings(_env_file=None, app_url=SITE)
    body = meeting_send.task_body(form, settings)
    assert len(body) <= BODY_MAX_CHARS
    assert f"Pre-read in Contour: {SITE}/meetings?form={form.id}" in body
    assert f"Sample Logistics Pty Ltd in Contour: {SITE}/companies/201" in body
    assert "What they do (Written by AI)" in body


async def test_team_and_retry_require_meetings_write_permission(
    world: World, sending: Sending
) -> None:
    form = await a_saved_draft(world)
    await _seed_team(world)
    await person(world, "viewer", apps=["companies"], role="viewer")
    async with world.browser() as viewer_client:
        assert (await sign_in(viewer_client, login="viewer")).status_code == 200
        team_resp = await viewer_client.get(f"{API}/team")
        retry_resp = await viewer_client.post(f"{FORMS}/{form.id}/tasks/retry")
    assert team_resp.status_code == 200  # viewer can view read routes
    assert (retry_resp.status_code, retry_resp.json()["code"]) == (403, "viewer_read_only")
