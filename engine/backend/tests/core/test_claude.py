"""Cost, caps, and reading Claude's replies. No real requests are made."""

import json
from decimal import Decimal
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types.beta import BetaMessage
from pydantic import BaseModel

from apps.lead_finder.fields import AngleNotes
from core.claude.budget import Budget, BudgetSpent
from core.claude.client import (
    FETCH_MAX_CONTENT_TOKENS,
    MAX_CONTINUES,
    AnthropicClaude,
    Claude,
    ClaudeUnavailable,
    Reply,
    WebTools,
    build_reply,
)
from core.claude.pricing import Usage, cost_usd
from core.config import get_settings
from tests.lead_finder.samples import FakeClaude

PAGE = "https://www.afr.com/property/acme-moves"


class Answer(BaseModel):
    city: str


def message(
    content: list[dict[str, Any]], stop_reason: str = "end_turn", searches: int = 1
) -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "content": content,
            "usage": {
                "input_tokens": 10_000,
                "output_tokens": 500,
                "cache_read_input_tokens": 2_000,
                "server_tool_use": {"web_search_requests": searches, "web_fetch_requests": 0},
            },
        }
    )


SEARCH: list[dict[str, Any]] = [
    {"type": "text", "text": "I'll search for the lease."},
    {
        "type": "server_tool_use",
        "id": "srvtoolu_1",
        "name": "web_search",
        "input": {"query": "acme lease"},
    },
    {
        "type": "web_search_tool_result",
        "tool_use_id": "srvtoolu_1",
        "content": [
            {
                "type": "web_search_result",
                "url": PAGE,
                "title": "Acme moves",
                "encrypted_content": "x",
                "page_age": "1 week",
            }
        ],
    },
]


def test_cost_of_a_request() -> None:
    usage = Usage(
        input_tokens=1_000_000, output_tokens=100_000, cache_read_tokens=1_000_000, web_searches=3
    )
    # $4 in + $2 out + $0.20 cached + 3 searches x $0.01
    assert cost_usd("claude-opus-5-5", usage) == Decimal("6.230000")
    assert cost_usd("claude-sonnet-5-5", Usage(cache_write_tokens=1_000_000)) == Decimal("2.500000")


def test_the_reply_keeps_sources_queries_and_the_final_answer() -> None:
    reply = build_reply([message([*SEARCH, {"type": "text", "text": '{"city": "Perth"}'}])], Answer)
    assert reply.parsed == Answer(city="Perth")
    assert [s.url for s in reply.sources] == [PAGE]
    assert reply.queries == ("acme lease",)
    assert reply.usage.web_searches == 1
    # 10k x $4/M + 500 x $20/M + 2k x $0.20/M + 1 search
    assert reply.cost_usd == Decimal("0.060400")


def test_paused_turns_add_up() -> None:
    first = message(SEARCH, stop_reason="pause_turn")
    second = message([{"type": "text", "text": '{"city": "Adelaide"}'}], searches=0)
    reply = build_reply([first, second], Answer)
    assert reply.parsed == Answer(city="Adelaide")
    assert reply.usage.input_tokens == 20_000
    assert reply.usage.web_searches == 1


@pytest.mark.parametrize(
    ("text", "stop_reason"),
    [('{"city": "Perth"}', "refusal"), ('{"city": "Per', "max_tokens"), ("not json", "end_turn")],
)
def test_no_answer_when_claude_declined_was_cut_off_or_left_the_form(
    text: str, stop_reason: str
) -> None:
    reply = build_reply(
        [message([{"type": "text", "text": text}], stop_reason=stop_reason)], Answer
    )
    assert reply.parsed is None
    assert reply.cost_usd > 0  # it still cost money, so it's still logged


def fake_reply(cost: str, searches: int) -> Reply[Answer]:
    usage = Usage(web_searches=searches)
    return Reply("claude-opus-5-5", "end_turn", None, "", (), (), usage, Decimal(cost))


def test_budget_reserves_searches_and_stops_at_the_cap() -> None:
    budget = Budget(cap_usd=Decimal("1.00"), max_searches=5)
    assert budget.reserve_searches(3) == 3
    assert budget.reserve_searches(3) == 2  # only 2 left while the first request runs
    with pytest.raises(BudgetSpent):
        budget.reserve_searches(1)
    budget.record(fake_reply("0.40", searches=1), reserved=3)
    budget.release(2)
    assert budget.reserve_searches(9) == 4  # unused searches came back
    budget.record(fake_reply("0.70", searches=4), reserved=4)
    with pytest.raises(BudgetSpent):
        budget.check()


async def test_the_sdk_accepts_our_request_and_we_read_its_answer() -> None:
    """A real SDK request into a fake network, so we know its shape without spending money."""
    sent: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        body = message([*SEARCH, {"type": "text", "text": '{"city": "Perth"}'}]).to_dict()
        return httpx2.Response(200, json=body)

    sdk = anthropic.AsyncAnthropic(
        api_key="test-key", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    )
    claude = AnthropicClaude(client=sdk)
    reply = await claude.ask(
        system="Find the city.", prompt="Acme", form=Answer, web=WebTools(2, 1)
    )

    assert reply.parsed == Answer(city="Perth")
    request = json.loads(sent[0].content)
    assert request["model"] == "claude-opus-5-5"
    assert request["thinking"] == {"type": "adaptive"}
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert request["fallbacks"] == "default"
    assert [tool["max_uses"] for tool in request["tools"]] == [2, 1]
    assert "server-side-fallback-2026-07-01" in sent[0].headers["anthropic-beta"]


async def test_a_missing_key_is_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"):
        monkeypatch.delenv(name, raising=False)

    def never(request: httpx2.Request) -> httpx2.Response:
        raise AssertionError("No request should be sent without a key")

    sdk = anthropic.AsyncAnthropic(
        api_key=None, http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(never))
    )
    with pytest.raises(ClaudeUnavailable, match="set up yet"):
        await AnthropicClaude(client=sdk).ask(system="x", prompt="y", form=Answer)


# --- What we send: web tool limits, blocked sites, and a model and effort per call --------------


def claude_that_answers(
    sent: list[httpx2.Request], *messages: BetaMessage, **options: Any
) -> AnthropicClaude:
    """The real client on a fake network. It gives these messages in turn, then repeats the last.
    `options` go to `AnthropicClaude` (like `gate=` or `daily=`)."""
    queue = list(messages)

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(request)
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        return httpx2.Response(200, json=answer.to_dict())

    sdk = anthropic.AsyncAnthropic(
        api_key="test-key", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    )
    return AnthropicClaude(client=sdk, **options)


FINAL = message([{"type": "text", "text": '{"city": "Perth"}'}], searches=0)


async def test_blocked_domains_go_to_both_web_tools_and_a_fetch_is_capped() -> None:
    sent: list[httpx2.Request] = []
    web = WebTools(3, 2, blocked_domains=("propertydaily.com.au", "zoominfo.com"))
    await claude_that_answers(sent, FINAL).ask(system="s", prompt="p", form=Answer, web=web)

    search, fetch = json.loads(sent[0].content)["tools"]
    assert (search["name"], search["max_uses"]) == ("web_search", 3)
    assert (fetch["name"], fetch["max_uses"]) == ("web_fetch", 2)
    assert search["blocked_domains"] == ["propertydaily.com.au", "zoominfo.com"]
    assert fetch["blocked_domains"] == ["propertydaily.com.au", "zoominfo.com"]
    assert fetch["max_content_tokens"] == FETCH_MAX_CONTENT_TOKENS == 20_000
    assert "max_content_tokens" not in search


async def test_no_blocked_domains_means_no_key_at_all() -> None:
    sent: list[httpx2.Request] = []
    await claude_that_answers(sent, FINAL).ask(
        system="s", prompt="p", form=Answer, web=WebTools(3, 2)
    )
    search, fetch = json.loads(sent[0].content)["tools"]
    assert "blocked_domains" not in search
    assert "blocked_domains" not in fetch
    assert fetch["max_content_tokens"] == 20_000


async def test_no_web_tools_means_no_tools() -> None:
    sent: list[httpx2.Request] = []
    await claude_that_answers(sent, FINAL).ask(system="s", prompt="p", form=Answer)
    assert "tools" not in json.loads(sent[0].content)


async def test_the_settings_model_and_effort_are_the_default() -> None:
    sent: list[httpx2.Request] = []
    await claude_that_answers(sent, FINAL).ask(system="s", prompt="p", form=Answer)
    request = json.loads(sent[0].content)
    assert request["model"] == get_settings().claude_model
    assert request["output_config"]["effort"] == get_settings().claude_effort


async def test_a_model_and_effort_can_be_chosen_for_one_call() -> None:
    sent: list[httpx2.Request] = []
    claude = claude_that_answers(sent, FINAL)
    await claude.ask(system="s", prompt="p", form=Answer, model="claude-haiku-5-5", effort="low")
    await claude.ask(system="s", prompt="p", form=Answer, model="claude-sonnet-5-5")
    await claude.ask(system="s", prompt="p", form=Answer)  # nothing is remembered between calls

    first, second, third = (json.loads(request.content) for request in sent)
    assert (first["model"], first["output_config"]["effort"]) == ("claude-haiku-5-5", "low")
    assert second["model"] == "claude-sonnet-5-5"
    assert second["output_config"]["effort"] == get_settings().claude_effort
    assert third["model"] == get_settings().claude_model


PAUSED = message(SEARCH, stop_reason="pause_turn")


@pytest.mark.parametrize(
    ("max_continues", "requests"),
    [(None, 1 + MAX_CONTINUES), (0, 1), (1, 2), (2, 3)],
)
async def test_a_paused_turn_is_resumed_at_most_max_continues_times(
    max_continues: int | None, requests: int
) -> None:
    sent: list[httpx2.Request] = []
    reply = await claude_that_answers(sent, PAUSED).ask(
        system="s", prompt="p", form=Answer, web=WebTools(3, 2), max_continues=max_continues
    )
    assert len(sent) == requests
    assert reply.stop_reason == "pause_turn"
    assert reply.parsed is None
    assert reply.usage.web_searches == requests  # every paused request is still counted


async def test_a_paused_turn_is_sent_back_and_finishes() -> None:
    sent: list[httpx2.Request] = []
    reply = await claude_that_answers(sent, PAUSED, FINAL).ask(
        system="s", prompt="p", form=Answer, web=WebTools(3, 2), max_continues=1
    )
    assert reply.parsed == Answer(city="Perth")
    assert len(sent) == 2
    second = json.loads(sent[1].content)["messages"]
    assert [m["role"] for m in second] == ["user", "assistant"]


async def test_a_negative_max_continues_means_none() -> None:
    sent: list[httpx2.Request] = []
    await claude_that_answers(sent, PAUSED).ask(
        system="s", prompt="p", form=Answer, web=WebTools(3, 2), max_continues=-4
    )
    assert len(sent) == 1


async def test_the_real_client_and_the_fake_both_fit_the_protocol() -> None:
    """mypy checks these two lines. The fake takes the new keywords too."""
    real: Claude = AnthropicClaude(client=anthropic.AsyncAnthropic(api_key="test-key"))
    fake: Claude = FakeClaude()
    assert real is not None
    reply = await fake.ask(
        system="s",
        prompt="Angle: property.",
        form=AngleNotes,
        web=WebTools(2, 1),
        model="claude-haiku-5-5",
        effort="low",
        max_continues=0,
    )
    assert reply.parsed is not None


def test_a_budget_still_takes_a_reply_from_the_client_with_no_hold() -> None:
    """The old three-line use of Budget (reserve, ask, record) still works as it did."""
    budget = Budget(cap_usd=Decimal("1.00"), max_searches=5)
    granted = budget.reserve_searches(3)
    budget.record(fake_reply("0.10", searches=1), reserved=granted)
    assert (budget.spent_usd, budget.searches) == (Decimal("0.10"), 1)
