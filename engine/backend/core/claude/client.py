"""One way to ask Claude: instructions in, a checked answer form out, with optional web tools.

Projects depend on the `Claude` protocol, not on the Anthropic SDK, so tests can swap in a
fake that returns saved answers and costs nothing.
"""

import asyncio
import logging
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Any, Protocol

import anthropic
from anthropic import transform_schema
from anthropic.types.beta import BetaMessage
from pydantic import BaseModel, ValidationError

from core.claude.pricing import Usage, cost_usd
from core.config import get_settings

log = logging.getLogger(__name__)

# Server-side fallback: if the model declines, the API retries on the model Anthropic
# recommends for that kind of decline, inside the same request.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_TOKENS = 16_000
MAX_CONTINUES = 3  # a long web-tool turn can pause; we resume it at most this many times


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
    """Turns on web search and web fetch. The caps are enforced by the API itself."""

    max_searches: int
    max_fetches: int


@dataclass(frozen=True)
class Source:
    url: str
    title: str | None = None
    page_age: str | None = None


@dataclass(frozen=True)
class Reply[T: BaseModel]:
    model: str
    stop_reason: str | None
    parsed: T | None  # None when the answer didn't fit the form
    text: str
    sources: tuple[Source, ...]  # every page the web tools returned
    queries: tuple[str, ...]  # what Claude searched for
    usage: Usage
    cost_usd: Decimal
    request_id: str | None = None


class Claude(Protocol):
    async def ask[T: BaseModel](
        self, *, system: str, prompt: str, form: type[T], web: WebTools | None = None
    ) -> Reply[T]: ...


class AnthropicClaude:
    """The real Claude, through the official SDK."""

    def __init__(self, client: anthropic.AsyncAnthropic | None = None) -> None:
        """`client` is for tests. Normally the SDK client is made from settings."""
        settings = get_settings()
        key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
        # With no key in .env, the SDK looks for ANTHROPIC_API_KEY or an `ant` login when it
        # sends. If it finds none, _send says so.
        self._client = client or anthropic.AsyncAnthropic(
            api_key=key or None, timeout=settings.claude_timeout_seconds, max_retries=2
        )
        self._model = settings.claude_model
        self._effort = settings.claude_effort
        self._gate = asyncio.Semaphore(settings.claude_concurrency)

    async def ask[T: BaseModel](
        self, *, system: str, prompt: str, form: type[T], web: WebTools | None = None
    ) -> Reply[T]:
        tools: list[Any] = []
        if web is not None:
            tools = [
                {"type": "web_search_20260209", "name": "web_search", "max_uses": web.max_searches},
                {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": web.max_fetches},
            ]
        messages: list[Any] = [{"role": "user", "content": prompt}]
        params: dict[str, Any] = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            # The fixed instructions come first and are cached. Too-short ones just aren't.
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "thinking": {"type": "adaptive"},
            "output_config": {
                "effort": self._effort,
                "format": {
                    "type": "json_schema",
                    "schema": transform_schema(form.model_json_schema()),
                },
            },
            "betas": [FALLBACK_BETA],
            "fallbacks": "default",
        }
        if tools:
            params["tools"] = tools

        responses: list[BetaMessage] = []
        async with self._gate:
            for _ in range(MAX_CONTINUES + 1):
                response = await self._send(messages=messages, **params)
                responses.append(response)
                if response.stop_reason != "pause_turn":
                    break
                # Resume the paused turn: send it back as it is, with no new message.
                messages = [*messages, {"role": "assistant", "content": response.content}]
        return build_reply(responses, form)

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


@lru_cache
def get_claude() -> Claude:
    """FastAPI dependency. Tests replace it with a fake."""
    return AnthropicClaude()
