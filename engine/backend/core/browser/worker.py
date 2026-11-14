"""One headless browser in a thread of its own (PLAN-V16 T2-3).

**Why a thread.** On Windows the backend runs on the selector event loop (psycopg needs it), and
that loop can't start another program, such as a browser. So the browser lives in one worker
thread with an event loop of its own (the proactor loop on Windows), and the backend sends it work
with `asyncio.run_coroutine_threadsafe`. The same code runs on the server.

**What it keeps.** One browser, started when the first page is asked for and closed after
`idle_seconds` with nothing to do. One context for each site (its own cookies), and one page in
it, so a site gets one page at a time. Each context loads the site's own hosts only, and no image,
font or video. A site's signed-in state is kept in memory, and in a temp folder made for this
process (so after a restart the connector signs in again). It is never logged.

**Never fatal.** Every action has a time limit, and a page that hangs is closed. A browser that
crashes or is closed is started again at the next page. An error inside the thread comes back to
the caller as an exception; it never reaches the backend's own loop.

**Which browser.** Playwright's own Chromium, at the version in `uv.lock`. On Windows (this
laptop) Application Control blocks that Chromium, so there the installed Chrome is used instead
(`browser_channel`, "auto"). Each start gets a fresh, empty profile: never a person's own.
"""

import asyncio
import contextlib
import logging
import shutil
import sys
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Literal, TypeVar

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    Request,
    Route,
    async_playwright,
)
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeout

from core.browser.sites import Site
from core.browser.stops import Seen

log = logging.getLogger(__name__)

T = TypeVar("T")
Channel = Literal["auto", "chromium", "chrome", "msedge"]
BLOCKED_KINDS = frozenset({"image", "font", "media"})
ACTION_SECONDS = 30.0  # every browser action
IDLE_SECONDS = 300.0  # the browser closes after 5 minutes with nothing to do
LAUNCH_SECONDS = 60.0  # starting the browser
GRACE_SECONDS = 5.0
# The most one piece of work may take, as the backend sees it: a start, then up to four actions
# (a sign-in opens a page, fills two fields and sends the form). Playwright's own time limits
# end a slow action first; this is the last guard, for a thread that stopped answering.
STEPS_PER_WORK = 4


class BrowserError(Exception):
    """The browser couldn't do it. The message is for the log, never for a person."""


class PageTimeout(BrowserError):
    """A page took longer than its time limit. The page was closed."""


class NotAllowed(BrowserError):
    """The address isn't on the site's own hosts, or is on its never-open list."""


def _browser_gone(error: Exception) -> bool:
    """True when the browser or its driver is gone (Playwright's TargetClosedError)."""
    return type(error).__name__ == "TargetClosedError" or "has been closed" in str(error)


def launch_channel(channel: Channel) -> str | None:
    """The browser to start: None is Playwright's own Chromium."""
    if channel == "auto":
        return "chrome" if sys.platform == "win32" else None
    return None if channel == "chromium" else channel


class BrowserWorker:
    """The backend's handle on the browser thread. Safe to share; one per process."""

    def __init__(
        self,
        *,
        channel: Channel = "auto",
        action_seconds: float = ACTION_SECONDS,
        idle_seconds: float = IDLE_SECONDS,
    ) -> None:
        self.channel = channel
        self.action_seconds = action_seconds
        self.idle_seconds = idle_seconds
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._engine: _Engine | None = None

    # --- What the backend calls ------------------------------------------------------------

    async def open(self, site: Site, url: str) -> Seen:
        """Opens one address in the site's page, and says what it showed."""
        if not site.may_open(url):
            raise NotAllowed(f"{site.id} may not open this address")
        return await self._call(lambda engine: engine.open(site, url))

    async def fill_and_submit(
        self, site: Site, url: str, fields: Mapping[str, str], submit: str
    ) -> Seen:
        """Opens `url`, types each value into its field (by selector), presses `submit`, and says
        what the next page showed. For a sign-in: the values are never logged or kept."""
        if not site.may_open(url):
            raise NotAllowed(f"{site.id} may not open this address")
        return await self._call(lambda engine: engine.fill_and_submit(site, url, fields, submit))

    async def save_signed_in(self, site: Site) -> None:
        """Keeps the site's signed-in state in the temp folder, for the next browser start."""
        await self._call(lambda engine: engine.save_state(site))

    async def forget(self, site: Site) -> None:
        """Drops the site's cookies and its saved state: the next page starts signed out."""
        await self._call(lambda engine: engine.forget(site))

    @property
    def running(self) -> bool:
        """True while a browser is open (it closes itself when idle)."""
        return self._engine is not None and self._engine.browser is not None

    async def close(self) -> None:
        """Closes the browser and ends the thread. For the backend's shutdown and the tests."""
        loop, thread, engine = self._loop, self._thread, self._engine
        if loop is None or thread is None or engine is None:
            return
        with contextlib.suppress(Exception):
            done = asyncio.run_coroutine_threadsafe(engine.shutdown(), loop)
            await asyncio.wait_for(asyncio.wrap_future(done), self.action_seconds)
        loop.call_soon_threadsafe(loop.stop)
        await asyncio.to_thread(thread.join, self.action_seconds)
        self._loop = self._thread = self._engine = None

    # --- The thread ------------------------------------------------------------------------

    def _ensure_thread(self) -> tuple[asyncio.AbstractEventLoop, "_Engine"]:
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive() and self._loop is not None:
                assert self._engine is not None
                return self._loop, self._engine
            ready = threading.Event()
            holder: dict[str, asyncio.AbstractEventLoop] = {}

            def main() -> None:
                # The proactor loop on Windows can start a program; the selector loop can't.
                loop: asyncio.AbstractEventLoop = (
                    asyncio.ProactorEventLoop()
                    if sys.platform == "win32"
                    else asyncio.new_event_loop()
                )
                asyncio.set_event_loop(loop)
                holder["loop"] = loop
                ready.set()
                try:
                    loop.run_forever()
                finally:
                    with contextlib.suppress(Exception):
                        loop.close()

            self._engine = _Engine(self)
            self._thread = threading.Thread(target=main, name="contour-browser", daemon=True)
            self._thread.start()
            if not ready.wait(10):
                raise BrowserError("the browser thread didn't start")
            self._loop = holder["loop"]
            return self._loop, self._engine

    async def _call(self, work: "Callable[[_Engine], Awaitable[T]]") -> T:
        loop, engine = self._ensure_thread()
        future = asyncio.run_coroutine_threadsafe(engine.guarded(work), loop)
        try:
            return await asyncio.wait_for(
                asyncio.wrap_future(future),
                LAUNCH_SECONDS + STEPS_PER_WORK * self.action_seconds + GRACE_SECONDS,
            )
        except TimeoutError as error:
            future.cancel()  # cancels the work in the browser thread, which closes its page
            raise PageTimeout("the page took too long and was closed") from error


class _Engine:
    """Everything that lives in the browser thread. Only that thread touches it."""

    def __init__(self, worker: BrowserWorker) -> None:
        self.worker = worker
        self.playwright: Playwright | None = None
        self.browser: Browser | None = None
        self.contexts: dict[str, BrowserContext] = {}
        self.pages: dict[str, Page] = {}
        self.state_dir = Path(tempfile.mkdtemp(prefix="contour-browser-"))
        self.busy = 0
        self.last_used = time.monotonic()
        self.idle_timer: asyncio.TimerHandle | None = None

    async def guarded(self, work: "Callable[[_Engine], Awaitable[T]]") -> T:
        """Runs one piece of work. Any failure goes back to the caller; the thread goes on."""
        self.busy += 1
        try:
            return await work(self)
        except (asyncio.CancelledError, TimeoutError):
            await self._drop_pages()  # a hung page is closed
            raise
        except PlaywrightTimeout as error:
            await self._drop_pages()
            raise PageTimeout("the page took too long and was closed") from error
        except BrowserError:
            raise
        except Exception as error:
            if self.browser is not None and not self.browser.is_connected():
                self._gone()
            raise BrowserError(f"{type(error).__name__}: {str(error)[:300]}") from error
        finally:
            self.busy -= 1
            self.last_used = time.monotonic()
            self._arm_idle_timer()

    # --- Pages -------------------------------------------------------------------------------

    async def open(self, site: Site, url: str) -> Seen:
        return await self._once_more_if_gone(lambda: self._open(site, url))

    async def fill_and_submit(
        self, site: Site, url: str, fields: Mapping[str, str], submit: str
    ) -> Seen:
        return await self._once_more_if_gone(
            lambda: self._fill_and_submit(site, url, fields, submit)
        )

    async def _once_more_if_gone(self, work: Callable[[], Awaitable[Seen]]) -> Seen:
        """A browser that died while idle looks alive until it is used. Then it says so, and
        the work is tried once more in a new browser."""
        try:
            return await work()
        except PlaywrightError as error:
            if not _browser_gone(error):
                raise
        await self._reset()
        return await work()

    async def _open(self, site: Site, url: str) -> Seen:
        page = await self._page(site)
        timeout = self.worker.action_seconds * 1000
        response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        await self._stay_on_site(site, page)
        return await self._seen(page, response.status if response else None)

    async def _stay_on_site(self, site: Site, page: Page) -> None:
        """A redirect can end on another host: the route handler sees only the first address of a
        redirect chain. So the address the page ended on is checked too, and a page that left the
        site's own hosts is emptied and refused (found by the review before PLAN-V16's M1)."""
        if site.own_host(page.url):
            return
        await page.goto("about:blank")
        raise NotAllowed(f"{site.id} was sent to an address it may not open")

    async def _fill_and_submit(
        self, site: Site, url: str, fields: Mapping[str, str], submit: str
    ) -> Seen:
        page = await self._page(site)
        timeout = self.worker.action_seconds * 1000
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        await self._stay_on_site(site, page)  # never type a login into another host's page
        for selector, value in fields.items():
            await page.fill(selector, value, timeout=timeout)
        async with page.expect_navigation(wait_until="domcontentloaded", timeout=timeout) as info:
            await page.click(submit, timeout=timeout)
        response = await info.value
        await self._stay_on_site(site, page)
        return await self._seen(page, response.status if response else None)

    async def _seen(self, page: Page, status: int | None) -> Seen:
        timeout = self.worker.action_seconds * 1000
        text = await page.inner_text("body", timeout=timeout)
        return Seen(
            status=status,
            url=page.url,
            title=await page.title(),
            text=text,
            html=await page.content(),
        )

    # --- The browser, the contexts and the pages ----------------------------------------------

    async def _page(self, site: Site) -> Page:
        if self.browser is None or not self.browser.is_connected():
            self._gone()  # closed when idle, or crashed: everything starts again
        page = self.pages.get(site.id)
        if page is not None and not page.is_closed():
            return page
        context = await self._context(site)
        page = await context.new_page()
        self.pages[site.id] = page
        return page

    async def _context(self, site: Site) -> BrowserContext:
        context = self.contexts.get(site.id)
        if context is not None:
            return context
        browser = await self._browser()
        state = self._state_file(site)
        context = await browser.new_context(
            storage_state=state if state.exists() else None,
            service_workers="block",
            accept_downloads=False,
        )
        context.set_default_timeout(self.worker.action_seconds * 1000)

        async def only_the_site(route: Route, request: Request) -> None:
            if request.resource_type in BLOCKED_KINDS or not site.own_host(request.url):
                await route.abort()
            else:
                await route.continue_()

        await context.route("**/*", only_the_site)
        self.contexts[site.id] = context
        return context

    async def _browser(self) -> Browser:
        if self.browser is not None and self.browser.is_connected():
            return self.browser
        self._gone()
        try:
            browser = await self._launch()
        except Exception:
            # The driver itself may be gone (it crashed, or was stopped): start a new one, once.
            with contextlib.suppress(Exception):
                if self.playwright is not None:
                    await self.playwright.stop()
            self.playwright = None
            browser = await self._launch()
        browser.on("disconnected", lambda _: self._gone())
        self.browser = browser
        return browser

    async def _launch(self) -> Browser:
        if self.playwright is None:
            self.playwright = await async_playwright().start()
        channel = launch_channel(self.worker.channel)
        browser = await self.playwright.chromium.launch(
            channel=channel,
            headless=True,
            # Chrome's own sandbox where it can run (Windows). In a Linux container it can't,
            # and Playwright turns it off (PLAN-V16 T2-9): the browser then loads one site's
            # hosts and nothing else.
            chromium_sandbox=sys.platform == "win32",
            timeout=LAUNCH_SECONDS * 1000,
        )
        log.info("browser_started", extra={"channel": channel or "chromium"})
        return browser

    async def _reset(self) -> None:
        """Forgets the browser and its driver, so the next page starts both again."""
        playwright = self.playwright
        self._gone()
        self.playwright = None
        with contextlib.suppress(Exception):
            if playwright is not None:
                await playwright.stop()

    def _gone(self) -> None:
        """The browser closed or crashed: forget it, its contexts and its pages."""
        self.browser = None
        self.contexts.clear()
        self.pages.clear()

    async def _drop_pages(self) -> None:
        for page in list(self.pages.values()):
            with contextlib.suppress(Exception):
                await page.close()
        self.pages.clear()

    # --- Signed-in state ----------------------------------------------------------------------

    def _state_file(self, site: Site) -> Path:
        return self.state_dir / f"{site.id}.json"

    async def save_state(self, site: Site) -> None:
        context = self.contexts.get(site.id)
        if context is not None:
            await context.storage_state(path=self._state_file(site))

    async def forget(self, site: Site) -> None:
        self._state_file(site).unlink(missing_ok=True)
        page = self.pages.pop(site.id, None)
        context = self.contexts.pop(site.id, None)
        with contextlib.suppress(Exception):
            if page is not None:
                await page.close()
            if context is not None:
                await context.close()

    # --- Idle and shutdown --------------------------------------------------------------------

    def _arm_idle_timer(self) -> None:
        if self.idle_timer is not None:
            self.idle_timer.cancel()
        loop = asyncio.get_running_loop()
        self.idle_timer = loop.call_later(
            self.worker.idle_seconds, lambda: loop.create_task(self._close_if_idle())
        )

    async def _close_if_idle(self) -> None:
        idle_for = time.monotonic() - self.last_used
        if self.busy == 0 and idle_for >= self.worker.idle_seconds * 0.95:
            await self._close_browser()

    async def _close_browser(self) -> None:
        for site_id, context in list(self.contexts.items()):
            with contextlib.suppress(Exception):
                await context.storage_state(path=self.state_dir / f"{site_id}.json")
        browser, playwright = self.browser, self.playwright
        self._gone()
        self.playwright = None
        with contextlib.suppress(Exception):
            if browser is not None:
                await browser.close()
        with contextlib.suppress(Exception):
            if playwright is not None:
                await playwright.stop()

    async def shutdown(self) -> None:
        if self.idle_timer is not None:
            self.idle_timer.cancel()
        await self._close_browser()
        shutil.rmtree(self.state_dir, ignore_errors=True)
