"""The pre-read's draft (PLAN-V17 T2-12), with a fake Claude and made-up meetings:

- a pre-read for a HubSpot meeting: the facts with no AI, then three summaries in which every
  sentence cites a fact or is dropped; a second start gives back the first;
- no email address or phone number reaches Claude, nor a name while names may not go to it; the
  rep's own call notes go only while Claude may read call notes;
- the cap: no second try past it, and the facts still show;
- the rep's summary, next step and who is going stay through a redraft; the answer form has no
  place for the next step or who is going;
- a typed meeting gets a pre-read, and shows in Meetings and its counts;
- a failure, a shutdown and a restart each leave the form failed in plain words, never lost;
- bad starts are refused in plain words.

Made-up companies and people only (Sample Logistics Pty Ltd, Jo Sample).
"""

import asyncio
import re
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.app import stop_background
from apps.companies.facts import day
from apps.companies.meeting_form import (
    STOPPED,
    STUCK_ERROR,
    FormAnswer,
    FormSentence,
    MeetingFormRunner,
)
from apps.companies.meeting_store import MeetingSource
from apps.companies.tables import MeetingForm
from core.api.deps import settings_dependency
from core.auth.models import User
from core.claude.client import ClaudeError, Reply, WebTools
from core.claude.pricing import Usage
from core.config import Settings
from core.hubspot.meetings import Meeting, MeetingsStatus
from core.hubspot.models import HubSpotCall, HubSpotCompany
from tests.companies.helpers import API, add, deal, signed_in_as
from tests.companies.test_call_notes_api import a_company, log_call, notes_settings, set_note
from tests.core.auth_world import START, World

pytestmark = pytest.mark.integration
FORMS = f"{API}/meetings/forms"
MELBOURNE = timedelta(hours=11)  # summer time
CONTACT_WORDS = re.compile(r"0412|345 678|@|sample\.example", re.IGNORECASE)


def melbourne(day_of_month: int, hour: int) -> datetime:
    """A Melbourne summer time in Nov 2026, as UTC."""
    return datetime(2026, 11, day_of_month, hour, tzinfo=UTC) - MELBOURNE


WALK_THROUGH = Meeting(
    id="9101",
    company_id="201",
    contact_ids=["c201", "c202"],
    owner_id="o1",
    title="Fit-out walk-through",
    starts_at=melbourne(5, 10),
    ends_at=melbourne(5, 11),
    where="in_person",
    location="Level 3, 120 Sample St, Perth",
    outcome="scheduled",
)
EARLIER = Meeting(
    id="8101",
    company_id="201",
    owner_id="o1",
    title="Intro meeting",
    starts_at=melbourne(2, 10),
    where="online",
    outcome="completed",
    notes="Jo said the Perth lease ends in 2028. Call her on 0412 345 678 or jo@sample.example.",
)
NO_COMPANY = Meeting(id="9104", owner_id="o1", title="Team lunch", starts_at=melbourne(5, 12))


@dataclass
class Meetings:
    """Core's meeting reads, made up."""

    meetings: list[Meeting] = field(default_factory=lambda: [WALK_THROUGH, EARLIER, NO_COMPANY])
    state: MeetingsStatus = field(default_factory=lambda: MeetingsStatus(state="ready"))

    def source(self) -> MeetingSource:
        return MeetingSource(
            upcoming=self.upcoming,
            past=self.past,
            for_company=self.for_company,
            get=self.get,
            status=self.status,
            owner_of=self.owner_of,
        )

    async def upcoming(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        end = START + timedelta(days=days)
        found = [m for m in self.meetings if START <= m.starts_at < end]
        return [m for m in found if owner_id is None or m.owner_id == owner_id]

    async def past(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        return [m for m in self.meetings if m.starts_at < START]

    async def for_company(self, session: AsyncSession, company_id: str) -> list[Meeting]:
        return [m for m in self.meetings if m.company_id == company_id]

    async def get(self, session: AsyncSession, meeting_id: str) -> Meeting | None:
        return next((m for m in self.meetings if m.id == meeting_id), None)

    async def status(self, session: AsyncSession) -> MeetingsStatus:
        return self.state

    async def owner_of(self, session: AsyncSession, user_id: uuid.UUID | None) -> str | None:
        person = await session.get(User, user_id) if user_id is not None else None
        return "o1" if person is not None and person.email.startswith("mia@") else None


type Answer = Callable[[str], BaseModel | None]


class FormClaude:
    """Answers each request with what a function makes of the prompt (so it can cite the facts'
    ids), at a cost, or raises an error. It records every request, and can wait at a gate."""

    def __init__(self, *answers: tuple[Answer, str] | BaseException) -> None:
        self.answers = list(answers)
        self.asked: list[dict[str, Any]] = []
        self.gate: asyncio.Event | None = None
        self.waiting = asyncio.Event()

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
        self.asked.append(
            {
                "system": system,
                "prompt": prompt,
                "form": form,
                "web": web,
                "model": model,
                "effort": effort,
                "max_continues": max_continues,
            }
        )
        self.waiting.set()
        if self.gate is not None:
            await self.gate.wait()
        answer = self.answers.pop(0) if self.answers else (summaries, "0.03")
        if isinstance(answer, BaseException):
            raise answer
        make, cost = answer
        return Reply(
            model=model or "claude-sonnet-5-5",
            stop_reason="end_turn",
            parsed=make(prompt),  # type: ignore[arg-type]
            text="",
            sources=(),
            queries=(),
            usage=Usage(input_tokens=2000, output_tokens=300),
            cost_usd=Decimal(cost),
            request_id=f"req-{len(self.asked)}",
        )


def fact_id(prompt: str, words: str) -> str:
    """The id of the fact whose line holds these words."""
    for line in prompt.splitlines():
        found = re.match(r"(F\d+) ", line)
        if found and words in line:
            return found.group(1)
    raise AssertionError(f"no fact says {words!r}")


def jo(prompt: str) -> str:
    """Jo Sample's mark while names may not go to Claude, or her name while they may."""
    found = re.search(r"(\{person \d+\}|Jo Sample) \(Manager\) is on the meeting", prompt)
    return found.group(1) if found else "Jo Sample"


def summaries(prompt: str) -> FormAnswer:
    """A made-up answer: one sentence for each summary, plus two with no fact behind them."""
    company = "{company}" if "{company}" in prompt else "Sample Logistics Pty Ltd"
    return FormAnswer(
        what_they_do=[
            FormSentence(
                text=f"{company} moves freight across Australia.",
                sources=[fact_id(prompt, "What it does")],
            )
        ],
        what_we_know=[
            FormSentence(text="Their Perth lease ends soon.", sources=[fact_id(prompt, "'Perth'")]),
            FormSentence(text="They want a bigger office.", sources=[]),  # no fact: dropped
            FormSentence(text="They have 900 staff.", sources=["F99"]),  # no such fact: dropped
        ],
        talks_so_far=[
            FormSentence(
                text=f"{jo(prompt)} met us on 2 Nov 2026.",
                sources=[fact_id(prompt, "Meeting on 2 Nov 2026")],
            )
        ],
    )


def other_summaries(prompt: str) -> FormAnswer:
    """A second draft's answer, with new words for each summary."""
    company = "{company}" if "{company}" in prompt else "Sample Logistics Pty Ltd"
    return FormAnswer(
        what_they_do=[
            FormSentence(text=f"{company} runs depots.", sources=[fact_id(prompt, "What it does")])
        ],
        what_we_know=[
            FormSentence(text="Two offices, one lease.", sources=[fact_id(prompt, "'Perth'")])
        ],
        talks_so_far=[
            FormSentence(
                text="One meeting so far.", sources=[fact_id(prompt, "Meeting on 2 Nov 2026")]
            )
        ],
    )


def nothing(prompt: str) -> None:
    """An answer that didn't fit the form."""
    return None


@pytest.fixture
def settings(world: World) -> Iterator[dict[str, Any]]:
    """The settings the routes see: Meetings and call notes on."""
    chosen: dict[str, Any] = {"meeting_forms_enabled": True}
    world.app.dependency_overrides[settings_dependency] = lambda: notes_settings(**chosen)
    yield chosen


@pytest.fixture
def meetings(world: World) -> Meetings:
    made = Meetings()
    world.app.state.meeting_source = made.source()
    return made


@dataclass
class Drafts:
    """The runner the routes use, its fake Claude, and the settings it reads at each draft."""

    runner: MeetingFormRunner
    claude: FormClaude
    chosen: dict[str, Any]


@pytest.fixture
def drafts(world: World, meetings: Meetings) -> Drafts:
    claude = FormClaude()
    chosen: dict[str, Any] = {"meeting_form_cap_usd": Decimal("0.10")}

    async def settings_now(_: AsyncSession) -> Settings:
        return Settings(_env_file=None, **chosen)

    runner = MeetingFormRunner(
        sessions=world.factory,
        claude=lambda: claude,
        meetings=meetings.source(),
        settings=settings_now,
        clock=lambda: world.clock.now,
    )
    world.app.state.meeting_form_runner = runner
    return Drafts(runner, claude, chosen)


async def a_client(world: World) -> None:
    """Sample Logistics (201) as a_company has it, with what it does, its staff, an open deal,
    and a logged call whose note holds a phone number and an email address."""
    await a_company(world)
    async with world.factory() as db:
        company = await db.get(HubSpotCompany, "201")
        assert company is not None
        company.description = "Moves freight across Australia."
        company.employees = 120
        await db.commit()
    await add(
        world,
        deal("d1", "201", "Proposal"),
        HubSpotCall(
            hubspot_id="k1",
            hubspot_company_id="201",
            hubspot_contact_id="c201",
            called_at=START - timedelta(days=10),
            outcome="Connected",
            note="Rang Jo on 0412 345 678. Her email is jo@sample.example.",
        ),
    )


async def started(client: httpx.AsyncClient, status: int = 201, **body: Any) -> dict[str, Any]:
    response = await client.post(FORMS, json=body)
    assert response.status_code == status, response.text
    found: dict[str, Any] = response.json()
    return found


async def form_of(client: httpx.AsyncClient, form: dict[str, Any]) -> dict[str, Any]:
    response = await client.get(f"{FORMS}/{form['id']}")
    assert response.status_code == 200, response.text
    found: dict[str, Any] = response.json()
    return found


# --- A pre-read for a HubSpot meeting -------------------------------------------------------------


async def test_a_pre_read_has_facts_and_three_summaries_that_cite_them(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        first = await started(client, meeting_id="9101")
        await drafts.runner.wait()
        again = await started(client, 200, meeting_id="9101")
        ready = await form_of(client, first)
    assert first["status"] == "drafting" and again["id"] == first["id"]
    assert len(drafts.claude.asked) == 1  # a second start costs nothing
    asked = drafts.claude.asked[0]
    assert (asked["model"], asked["effort"], asked["web"], asked["max_continues"]) == (
        "claude-sonnet-5-5",
        "medium",
        None,
        0,
    )
    assert ready["status"] == "draft" and ready["error"] is None
    assert ready["meeting"] == {
        "meeting_id": "9101",
        "company_key": "201",
        "company_name": "Sample Logistics Pty Ltd",
        "title": "Fit-out walk-through",
        "starts_at": "2026-11-04T23:00:00Z",
        "ends_at": "2026-11-05T00:00:00Z",
        "where": "in_person",
    }
    assert ready["facts"] == [
        {
            "label": "When",
            "value": "Thu 5 Nov 2026, 10:00 am to 11:00 am",
            "source": "HubSpot meeting",
        },
        {
            "label": "Where",
            "value": "In person, Level 3, 120 Sample St, Perth",
            "source": "HubSpot meeting",
        },
        {
            "label": "Who we meet",
            "value": "Jo Sample (Manager); Sam Sample",
            "source": "HubSpot contacts",
        },
        {"label": "Contour people", "value": "Lee Sample", "source": "HubSpot meeting"},
        {"label": "Staff", "value": "About 120", "source": "HubSpot company"},
        {"label": "Offices", "value": "Perth, Canberra", "source": "HubSpot offices"},
        {
            "label": "Lease end",
            "value": day(START.date() + timedelta(days=500)),
            "source": "HubSpot offices",
        },
        {"label": "Deal stage", "value": "Deal d1: Proposal", "source": "HubSpot deal"},
    ]
    said = ready["summaries"]
    # Names go back in. The two sentences with no fact behind them are dropped.
    assert (
        said["what_they_do"]["text"] == "Sample Logistics Pty Ltd moves freight across Australia."
    )
    assert said["what_we_know"]["text"] == "Their Perth lease ends soon."
    assert said["talks_so_far"]["text"] == "Jo Sample met us on 2 Nov 2026."
    assert {said[name]["by"] for name in said} == {"ai"}
    assert [source["label"] for source in said["what_we_know"]["sources"]] == [
        "HubSpot: Perth office"
    ]
    assert [source["label"] for source in said["talks_so_far"]["sources"]] == [
        "HubSpot meeting, 2 Nov 2026"
    ]
    assert (ready["next_step"], ready["going"], Decimal(ready["cost_usd"])) == (
        None,
        None,
        Decimal("0.03"),
    )


async def test_no_contact_detail_or_hidden_name_reaches_claude(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        note = await log_call(client, text="Jo wants to move by mid 2028.")
        await set_note(world, note["id"], status="logged")
        await started(client, meeting_id="9101")
        await drafts.runner.wait()
        drafts.chosen.update(hubspot_names_to_claude_ok=True, call_notes_ai_enabled=True)
        typed = await started(
            client,
            company_key="201",
            title="Lunch",
            starts_at=(START + timedelta(days=2)).isoformat(),
        )
        await drafts.runner.wait()
        typed_form = await form_of(client, typed)
    hidden, named = (asked["prompt"] for asked in drafts.claude.asked)
    for prompt in (hidden, named):
        assert not CONTACT_WORDS.search(prompt), prompt
        assert "[number left out]" in prompt and "[email left out]" in prompt  # the notes, scrubbed
    # Names off: the company and every person we know are hidden, each with their own mark.
    for name in ("Sample Logistics", "Jo Sample", "Sam Sample", "Jo said"):
        assert name not in hidden
    assert "{company}" in hidden and "{person 1}" in hidden and "{person 2}" in hidden
    # Names on: they show. The rep's own call note goes only while Claude may read call notes.
    assert "Sample Logistics Pty Ltd" in named and "Jo Sample (Manager)" not in named  # typed
    assert "Jo wants to move by mid 2028." in named
    assert "Jo wants to move" not in hidden
    assert typed_form["status"] == "draft"


async def test_the_cap_stops_a_second_try_and_the_facts_still_show(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    drafts.claude.answers = [(nothing, "0.12")]  # it didn't fit the form, and it cost US$0.12
    async with signed_in_as(world, "mia", ["companies"]) as client:
        form = await started(client, meeting_id="9101")
        await drafts.runner.wait()
        failed = await form_of(client, form)
    assert len(drafts.claude.asked) == 1  # no second try past the US$0.10 cap
    assert failed["status"] == "failed"
    assert failed["error"] == (
        "This pre-read reached its US$0.10 cap before the summaries were written. Try again, or "
        "ask an admin to raise the cap."
    )
    assert [fact["label"] for fact in failed["facts"]][:2] == ["When", "Where"]
    assert Decimal(failed["cost_usd"]) == Decimal("0.12")


async def test_the_reps_words_stay_through_a_redraft(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    drafts.claude.answers = [(summaries, "0.03"), (other_summaries, "0.03")]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        form = await started(client, meeting_id="9101")
        await drafts.runner.wait()
        drafted = await form_of(client, form)
        edit = {
            "summaries": {"what_they_do": "They run  freight depots.\nThree states."},
            "next_step": "Book a site visit. Ring 0412 345 678.",
            "going": "Lee Sample",
        }
        edited = await client.patch(f"{FORMS}/{form['id']}", json=edit)
        drafts.claude.gate = asyncio.Event()
        again = await client.post(f"{FORMS}/{form['id']}/redraft")
        await asyncio.wait_for(drafts.claude.waiting.wait(), timeout=10)
        twice = await client.post(f"{FORMS}/{form['id']}/redraft")
        drafts.claude.gate.set()
        await drafts.runner.wait()
        redrafted = await form_of(client, form)
    assert edited.status_code == 200, edited.text
    mine = edited.json()["summaries"]["what_they_do"]
    assert mine["text"] == "They run freight depots.\nThree states." and mine["by"] == "person"
    assert mine["sources"] == drafted["summaries"]["what_they_do"]["sources"]  # kept
    assert edited.json()["next_step"] == "Book a site visit. Ring [number left out]."
    assert (again.status_code, again.json()["status"]) == (202, "drafting")
    assert (twice.status_code, twice.json()["code"]) == (409, "form_drafting")
    said = redrafted["summaries"]
    assert said["what_they_do"] == mine  # the rep's own stays
    assert said["what_we_know"]["text"] == "Two offices, one lease."
    assert said["talks_so_far"]["text"] == "One meeting so far."
    assert (redrafted["next_step"], redrafted["going"]) == (
        "Book a site visit. Ring [number left out].",
        "Lee Sample",
    )
    assert Decimal(redrafted["cost_usd"]) == Decimal("0.06")
    async with world.factory() as db:
        row = await db.get(MeetingForm, uuid.UUID(form["id"]))
        assert row is not None and row.version == 3  # one edit and one redraft


def test_the_answer_form_has_no_place_for_the_next_step_or_who_is_going() -> None:
    assert set(FormAnswer.model_fields) == {"what_they_do", "what_we_know", "talks_so_far"}
    schema = FormAnswer.model_json_schema()
    places = set(schema["properties"])
    for part in schema.get("$defs", {}).values():
        places |= set(part.get("properties", {}))
    assert places == {"what_they_do", "what_we_know", "talks_so_far", "text", "sources"}


# --- A typed meeting ------------------------------------------------------------------------------


async def test_a_typed_meeting_gets_a_pre_read_and_shows_in_meetings(
    world: World, settings: dict[str, Any], drafts: Drafts, meetings: Meetings
) -> None:
    await a_client(world)
    meetings.state = MeetingsStatus(
        state="waiting", sentence="Meetings from HubSpot aren't read yet."
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        typed = await started(
            client,
            company_key="201",
            title="Lunch with Jo Sample, jo@sample.example",
            starts_at=(START + timedelta(days=1)).isoformat(),
            where="in_person",
        )
        await drafts.runner.wait()
        ready = await form_of(client, typed)
        listed = (await client.get(f"{API}/meetings")).json()
        counts = (await client.get(f"{API}/meetings/summary")).json()
    assert ready["status"] == "draft"
    assert ready["meeting"]["meeting_id"] is None
    assert ready["meeting"]["title"] == "Lunch with Jo Sample, [email left out]"
    assert ready["facts"][:3] == [
        {"label": "When", "value": "Thu 5 Nov 2026, 8:00 pm", "source": "Typed in"},
        {"label": "Where", "value": "In person", "source": "Typed in"},
        {"label": "Contour people", "value": "Mia", "source": "Typed in"},
    ]
    # HubSpot's meetings aren't read yet, but my typed one shows, marked.
    assert listed["meetings_state"] == "waiting" and listed["total"] == 1
    [item] = listed["items"]
    assert (item["typed"], item["meeting"]["id"], item["group"]) == (True, "", "tomorrow")
    assert item["form"] == {"id": typed["id"], "status": "draft"}
    assert counts == {"need_pre_read": 0, "draft_ready": 1}


# --- Failures -------------------------------------------------------------------------------------


async def test_a_failed_draft_says_why_and_can_be_drafted_again(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    drafts.claude.answers = [ClaudeError("Claude failed", "A made-up error.")]
    async with signed_in_as(world, "mia", ["companies"]) as client:
        form = await started(client, meeting_id="9101")
        await drafts.runner.wait()
        failed = await form_of(client, form)
        await client.post(f"{FORMS}/{form['id']}/redraft")
        await drafts.runner.wait()
        ready = await form_of(client, form)
    assert (failed["status"], failed["error"]) == (
        "failed",
        "Claude couldn't write the summaries. Try again in a minute.",
    )
    assert failed["facts"] and failed["summaries"]["what_they_do"]["text"] == ""
    assert (ready["status"], ready["error"]) == ("draft", None)


async def test_a_shutdown_or_a_restart_leaves_the_form_failed_and_kept(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    drafts.claude.gate = asyncio.Event()
    async with signed_in_as(world, "mia", ["companies"]) as client:
        form = await started(client, meeting_id="9101")
        await asyncio.wait_for(drafts.claude.waiting.wait(), timeout=10)
        await stop_background(world.app)
        stopped = await form_of(client, form)
        left = MeetingForm(
            company_key="201",
            company_name="Sample Logistics Pty Ltd",
            title="Left by a restart",
            starts_at=START + timedelta(days=1),
            status="drafting",
            updated_at=START - timedelta(minutes=10),
        )
        await add(world, left)
        restarted = (await client.get(f"{FORMS}/{left.id}")).json()
    assert (stopped["status"], stopped["error"]) == ("failed", STOPPED)
    assert stopped["facts"]  # kept
    assert (restarted["status"], restarted["error"]) == ("failed", STUCK_ERROR)


async def test_bad_starts_are_refused_in_plain_words(
    world: World, settings: dict[str, Any], drafts: Drafts
) -> None:
    await a_client(world)
    soon = (START + timedelta(days=1)).isoformat()
    async with signed_in_as(world, "mia", ["companies"]) as client:
        both = await client.post(FORMS, json={"meeting_id": "9101", "company_key": "201"})
        no_title = await client.post(FORMS, json={"company_key": "201", "starts_at": soon})
        unknown = await client.post(FORMS, json={"meeting_id": "1234"})
        no_company = await client.post(FORMS, json={"meeting_id": "9104"})
        no_such = await client.post(
            FORMS, json={"company_key": "999", "title": "Lunch", "starts_at": soon}
        )
        missing = await client.get(f"{FORMS}/{uuid.uuid4()}")
        settings.update(meeting_forms_enabled=False)
        off = await client.post(FORMS, json={"meeting_id": "9101"})
    assert both.status_code == no_title.status_code == 422
    for response in (unknown, no_company):
        assert (response.status_code, response.json()["code"]) == (404, "meeting_not_found")
    assert (no_such.status_code, no_such.json()["code"]) == (404, "company_not_found")
    assert (missing.status_code, missing.json()["code"]) == (404, "form_not_found")
    assert (off.status_code, off.json()["code"]) == (409, "meeting_forms_off")
    assert drafts.claude.asked == []
