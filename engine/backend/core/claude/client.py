"""One way to ask Claude: instructions in, a checked answer form out, with optional web tools.

Projects depend on the `Claude` protocol, not on the Anthropic SDK, so tests can swap in a
fake that returns saved answers and costs nothing.

The real client (`AnthropicClaude`) is shared by the whole process, so its limits hold for every
run and request at once: the Claude gate (how many requests run together) and the daily cap (how
much Claude may cost in 24 hours). `claude_holder` keeps the shared one.
"""

import logging
from contextlib import AbstractAsyncContextManager, nullcontext
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Protocol

import anthropic
from anthropic.types.beta import BetaMessage
from pydantic import BaseModel, ValidationError

from core.claude.forms import form_schema
from core.claude.limiter import ClaudeGate
from core.claude.pricing import Usage, cost_usd
from core.config import Settings, get_settings

if TYPE_CHECKING:
    # Only for the type. daily.py imports budget.py, which imports this file, so the real import
    # happens inside ClaudeHolder.daily, after this module is loaded.
    from core.claude.daily import DailyCap

log = logging.getLogger(__name__)

# Server-side fallback: if the model declines, the API retries on the model Anthropic
# recommends for that kind of decline, inside the same request.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_TOKENS = 16_000
MAX_CONTINUES = 3  # a long web-tool turn can pause; we resume it at most this many times
FETCH_MAX_CONTENT_TOKENS = 20_000  # a fetched page is cut to this size before Claude reads it


class ClaudeError(Exception):
    """Claude couldn't answer. `title` and `detail` are safe to show to a person."""

    def __init__(self, title: str, detail: str) -> None:
        super().__init__(f"{title}: {detail}")
        self.title = title
        self.detail = detail


class ClaudeUnavailable(ClaudeError):
    """No key, a bad key, or no connection. Retrying won't help until someone fixes it."""


@dataclass(frozen=True)
class WebTools:
    """Turns on web search and web fetch. The caps are enforced by the API itself.

    `blocked_domains` are sites the tools never read, so they are never billed either.
    """

    max_searches: int
    max_fetches: int
    blocked_domains: tuple[str, ...] = ()


@dataclass(frozen=True)
class Source:
    url: str
    title: str | None = None
    page_age: str | None = None


@dataclass(frozen=True)
class Reply[T: BaseModel]:
    model: str  # the model that really answered, which the cost and the search log use
    stop_reason: str | None
    parsed: T | None  # None when the answer didn't fit the form
    text: str
    sources: tuple[Source, ...]  # every page the web tools returned
    queries: tuple[str, ...]  # what Claude searched for
    usage: Usage
    cost_usd: Decimal
    request_id: str | None = None


class Claude(Protocol):
    """`model`, `effort` and `max_continues` are per call. None means the default."""

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
    ) -> Reply[T]: ...


class AnthropicClaude:
    """The real Claude, through the official SDK.

    One instance is shared by the whole process (`claude_holder`). It uses the process-wide
    `ClaudeGate` (how many requests run at once) and `DailyCap` (the 24-hour limit), and holds the
    SDK client, which is made once and closed by `aclose()`.

    The model and effort are per call (`ask(model=..., effort=...)`). When a call names none, the
    ones from the last `configure(settings)` are used, so a change on the Settings page applies
    to the next request without a restart.

    The SDK never retries here (`max_retries=0`): a retried request is billed again. A failure
    that might pass (a time-out, a busy server, a rate limit) comes back as a `ClaudeError`, and
    the caller decides what to do.
    """

    def __init__(
        self,
        client: anthropic.AsyncAnthropic | None = None,
        *,
        settings: Settings | None = None,
        gate: ClaudeGate | None = None,
        daily: "DailyCap | None" = None,
    ) -> None:
        """`client` is for tests. Normally the SDK client is made from settings. A client that is
        passed in is used with retries off too. `gate` and `daily` are the shared ones; without
        them this instance has its own gate and no daily limit."""
        settings = settings or get_settings()
        key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
        # With no key in .env, the SDK looks for ANTHROPIC_API_KEY or an `ant` login when it
        # sends. If it finds none, _send says so.
        if client is None:
            client = anthropic.AsyncAnthropic(
                api_key=key or None, timeout=settings.claude_timeout_seconds, max_retries=0
            )
        else:
            client = client.with_options(max_retries=0)  # shares the same connection pool
        self._client = client
        self._model = settings.claude_model
        self._effort = settings.claude_effort
        self._gate = gate or ClaudeGate(settings.claude_concurrency)
        self._daily = daily

    @property
    def gate(self) -> ClaudeGate:
        return self._gate

    def configure(self, settings: Settings) -> None:
        """Uses these (effective) settings from the next request on: the default model and
        effort, how many requests run at once, and the daily cap and the hold for each request.

        It is quick and safe to call as often as you like. Requests that are running keep going.
        """
        self._model = settings.claude_model
        self._effort = settings.claude_effort
        self._gate.set_limit(settings.claude_concurrency)
        if self._daily is not None:
            self._daily.configure(
                daily_cap_usd=settings.daily_cap_usd,
                request_reserve_usd=settings.request_reserve_usd,
            )

    async def aclose(self) -> None:
        """Closes the SDK client's connections. The app's shut-down code calls this."""
        await self._client.close()

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
        """One question, one checked answer.

        The request waits for a place at the gate, then the daily limit is checked and money is
        held (`DailyLimitReached` if it would pass the cap, before anything is sent). A paused
        turn is sent again at most `max_continues` times, and each time with the searches and
        page reads left (the paused turn's own use is taken off).
        """
        tools: list[Any] = []
        search: dict[str, Any] = {}
        fetch: dict[str, Any] = {}
        if web is not None:
            search = {
                "type": "web_search_20260209",
                "name": "web_search",
                "max_uses": web.max_searches,
            }
            fetch = {
                "type": "web_fetch_20260209",
                "name": "web_fetch",
                "max_uses": web.max_fetches,
                "max_content_tokens": FETCH_MAX_CONTENT_TOKENS,
            }
            if web.blocked_domains:
                search["blocked_domains"] = list(web.blocked_domains)
                fetch["blocked_domains"] = list(web.blocked_domains)
            tools = [search, fetch]
        messages: list[Any] = [{"role": "user", "content": prompt}]
        chosen = model or self._model
        params: dict[str, Any] = {
            "model": chosen,
            "max_tokens": MAX_TOKENS,
            # The fixed instructions come first and are cached. Too-short ones just aren't.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "thinking": {"type": "adaptive"},
            "output_config": {
                "effort": effort or self._effort,
                "format": {
                    "type": "json_schema",
                    "schema": form_schema(form),
                },
            },
            "betas": [FALLBACK_BETA],
            "fallbacks": "default",
        }
        if tools:
            params["tools"] = tools

        continues = MAX_CONTINUES if max_continues is None else max(0, max_continues)
        responses: list[BetaMessage] = []
        async with self._gate.acquire(), self._hold():
            for attempt in range(continues + 1):
                if attempt > 0:
                    if self._daily is not None and not await self._daily.has_room():
                        log.warning("claude_continue_stopped", extra={"why": "daily limit"})
                        break
                    if web is not None:
                        # The turn's earlier searches count against the request's limits. The API
                        # wants at least 1, so the last round may search once more.
                        used = sum((_usage(r) for r in responses), Usage())
                        search["max_uses"] = max(1, web.max_searches - used.web_searches)
                        fetch["max_uses"] = max(1, web.max_fetches - used.web_fetches)
                response = await self._send(messages=messages, **params)
                responses.append(response)
                if response.stop_reason != "pause_turn":
                    break
                # Resume the paused turn: send it back as it is, with no new message.
                messages = [*messages, {"role": "assistant", "content": response.content}]
            reply = build_reply(responses, form)
            if self._daily is not None:
                self._daily.note_spent(reply.cost_usd, reply.request_id)
        if reply.model != chosen:
            # The API switched models inside the request (the server-side fallback). The reply,
            # its cost and the search log all carry the model that really answered.
            log.info("claude_other_model", extra={"asked": chosen, "answered": reply.model})
        return reply

    def _hold(self) -> AbstractAsyncContextManager[None]:
        """The daily limit's check and hold for one request, or nothing without a daily limit."""
        return self._daily.reserve() if self._daily is not None else nullcontext()

    async def _send(self, **params: Any) -> BetaMessage:
        try:
            response: BetaMessage = await self._client.beta.messages.create(**params)
            return response
        except anthropic.AuthenticationError as error:
            raise ClaudeUnavailable(
                "Claude rejected the API key", "Check ANTHROPIC_API_KEY in engine/.env."
            ) from error
        except anthropic.PermissionDeniedError as error:
            raise ClaudeUnavailable("The API key can't use this model", str(error)) from error
        except anthropic.RateLimitError as error:
            raise ClaudeError(
                "Claude's rate limit was hit", "Wait a minute, then try again."
            ) from error
        except anthropic.APIStatusError as error:
            raise ClaudeError(
                f"Claude returned an error ({error.status_code})", error.message
            ) from error
        except anthropic.APITimeoutError as error:
            # Not "unavailable": one slow request is no reason to stop a whole run.
            raise ClaudeError(
                "Claude took too long", "The request timed out. Try again in a moment."
            ) from error
        except anthropic.APIConnectionError as error:
            raise ClaudeUnavailable(
                "Can't reach Claude", "Check the internet connection."
            ) from error
        except TypeError as error:
            # The SDK finds no key only when it sends, and says so with a TypeError.
            if "authentication" not in str(error):
                raise
            raise ClaudeUnavailable(
                "No Claude API key", "Add ANTHROPIC_API_KEY to engine/.env, then restart."
            ) from error


def build_reply[T: BaseModel](responses: list[BetaMessage], form: type[T]) -> Reply[T]:
    """Adds up a request's responses, and reads the answer only if Claude finished."""
    last = responses[-1]
    usage = sum((_usage(r) for r in responses), Usage())
    cost = sum((cost_usd(r.model, _usage(r)) for r in responses), Decimal(0))
    sources: dict[str, Source] = {}
    queries: list[str] = []
    texts: list[str] = []
    for response in responses:
        for block in response.content:
            if block.type == "server_tool_use" and block.name == "web_search":
                query = block.input.get("query")
                if isinstance(query, str):
                    queries.append(query)
            elif block.type == "web_search_tool_result" and isinstance(block.content, list):
                for result in block.content:  # an error comes back as an object, not a list
                    sources.setdefault(
                        result.url, Source(result.url, result.title, result.page_age)
                    )
            elif block.type == "web_fetch_tool_result" and block.content.type == "web_fetch_result":
                title = block.content.content.title
                sources[block.content.url] = Source(block.content.url, title)
            elif block.type == "text":
                texts.append(block.text)

    parsed: T | None = None
    # Check why Claude stopped before reading the answer.
    if last.stop_reason == "refusal":
        log.warning(
            "claude_declined",
            extra={"model": last.model, "request_id": getattr(last, "_request_id", None)},
        )
    elif last.stop_reason in ("end_turn", "stop_sequence") and texts:
        try:
            parsed = form.model_validate_json(texts[-1])  # the answer is the last text block
        except ValidationError:
            log.warning("claude_answer_off_form", extra={"form": form.__name__})
    else:
        log.warning("claude_stopped_early", extra={"stop_reason": last.stop_reason})
    return Reply(
        model=last.model,
        stop_reason=last.stop_reason,
        parsed=parsed,
        text="\n".join(texts),
        sources=tuple(sources.values()),
        queries=tuple(queries),
        usage=usage,
        cost_usd=cost,
        request_id=getattr(last, "_request_id", None),
    )


def _usage(response: BetaMessage) -> Usage:
    u = response.usage
    tools = u.server_tool_use
    return Usage(
        input_tokens=u.input_tokens,
        output_tokens=u.output_tokens,
        cache_read_tokens=u.cache_read_input_tokens or 0,
        cache_write_tokens=u.cache_creation_input_tokens or 0,
        web_searches=tools.web_search_requests if tools else 0,
        web_fetches=tools.web_fetch_requests if tools else 0,
    )


# --- The shared client ----------------------------------------------------------------------


class ClaudeHolder:
    """The one shared Claude of the process, with its gate and its daily limit.

    A plain object, not a cache, so a test can start clean with `reset()`. The app builds the
    Claude client when it is first asked for, and the lifespan closes it with `aclose()`.
    `configure(settings)` can come before the client exists: the settings are kept and used when
    it is made.
    """

    def __init__(self) -> None:
        self._gate = ClaudeGate()
        self._daily: DailyCap | None = None
        self._claude: AnthropicClaude | None = None
        self._settings: Settings | None = None

    @property
    def gate(self) -> ClaudeGate:
        return self._gate

    @property
    def daily(self) -> "DailyCap":
        """The shared daily limit. It needs no API key, so the Settings page can ask it."""
        if self._daily is None:
            from core.claude.daily import DailyCap
            from core.db.engine import get_sessionmaker

            settings = self._settings or get_settings()
            self._daily = DailyCap(
                lambda: get_sessionmaker()(), settings.daily_cap_usd, settings.request_reserve_usd
            )
        return self._daily

    def get(self) -> AnthropicClaude:
        """The shared client. Raises ClaudeUnavailable when it can't be made."""
        if self._claude is None:
            settings = self._settings or get_settings()
            self._gate.set_limit(settings.claude_concurrency)
            try:
                self._claude = AnthropicClaude(settings=settings, gate=self._gate, daily=self.daily)
            except anthropic.AnthropicError as error:
                raise ClaudeUnavailable(
                    "Can't start Claude", "Check ANTHROPIC_API_KEY in engine/.env."
                ) from error
        return self._claude

    def configure(self, settings: Settings) -> None:
        """Makes the shared Claude use these effective settings from the next request on."""
        self._settings = settings
        self._gate.set_limit(settings.claude_concurrency)
        if self._daily is not None:
            self._daily.configure(
                daily_cap_usd=settings.daily_cap_usd,
                request_reserve_usd=settings.request_reserve_usd,
            )
        if self._claude is not None:
            self._claude.configure(settings)

    async def aclose(self) -> None:
        """Closes the SDK client. The next `get()` makes a new one."""
        claude, self._claude = self._claude, None
        if claude is not None:
            await claude.aclose()

    def reset(self) -> None:
        """Forgets everything, for a test that wants a clean start. It closes nothing."""
        self._gate = ClaudeGate()
        self._daily = None
        self._claude = None
        self._settings = None


claude_holder = ClaudeHolder()


def get_claude() -> AnthropicClaude:
    """FastAPI dependency. Tests replace it with a fake."""
    return claude_holder.get()


def configure_claude(settings: Settings) -> None:
    """Gives the shared Claude the effective settings (see `ClaudeHolder.configure`).

    Call it with `effective_settings(...)` at the start of a run, and for each web request that
    uses Claude. Safe to call often.
    """
    claude_holder.configure(settings)


async def close_claude() -> None:
    """Closes the shared Claude's connections. The app's shut-down code calls this."""
    await claude_holder.aclose()
