"""The morning pre-reads (PLAN-V17 T2-13), with made-up meetings and a fake Claude:

- which meetings it picks: client meetings from now to the end of the window (2 working days from
  a Friday: the weekend, Monday and Tuesday), not cancelled, with no pre-read yet;
- it drafts each meeting once, and the rep gets one email for each draft, with a link;
- it stops at the daily limit;
- no rep, or no email set up: no email, and the pre-read still shows;
- the weekend is skipped, it waits to be switched on, and it says what a morning costs.

Made-up companies and people only (Sample Logistics Pty Ltd, Lee Sample).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.companies.jobs import JOBS
from apps.companies.meeting_form import FormAnswer, FormSentence, MeetingFormRunner
from apps.companies.meeting_job import (
    MEETING_FORMS,
    draft_morning,
    estimate_meeting_forms,
    pick_meetings,
    start_meeting_forms,
)
from apps.companies.meeting_store import MeetingSource, no_rep
from apps.companies.tables import MeetingForm
from core.claude.daily import DailyLimitReached
from core.config import Settings
from core.email.sender import LogSender
from core.hubspot.meetings import Meeting, MeetingsStatus
from core.schedules.jobs import JobContext, JobSkipped
from tests.companies.helpers import add
from tests.companies.test_call_notes_api import a_company
from tests.companies.test_meeting_form import FormClaude
from tests.core.auth_world import World

pytestmark = pytest.mark.integration
MELBOURNE = timedelta(hours=11)  # summer time
SITE = "https://hq.contour.example"


def melbourne(day: int, hour: int, minute: int = 0) -> datetime:
    """A Melbourne summer time in Nov 2026, as UTC."""
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC) - MELBOURNE


FRIDAY = melbourne(6, 6, 40)  # the job's time on Friday 6 Nov 2026


def meeting(
    meeting_id: str, company_id: str | None, owner_id: str, at: datetime, **more: Any
) -> Meeting:
    return Meeting(
        id=meeting_id,
        company_id=company_id,
        owner_id=owner_id,
        title=more.pop("title", f"Meeting {meeting_id}"),
        starts_at=at,
        ends_at=at + timedelta(hours=1),
        **more,
    )


MEETINGS = [
    meeting("9201", "201", "o1", melbourne(6, 14), title="Walk-through <b>&</b> chat"),
    meeting("9202", "202", "o2", melbourne(9, 10)),  # Monday, Sam's: he has no rep yet
    meeting("9203", "201", "o1", melbourne(10, 16)),  # Tuesday
    meeting("9204", "201", "o1", melbourne(11, 9)),  # Wednesday: after the window
    meeting("9205", "201", "o1", melbourne(9, 11)),  # it has a pre-read already
    meeting("9206", "202", "o2", melbourne(9, 12), outcome="canceled"),
    meeting("9207", None, "o1", melbourne(9, 13)),  # no company: not a client meeting
    meeting("9208", "201", "o1", melbourne(6, 6)),  # it started before the job
    meeting("9209", "201", "o1", melbourne(7, 10)),  # a Saturday meeting, inside the window
]


@dataclass
class Morning:
    """Made-up meetings read from FRIDAY, and one rep: Lee Sample for owner o1."""

    meetings: list[Meeting] = field(default_factory=lambda: list(MEETINGS))
    state: MeetingsStatus = field(default_factory=lambda: MeetingsStatus(state="ready"))
    reps: dict[str, tuple[str, str]] = field(
        default_factory=lambda: {"o1": ("Lee Sample", "lee@contour.example")}
    )

    def source(self, *, with_reps: bool = True) -> MeetingSource:
        return MeetingSource(
            upcoming=self.upcoming,
            past=self.none,
            for_company=self.for_company,
            get=self.get,
            status=self.status,
            rep_of_owner=self.rep_of_owner if with_reps else no_rep,
        )

    async def upcoming(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        end = FRIDAY + timedelta(days=days)
        return [m for m in self.meetings if FRIDAY <= m.starts_at < end]

    async def none(
        self, session: AsyncSession, *, owner_id: str | None, days: int
    ) -> list[Meeting]:
        return []

    async def for_company(self, session: AsyncSession, company_id: str) -> list[Meeting]:
        return [m for m in self.meetings if m.company_id == company_id]

    async def get(self, session: AsyncSession, meeting_id: str) -> Meeting | None:
        return next((m for m in self.meetings if m.id == meeting_id), None)

    async def status(self, session: AsyncSession) -> MeetingsStatus:
        return self.state

    async def rep_of_owner(self, session: AsyncSession, owner_id: str) -> tuple[str, str] | None:
        return self.reps.get(owner_id)


def plain(prompt: str) -> FormAnswer:
    """A made-up answer that cites the first fact, which every pack has."""
    return FormAnswer(
        what_they_do=[FormSentence(text="A client of ours.", sources=["F1"])],
        what_we_know=[],
        talks_so_far=[],
    )


def morning_settings(**changes: Any) -> Settings:
    values: dict[str, Any] = {
        "meeting_forms_enabled": True,
        "meeting_form_days_ahead": 2,
        "app_url": SITE,
        "internal_email_domains": ["contour.example"],
    }
    values.update(changes)
    return Settings(_env_file=None, **values)


@dataclass
class Setup:
    meetings: Morning
    claude: FormClaude
    emails: LogSender


def set_up(world: World, *answers: Any, with_reps: bool = True) -> Setup:
    """The app's meeting reads, its pre-read runner with a fake Claude, and an email sender that
    keeps what it would send."""
    made = Morning()
    claude = FormClaude(*answers) if answers else FormClaude(*[(plain, "0.03")] * 10)
    emails = LogSender()
    world.clock.now = FRIDAY
    world.app.state.meeting_source = made.source(with_reps=with_reps)
    world.app.state.email_sender = emails

    async def settings_now(_: AsyncSession) -> Settings:
        return morning_settings()

    world.app.state.meeting_form_runner = MeetingFormRunner(
        sessions=world.factory,
        claude=lambda: claude,
        meetings=world.app.state.meeting_source,
        settings=settings_now,
        clock=lambda: world.clock.now,
    )
    return Setup(made, claude, emails)


async def a_pre_read_for_9205(world: World) -> None:
    await add(
        world,
        MeetingForm(
            meeting_id="9205",
            company_key="201",
            company_name="Sample Logistics Pty Ltd",
            title="Meeting 9205",
            starts_at=melbourne(9, 11),
            status="draft",
        ),
    )


async def forms(world: World) -> list[MeetingForm]:
    async with world.factory() as db:
        return list(await db.scalars(select(MeetingForm).order_by(MeetingForm.starts_at)))


# --- Which meetings, once each, and one email each ----------------------------------------------


async def test_the_morning_picks_client_meetings_in_the_next_working_days(world: World) -> None:
    await a_company(world)
    await a_pre_read_for_9205(world)
    setup = set_up(world)
    async with world.factory() as db:
        picked = await pick_meetings(db, world.app.state.meeting_source, morning_settings(), FRIDAY)
        setup.meetings.state = MeetingsStatus(state="waiting", sentence="Not read yet.")
        waiting = await pick_meetings(
            db, world.app.state.meeting_source, morning_settings(), FRIDAY
        )
    # Friday afternoon, the Saturday meeting, Monday and Tuesday: in time order.
    assert [(m.id, name) for m, name in picked] == [
        ("9201", "Sample Logistics Pty Ltd"),
        ("9209", "Sample Logistics Pty Ltd"),
        ("9202", "Sample Freight Pty Ltd"),
        ("9203", "Sample Logistics Pty Ltd"),
    ]
    assert waiting == []


async def test_each_meeting_is_drafted_once_and_its_rep_gets_one_email(world: World) -> None:
    await a_company(world)
    await a_pre_read_for_9205(world)
    setup = set_up(world)
    first = await draft_morning(world.app, morning_settings(), FRIDAY)
    again = await draft_morning(world.app, morning_settings(), FRIDAY)
    made = {form.meeting_id: form for form in await forms(world)}
    assert (first.drafted, first.failed, first.emailed, first.stopped) == (4, 0, 3, None)
    assert first.spent_usd == Decimal("0.12")
    assert (again.drafted, again.emailed) == (0, 0)  # every meeting has its pre-read now
    assert len(setup.claude.asked) == 4
    for meeting_id in ("9201", "9209", "9202", "9203"):
        form = made[meeting_id]
        assert (form.status, form.trigger, form.made_by) == ("draft", "job", None)
    # One email for each draft whose owner has a rep: Lee (o1) has three, Sam (o2) none yet.
    assert [email.to for email in setup.emails.sent] == [["lee@contour.example"]] * 3
    email = setup.emails.sent[0]
    assert email.subject == "Your pre-read for Sample Logistics Pty Ltd is ready"
    link = f"{SITE}/companies/meetings/{made['9201'].id}"
    assert email.text.startswith("Hi Lee,\n\nYour pre-read for the meeting with Sample Logistics")
    assert link in email.text
    assert email.html is not None and f'href="{link}"' in email.html
    assert "Walk-through &lt;b&gt;&amp;&lt;/b&gt; chat" in email.html  # escaped
    assert "<b>" not in email.html


async def test_it_stops_at_the_daily_limit(world: World) -> None:
    await a_company(world)
    await a_pre_read_for_9205(world)
    limit = DailyLimitReached(
        cap=Decimal(150), spent=Decimal(150), held=Decimal(0), needed=Decimal("0.01")
    )
    setup = set_up(world, limit)
    morning = await draft_morning(world.app, morning_settings(), FRIDAY)
    made = await forms(world)
    assert morning.stopped == "It stopped at the daily limit for all Claude spending."
    assert (morning.drafted, len(setup.claude.asked)) == (0, 1)
    assert [(form.meeting_id, form.status) for form in made if form.trigger == "job"] == [
        ("9201", "failed")
    ]
    assert setup.emails.sent == []


async def test_no_rep_or_no_email_means_no_email_and_the_pre_read_still_shows(
    world: World,
) -> None:
    await a_company(world)
    await a_pre_read_for_9205(world)
    setup = set_up(world, with_reps=False)  # until M5 nobody's account is linked to an owner
    nobody = await draft_morning(world.app, morning_settings(), FRIDAY)
    assert (nobody.drafted, nobody.emailed, setup.emails.sent) == (4, 0, [])

    # A rep, but email isn't set up: still no email, and the pre-reads are there.
    await world_reset(world)
    setup = set_up(world)
    del world.app.state.email_sender
    not_set_up = morning_settings(email_provider="resend")  # with no key: not set up
    unsent = await draft_morning(world.app, not_set_up, FRIDAY)
    assert (unsent.drafted, unsent.emailed) == (4, 0)
    assert {form.status for form in await forms(world) if form.trigger == "job"} == {"draft"}


async def test_the_ready_email_goes_to_a_contour_address_only(world: World) -> None:
    """It names the client and the meeting, so like a pre-read it goes to a Contour address
    only: a rep whose account has another address gets no email, and the pre-read still
    shows."""
    await a_company(world)
    await a_pre_read_for_9205(world)
    setup = set_up(world)
    setup.meetings.reps["o1"] = ("Lee Sample", "lee@mail.example")
    morning = await draft_morning(world.app, morning_settings(), FRIDAY)
    assert (morning.drafted, morning.emailed, setup.emails.sent) == (4, 0, [])
    assert {form.status for form in await forms(world) if form.trigger == "job"} == {"draft"}


async def world_reset(world: World) -> None:
    """The job's pre-reads gone, so the same meetings can be drafted again."""
    async with world.factory() as db:
        for form in await db.scalars(select(MeetingForm).where(MeetingForm.trigger == "job")):
            await db.delete(form)
        await db.commit()


# --- The schedule ---------------------------------------------------------------------------------


async def test_it_skips_the_weekend_and_waits_to_be_switched_on(world: World) -> None:
    set_up(world)
    saturday = JobContext(
        app=world.app, schedule_id=uuid.uuid4(), settings={}, now=melbourne(7, 6, 40)
    )
    with pytest.raises(JobSkipped, match="weekend"):
        await start_meeting_forms(saturday)
    friday = JobContext(app=world.app, schedule_id=saturday.schedule_id, settings={}, now=FRIDAY)
    with pytest.raises(JobSkipped, match="switched off"):
        await start_meeting_forms(friday)  # Meetings are off by default
    [spec] = [spec for spec in JOBS if spec.key == MEETING_FORMS]
    assert spec.default is not None and spec.default.enabled is False
    assert spec.default.cadence.at == time(6, 40)


async def test_the_estimate_says_what_a_morning_costs(world: World) -> None:
    await a_company(world)
    await a_pre_read_for_9205(world)
    set_up(world)
    context = JobContext(app=world.app, schedule_id=uuid.uuid4(), settings={}, now=FRIDAY)
    estimate = await estimate_meeting_forms(context)
    # Four client meetings to draft, at about US$0.03 each, and at most US$0.10 each.
    assert (estimate.typical_usd, estimate.worst_usd) == (Decimal("0.12"), Decimal("0.40"))
    assert estimate.problem == "Meetings and pre-reads are switched off in Admin, Settings."
    assert estimate.basis.startswith("About US$0.03 a pre-read (TBC), for 4 client meetings")
