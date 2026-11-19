"""The afternoon reminder about calls not sent yet (PLAN-V23 T2-3, choice 10), with made-up people
and notes and an email service that keeps what it would send:

- it emails each person with calls waiting in To confirm, once a day, with a link to Call logs,
  and nobody else: no calls waiting, someone else's, an account that can't sign in, one without
  Call logs, or an address that isn't a Contour one;
- with email off (no email service, or the log sender) it sends nothing, and the log says why;
- the schedule: off until switched on, at 4:30 pm, weekdays only, and free.

Made-up people only (Mia Sample, Lee Sample).
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from decimal import Decimal
from typing import Any

import pytest

from apps.companies.calls_nudge import (
    CALLS_NUDGE,
    EMAIL_OFF,
    JOB,
    LOG_ONLY,
    NO_SERVICE,
    Nudged,
    estimate_calls_nudge,
    nudge,
    sender_or_why,
    start_calls_nudge,
)
from apps.companies.jobs import JOBS
from core.auth import admin
from core.auth.models import User
from core.config import Settings
from core.email.sender import Email, LogSender, Provider, Sent
from core.prefs.models import Setting
from core.schedules.jobs import JobContext, JobSkipped
from tests.companies.helpers import add
from tests.companies.test_call_notes_history import a_note
from tests.companies.test_meetings_api import melbourne
from tests.core.auth_world import FAST, GOOD, World

pytestmark = pytest.mark.integration
SITE = "https://hq.contour.example"
THURSDAY = melbourne(5, 16, 30)  # 4:30 pm on Thursday 5 Nov 2026, Melbourne time
CALL_LOGS = f"{SITE}/assistant/call-logs"


@dataclass
class KeptSender:
    """An email service that is on: it keeps each email and its key, and sends nothing."""

    provider: Provider = "resend"
    sent: list[tuple[Email, str]] = field(default_factory=list)

    async def deliver(self, email: Email, key: str) -> Sent:
        self.sent.append((email, key))
        return Sent(provider="resend", id=key, to_count=len(email.to))


def nudge_settings(**changes: Any) -> Settings:
    values: dict[str, Any] = {
        "call_notes_enabled": True,
        "app_url": SITE,
        "internal_email_domains": ["example.test"],
    }
    values.update(changes)
    return Settings(_env_file=None, **values)


async def someone(
    world: World,
    login: str,
    *,
    features: Sequence[str] = ("companies.call_logs",),
    email: str | None = None,
    active: bool = True,
) -> uuid.UUID:
    """An account, named like "Mia Sample", at login@example.test unless `email` says."""
    async with world.factory() as db:
        user = await admin.create_person(
            db,
            email=email or f"{login}@example.test",
            username=login,
            name=f"{login.title()} Sample",
            role="staff",
            features=list(features),
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )
        if not active:
            row = await db.get(User, user.id)
            assert row is not None
            row.active = False
            await db.commit()
        return user.id


def context(world: World, now: datetime) -> JobContext:
    return JobContext(app=world.app, schedule_id=uuid.uuid4(), settings={}, now=now)


async def calls_waiting(
    world: World, *makers: uuid.UUID | None, status: str = "to_confirm"
) -> None:
    at = THURSDAY - timedelta(hours=2)
    await add(world, *(a_note(maker, at, "Rang them", status=status) for maker in makers))


# --- Who gets it, and how often -------------------------------------------------------------------


async def test_it_emails_each_person_with_calls_waiting_once_a_day(world: World) -> None:
    mia = await someone(world, "mia")
    lee = await someone(world, "lee")
    kim = await someone(world, "kim", features=["companies.companies"])  # no Call logs
    ana = await someone(world, "ana", email="ana@elsewhere.example")  # not a Contour address
    old = await someone(world, "old", active=False)  # can't sign in
    await calls_waiting(world, mia)
    await calls_waiting(world, mia, status="sorting")  # still being sorted: it waits for Mia too
    await calls_waiting(world, mia, lee, status="logged")  # in HubSpot already
    await calls_waiting(world, mia, status="failed")  # sent, and needs a look: not "not sent"
    await calls_waiting(world, kim, ana, old, None)
    emails = KeptSender()

    first = await nudge(world.app, nudge_settings(), emails, THURSDAY)
    again = await nudge(world.app, nudge_settings(), emails, THURSDAY + timedelta(minutes=5))

    assert first == Nudged(emailed=1, skipped=0, failed=0)
    assert again == Nudged(emailed=0, skipped=1, failed=0)  # once a day a person
    [(email, key)] = emails.sent
    assert email.to == ["mia@example.test"]
    assert email.subject == "2 calls aren't in HubSpot yet"
    assert email.text == (
        f"Hi Mia,\n\n2 calls aren't in HubSpot yet. Check them and send them from Call logs:\n"
        f"{CALL_LOGS}\n"
    )
    assert email.html is not None and f'href="{CALL_LOGS}"' in email.html
    assert "Sample Logistics" not in email.text  # no client is named
    assert key == f"calls-nudge:{mia}:2026-11-05"

    friday = await nudge(world.app, nudge_settings(), emails, THURSDAY + timedelta(days=1))
    assert friday.emailed == 1 and emails.sent[-1][1] == f"calls-nudge:{mia}:2026-11-06"


async def test_one_call_waiting_reads_as_one(world: World) -> None:
    mia = await someone(world, "mia")
    await calls_waiting(world, mia)
    emails = KeptSender()
    await nudge(world.app, nudge_settings(), emails, THURSDAY)
    [(email, _)] = emails.sent
    assert email.subject == "1 call isn't in HubSpot yet"
    assert "1 call isn't in HubSpot yet." in email.text


async def test_nobody_with_calls_waiting_gets_nothing(world: World) -> None:
    mia = await someone(world, "mia")
    await calls_waiting(world, mia, status="logged")
    emails = KeptSender()
    assert await nudge(world.app, nudge_settings(), emails, THURSDAY) == Nudged()
    assert emails.sent == []


# --- With email off -------------------------------------------------------------------------------


async def test_with_email_off_it_sends_nothing_and_logs_why(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    mia = await someone(world, "mia")
    await calls_waiting(world, mia)
    await add(world, Setting(key="call_notes_enabled", value=True))
    the_log = LogSender()  # the laptop's: it writes an email to the log and sends nothing
    world.app.state.email_sender = the_log

    with (
        caplog.at_level(logging.INFO, logger="apps.companies.calls_nudge"),
        pytest.raises(JobSkipped) as skipped,
    ):
        await start_calls_nudge(context(world, THURSDAY))

    assert skipped.value.reason == EMAIL_OFF
    assert the_log.sent == []
    [line] = [record for record in caplog.records if record.getMessage() == "calls_nudge_not_sent"]
    assert getattr(line, "why", None) == LOG_ONLY
    # No email service at all: the same, for its own reason.
    world.app.state.email_sender = None
    no_key = nudge_settings(email_provider="resend")  # a service with no key isn't set up
    assert sender_or_why(world.app, no_key) == NO_SERVICE
    assert sender_or_why(world.app, nudge_settings()) == LOG_ONLY


# --- The schedule ---------------------------------------------------------------------------------


async def test_the_schedule_is_off_until_switched_on_at_4_30_on_weekdays_and_free(
    world: World,
) -> None:
    [spec] = [spec for spec in JOBS if spec.key == CALLS_NUDGE]
    assert spec is JOB and spec.default is not None
    assert spec.default.enabled is False and spec.default.cadence.at == time(16, 30)
    with pytest.raises(JobSkipped, match="weekend"):
        await start_calls_nudge(context(world, melbourne(7, 16, 30)))  # a Saturday
    with pytest.raises(JobSkipped, match="Call notes are switched off"):
        await start_calls_nudge(context(world, THURSDAY))  # call notes are off to start
    estimate = await estimate_calls_nudge(context(world, THURSDAY))
    assert (estimate.typical_usd, estimate.worst_usd, estimate.cap_usd) == (Decimal(0),) * 3


async def test_a_start_on_a_weekday_emails_in_the_background(world: World) -> None:
    # A start reads the settings in use, so the address is at Contour's own domain.
    mia = await someone(world, "mia", email="mia.sample@contourinteriors.com.au")
    await calls_waiting(world, mia)
    await add(world, Setting(key="call_notes_enabled", value=True))
    emails = KeptSender()
    world.app.state.email_sender = emails

    started = await start_calls_nudge(context(world, THURSDAY))
    await world.app.state.calls_nudge["task"]

    assert started.ref == "calls-nudge:2026-11-05"
    assert [email.to for email, _ in emails.sent] == [["mia.sample@contourinteriors.com.au"]]
