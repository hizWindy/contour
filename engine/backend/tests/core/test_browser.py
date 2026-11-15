"""The browser and the reader (PLAN-V16 T2-3), against a small test site on this computer.

They drive a real browser (Chrome on this laptop, Playwright's Chromium in a Linux container), so
they are marked `integration` and `browser`, and skip when no browser can start. The test site
answers on 127.0.0.1; "localhost" is the same server under another name, so a request to it is a
request to another host, which the browser must block.
"""

import asyncio
import itertools
import threading
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from core.browser.reader import (
    DailyLimitReached,
    Limits,
    MemoryLedger,
    PageProblem,
    RunLimitReached,
    SiteReader,
    SourcePaused,
)
from core.browser.sites import Site
from core.browser.stops import STOPS
from core.browser.worker import BrowserError, BrowserWorker, NotAllowed

pytestmark = [pytest.mark.integration, pytest.mark.browser]

SIGN_IN_PAGE = (
    "<title>Login Failure</title><body><p>Login Failed! Please re-enter your username and "
    "password.</p><form method='post' action='/login'><input name='login'>"
    "<input name='password' type='password'><button type='submit'>Login</button></form></body>"
)


class LocalSite:
    """A tiny site: plain pages, a sign-in, and one page for each stop rule."""

    def __init__(self) -> None:
        self.hits: list[tuple[str, str, float]] = []  # (host, path, when)
        site = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # quiet
                pass

            def _send(
                self, status: int, body: str = "", headers: dict[str, str] | None = None
            ) -> None:
                data = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                for name, value in (headers or {}).items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:
                host = (self.headers.get("Host") or "").split(":")[0]
                path = urlsplit(self.path).path
                site.hits.append((host, path, time.monotonic()))
                signed_in = "session=1" in (self.headers.get("Cookie") or "")
                port = site.port
                pages = {
                    "/page": (
                        200,
                        f"<title>Page</title><body>Hello. <img src='/pixel.png'>"
                        f"<img src='http://localhost:{port}/other.png'>"
                        f"<script src='http://localhost:{port}/other.js'></script></body>",
                    ),
                    "/captcha": (
                        200,
                        "<title>Check</title><body>Please verify you are human</body>",
                    ),
                    "/locked": (200, "<body>Your account has been locked. Call us.</body>"),
                    "/forbidden": (403, "<body>No</body>"),
                    "/busy": (429, "<body>Slow down</body>"),
                    "/login_fail.htm": (200, SIGN_IN_PAGE),
                }
                if path == "/slow":
                    time.sleep(8)  # longer than the 5-second limit below
                    self._send(200, "<body>Late</body>")
                elif path == "/members" and signed_in:
                    self._send(200, "<title>Members</title><body>Members area</body>")
                elif path in ("/members", "/stuck"):
                    self._send(302, headers={"Location": "/login_fail.htm"})
                elif path in pages:
                    self._send(*pages[path])
                else:
                    self._send(404, "<body>Not here</body>")

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                form = parse_qs(self.rfile.read(length).decode())
                site.hits.append(("127.0.0.1", "POST /login", time.monotonic()))
                if form.get("password") == ["right"]:
                    self._send(
                        302, headers={"Location": "/members", "Set-Cookie": "session=1; Path=/"}
                    )
                else:
                    self._send(302, headers={"Location": "/login_fail.htm"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def seen(self, path: str, host: str = "127.0.0.1") -> int:
        return sum(
            1 for hit_host, hit_path, _ in self.hits if hit_path == path and hit_host == host
        )

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


SITE = Site(
    id="property_daily",
    name="The test site",
    hosts=frozenset({"127.0.0.1"}),
    never_open=("logout",),
    signin_url_marks=("login_fail",),
    signin_text_marks=("please re-enter your username and password",),
)
FAST = Limits(wait_seconds=(0.0, 0.0), per_day=100, per_run=100)


@pytest.fixture
def test_site() -> Iterator[LocalSite]:
    site = LocalSite()
    yield site
    site.close()


@pytest.fixture
async def worker() -> AsyncIterator[BrowserWorker]:
    browser = BrowserWorker(action_seconds=5.0, idle_seconds=60)
    yield browser
    await browser.close()


async def sign_in(reader: SiteReader, password: str = "right") -> None:
    login = f"http://127.0.0.1:{reader.site_port}/login_fail.htm"  # type: ignore[attr-defined]
    fields = {"input[name=login]": "sample", "input[name=password]": password}
    await reader.submit(login, fields, "button[type=submit]")


def make_reader(
    worker: BrowserWorker,
    test_site: LocalSite,
    *,
    limits: Limits = FAST,
    ledger: MemoryLedger | None = None,
    password: str = "right",
) -> tuple[SiteReader, MemoryLedger]:
    book = ledger or MemoryLedger()

    async def signer(reader: SiteReader) -> None:
        await sign_in(reader, password)

    reader = SiteReader(SITE, worker, book, limits, sign_in=signer)
    reader.site_port = test_site.port  # type: ignore[attr-defined]
    return reader, book


@pytest.fixture(autouse=True)
async def a_browser_starts(worker: BrowserWorker, test_site: LocalSite) -> None:
    """Skips the test when no browser can start here (one with no Chrome, say)."""
    try:
        await worker.open(SITE, test_site.url("/nothing"))
    except BrowserError as error:
        pytest.skip(f"no browser can start here: {error}")
    test_site.hits.clear()


# --- Pages, hosts and the pace -----------------------------------------------------------------


async def test_a_page_loads_and_nothing_from_another_host_or_any_image_does(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, ledger = make_reader(worker, test_site)
    seen = await reader.page(test_site.url("/page"), kind="report")
    assert "Hello." in seen.text
    assert test_site.seen("/page") == 1
    assert test_site.seen("/pixel.png") == 0  # an image, even from the site itself
    assert test_site.seen("/other.png", "localhost") == 0  # another host
    assert test_site.seen("/other.js", "localhost") == 0
    assert [(read.kind, read.outcome) for read in ledger.reads] == [("report", "ok")]


async def test_a_missing_page_is_a_good_answer(worker: BrowserWorker, test_site: LocalSite) -> None:
    reader, ledger = make_reader(worker, test_site)
    seen = await reader.page(test_site.url("/no-such-report"), kind="report")
    assert seen.status == 404
    assert ledger.reads[-1].outcome == "not_found"
    assert ledger.reads[-1].ok


async def test_pages_are_spaced_by_the_pause(worker: BrowserWorker, test_site: LocalSite) -> None:
    reader, _ = make_reader(worker, test_site, limits=Limits((0.6, 0.7), 100, 100))
    await reader.page(test_site.url("/page"), kind="report")
    await reader.page(test_site.url("/page"), kind="report")
    first, second = (when for _, path, when in test_site.hits if path == "/page")
    assert second - first >= 0.6


async def test_two_callers_at_once_still_get_one_page_at_a_time(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, _ = make_reader(worker, test_site, limits=Limits((0.5, 0.5), 100, 100))
    await asyncio.gather(*(reader.page(test_site.url("/page"), kind="report") for _ in range(3)))
    times = [when for _, path, when in test_site.hits if path == "/page"]
    assert len(times) == 3
    assert all(later - earlier >= 0.5 for earlier, later in itertools.pairwise(times))


async def test_a_never_open_page_is_refused_before_anything_happens(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, ledger = make_reader(worker, test_site)
    for address in (test_site.url("/logout"), "http://localhost:1/page", "file:///etc/hosts"):
        with pytest.raises(NotAllowed):
            await reader.page(address, kind="report")
    assert test_site.seen("/logout") == 0
    assert ledger.reads == []


# --- The limits --------------------------------------------------------------------------------


async def test_the_daily_limit_stops_before_the_page(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, _ = make_reader(worker, test_site, limits=Limits((0.0, 0.0), 2, 100))
    await reader.page(test_site.url("/page"), kind="report")
    await reader.page(test_site.url("/page"), kind="report")
    with pytest.raises(DailyLimitReached):
        await reader.page(test_site.url("/page"), kind="report")
    assert test_site.seen("/page") == 2


async def test_yesterdays_pages_dont_count_today(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    ledger = MemoryLedger()
    reader, _ = make_reader(worker, test_site, limits=Limits((0.0, 0.0), 1, 100), ledger=ledger)
    await reader.page(test_site.url("/page"), kind="report")
    ledger.reads[0] = type(ledger.reads[0])(
        "property_daily", "report", "ok", 5, datetime.now(UTC) - timedelta(days=1)
    )
    await reader.page(test_site.url("/page"), kind="report")  # a new day: allowed again


async def test_the_run_limit_counts_one_runs_pages_only(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, _ = make_reader(worker, test_site, limits=Limits((0.0, 0.0), 100, 1))
    run, other_run = uuid.uuid4(), uuid.uuid4()
    await reader.page(test_site.url("/page"), kind="search", run_id=run)
    with pytest.raises(RunLimitReached):
        await reader.page(test_site.url("/page"), kind="search", run_id=run)
    await reader.page(test_site.url("/page"), kind="search", run_id=other_run)
    await reader.page(test_site.url("/page"), kind="feed")  # not a run's page
    assert test_site.seen("/page") == 3


# --- The stop rules ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("/captcha", "captcha"),
        ("/locked", "lockout"),
        ("/forbidden", "forbidden"),
        ("/busy", "rate_limited"),
    ],
)
async def test_each_stop_rule_pauses_the_site_for_24_hours(
    worker: BrowserWorker, test_site: LocalSite, path: str, reason: str
) -> None:
    reader, ledger = make_reader(worker, test_site)
    with pytest.raises(SourcePaused) as stopped:
        await reader.page(test_site.url(path), kind="report")
    assert stopped.value.reason == reason
    pause = ledger.pauses["property_daily"]
    assert timedelta(hours=23, minutes=59) < pause.until - datetime.now(UTC) <= timedelta(hours=24)
    assert ledger.problems["property_daily"][0] == reason
    with pytest.raises(SourcePaused):  # nothing more is opened while it is paused
        await reader.page(test_site.url("/page"), kind="report")
    assert test_site.seen("/page") == 0
    ledger.resume("property_daily")  # an Admin resumes it
    await reader.page(test_site.url("/page"), kind="report")


async def test_the_sign_in_page_leads_to_one_sign_in_and_the_page(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, ledger = make_reader(worker, test_site)
    assert reader.signed_in is None
    seen = await reader.page(test_site.url("/members"), kind="report")
    assert "Members area" in seen.text
    assert reader.signed_in is True
    assert "property_daily" in ledger.sign_ins
    assert [read.outcome for read in ledger.reads] == ["signin_page", "ok", "ok"]
    await reader.page(test_site.url("/members"), kind="report")  # the cookie is kept
    assert test_site.seen("POST /login") == 1


async def test_a_wrong_password_is_a_stop_and_is_never_tried_again(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, _ = make_reader(worker, test_site, password="wrong")
    with pytest.raises(SourcePaused) as stopped:
        await reader.page(test_site.url("/members"), kind="report")
    assert stopped.value.reason == "signin_failed"
    assert reader.signed_in is False
    with pytest.raises(SourcePaused):
        await reader.page(test_site.url("/members"), kind="report")
    assert test_site.seen("POST /login") == 1


async def test_the_sign_in_page_again_after_signing_in_is_a_stop(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, _ = make_reader(worker, test_site)
    with pytest.raises(SourcePaused) as stopped:
        await reader.page(test_site.url("/stuck"), kind="report")
    assert stopped.value.reason == "signin_twice"


def test_the_stop_list_is_the_plans() -> None:
    assert {"captcha", "lockout", "forbidden", "rate_limited", "signin_twice"} <= STOPS
    assert "timeout" not in STOPS and "error" not in STOPS


# --- Never fatal -------------------------------------------------------------------------------


async def test_a_hung_page_times_out_is_closed_and_the_next_page_works(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, ledger = make_reader(worker, test_site)
    with pytest.raises(PageProblem) as problem:
        await reader.page(test_site.url("/slow"), kind="report")
    assert problem.value.outcome == "timeout"
    assert "property_daily" not in ledger.pauses  # not a stop
    seen = await reader.page(test_site.url("/page"), kind="report")
    assert "Hello." in seen.text


async def test_a_crashed_browser_never_crashes_the_backend(
    worker: BrowserWorker, test_site: LocalSite
) -> None:
    reader, _ = make_reader(worker, test_site)
    await reader.page(test_site.url("/page"), kind="report")

    async def crash(engine: Any) -> None:
        await engine.playwright.stop()  # the driver and its browser go away at once

    await worker._call(crash)
    seen = await reader.page(test_site.url("/page"), kind="report")  # a new browser
    assert "Hello." in seen.text

    async def fail(engine: Any) -> None:
        raise RuntimeError("something broke inside the browser thread")

    with pytest.raises(BrowserError):
        await worker._call(fail)
    seen = await reader.page(test_site.url("/page"), kind="report")
    assert "Hello." in seen.text


async def test_the_browser_closes_when_idle_and_starts_again(test_site: LocalSite) -> None:
    worker = BrowserWorker(action_seconds=5.0, idle_seconds=0.5)
    try:
        reader, _ = make_reader(worker, test_site)
        await reader.page(test_site.url("/page"), kind="report")
        assert worker.running
        for _ in range(40):
            if not worker.running:
                break
            await asyncio.sleep(0.1)
        assert not worker.running
        seen = await reader.page(test_site.url("/page"), kind="report")
        assert "Hello." in seen.text
    finally:
        await worker.close()
