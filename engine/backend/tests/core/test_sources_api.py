"""Admin's Sources routes, the Health rows and the logins kept secret (PLAN-V16 T2-8).

The live check is a fake (no browser). Every login here is made up.
"""

import logging
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.api.app import create_app
from core.browser.reader import SourcePaused
from core.browser.stops import Seen
from core.config import Settings, get_settings
from core.db.engine import get_session
from core.health.checks import SourceFacts, property_daily_finding
from core.logs import redact
from core.prefs.models import Setting
from core.sources import service, store

pytestmark = pytest.mark.integration

SOURCES = "/api/v1/sources"
NOW = datetime.now(UTC)
SECRET_USER = "pd-user-secret-1"
SECRET_PASSWORD = "pd-pass-secret-2"


@dataclass
class FakeSources:
    """Stands in for the browser: `check` succeeds or raises what it is given."""

    raises: Exception | None = None
    checks: int = 0
    tasks: dict[str, object] = field(default_factory=dict)
    signed_in: bool | None = None

    async def check(self, settings: Settings) -> Seen:
        self.checks += 1
        if self.raises is not None:
            raise self.raises
        self.signed_in = True
        return Seen(status=200, url="https://www.spatialgroup.com.au/", title="Home", text="Hi")

    async def pages_today(self, session: AsyncSession, source: str) -> int:
        return 3

    async def close(self) -> None:
        pass


@pytest.fixture
def fake() -> Iterator[FakeSources]:
    sources = FakeSources()
    service.set_sources(sources)  # type: ignore[arg-type]
    yield sources
    service.set_sources(None)


@pytest.fixture
def logins(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("PROPERTY_DAILY_USERNAME", SECRET_USER)
    monkeypatch.setenv("PROPERTY_DAILY_PASSWORD", SECRET_PASSWORD)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def app(session_factory: async_sessionmaker[AsyncSession]) -> FastAPI:
    created = create_app()

    async def test_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    created.dependency_overrides[get_session] = test_session
    return created


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as test_client:
        yield test_client


async def switch_on(session: AsyncSession) -> None:
    session.add(Setting(key="property_daily_enabled", value=True))
    await session.commit()


async def test_the_list_has_both_tools_and_arealytics_isnt_connected(
    client: httpx.AsyncClient, fake: FakeSources
) -> None:
    response = await client.get(SOURCES)
    assert response.status_code == 200, response.text
    items = {item["id"]: item for item in response.json()["items"]}
    assert set(items) == {"property_daily", "arealytics"}
    daily = items["property_daily"]
    assert (daily["connected"], daily["on"], daily["signed_in"]) == (True, False, None)
    assert (daily["pages_today"], daily["pages_limit"], daily["records"]) == (3, 300, 0)
    assert daily["paused_until"] is None and daily["last_problem"] is None
    areal = items["arealytics"]
    assert (areal["connected"], areal["on"]) == (False, False)
    assert "refused automated access" in areal["last_problem"]


async def test_check_and_resume_say_no_for_arealytics_and_for_a_tool_that_is_off(
    client: httpx.AsyncClient, fake: FakeSources
) -> None:
    for path in ("check", "resume"):
        response = await client.post(f"{SOURCES}/arealytics/{path}")
        assert response.status_code == 409
        assert response.json()["code"] == "not_connected"
    response = await client.post(f"{SOURCES}/property_daily/check")
    assert response.status_code == 409
    assert response.json()["detail"] == service.OFF_SENTENCE
    assert fake.checks == 0
    assert (await client.post(f"{SOURCES}/somewhere/check")).status_code == 422


async def test_a_check_signs_in_and_a_blocked_one_shows_its_problem_in_words(
    client: httpx.AsyncClient,
    fake: FakeSources,
    session: AsyncSession,
    logins: None,
    caplog: pytest.LogCaptureFixture,
) -> None:
    await switch_on(session)
    caplog.set_level(logging.DEBUG)
    response = await client.post(f"{SOURCES}/property_daily/check")
    assert response.status_code == 200, response.text
    assert response.json()["signed_in"] is True and fake.checks == 1

    fake.raises = SourcePaused("captcha", NOW + timedelta(hours=24))
    ledger = store.DbLedger(async_sessionmaker(session.bind))
    await ledger.problem("property_daily", "captcha", NOW)
    response = await client.post(f"{SOURCES}/property_daily/check")
    assert response.status_code == 200
    assert response.json()["last_problem"].startswith("The site asked for a person-check")
    for text in (response.text, (await client.get(SOURCES)).text, caplog.text):
        assert SECRET_USER not in text and SECRET_PASSWORD not in text


async def test_resume_lifts_the_pause(
    client: httpx.AsyncClient, fake: FakeSources, session: AsyncSession, logins: None
) -> None:
    await switch_on(session)
    ledger = store.DbLedger(async_sessionmaker(session.bind))
    await ledger.pause("property_daily", "rate_limited", NOW + timedelta(hours=24))
    listed = (await client.get(SOURCES)).json()["items"][0]
    assert listed["paused_until"] is not None
    blocked = await client.post(f"{SOURCES}/property_daily/check")
    assert blocked.status_code == 409 and "paused until" in blocked.json()["detail"]
    response = await client.post(f"{SOURCES}/property_daily/resume")
    assert response.status_code == 200 and response.json()["paused_until"] is None


def test_the_logins_never_reach_a_log_line(logins: None) -> None:
    line = f"signing in as {SECRET_USER} with {SECRET_PASSWORD}"
    assert SECRET_USER not in redact(line) and SECRET_PASSWORD not in redact(line)


def facts(**values: object) -> SourceFacts:
    base: dict[str, object] = {
        "on": True,
        "has_login": True,
        "paused_until": None,
        "pause_words": None,
        "problem_words": None,
        "problem_at": None,
        "last_read": NOW - timedelta(hours=2),
        "pages_today": 14,
        "pages_limit": 300,
        "records": 120,
    }
    return SourceFacts(**{**base, **values})  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("values", "state", "words"),
    [
        ({"on": False}, "off", "switched off"),
        ({"has_login": False}, "problem", "no login"),
        (
            {"paused_until": NOW + timedelta(hours=3), "pause_words": "The site asked."},
            "problem",
            "Paused until",
        ),
        ({"problem_words": "A page didn't load.", "problem_at": NOW}, "problem", "didn't load"),
        ({}, "ok", "14 of 300 pages today"),
        ({"last_read": None}, "ok", "not read yet"),
    ],
)
def test_the_health_row_for_property_daily(
    values: dict[str, object], state: str, words: str
) -> None:
    finding = property_daily_finding(facts(**values), NOW)
    assert finding.state == state
    assert words in finding.sentence
