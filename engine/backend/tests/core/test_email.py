"""Sending email (PLAN-V9 C1): the log sender, Resend's web API and the checks. No real email is
sent: Resend is answered by a fake transport."""

import json
import logging
from typing import Any

import httpx2
import pytest

from core.config import Settings
from core.email.sender import (
    MAX_TRIES,
    RESEND_URL,
    EmailError,
    EmailNotSetUp,
    LogSender,
    ResendSender,
    get_sender,
    masked,
    send,
)

KEY = "re_test_key_1234567890"


def resend(handler: Any, pauses: list[float] | None = None) -> ResendSender:
    async def pause(seconds: float) -> None:
        if pauses is not None:
            pauses.append(seconds)

    transport = httpx2.MockTransport(handler)
    return ResendSender(
        KEY,
        "Contour HQ <hq@example.com>",
        client=httpx2.AsyncClient(transport=transport),
        pause=pause,
    )


async def test_the_log_sender_keeps_the_email_and_logs_no_address(
    caplog: pytest.LogCaptureFixture,
) -> None:
    sender = LogSender()
    with caplog.at_level(logging.INFO, logger="core.email.sender"):
        sent = await send(
            ["Levi@Example.com", "levi@example.com"],
            "Melbourne: 3 good leads",
            "Hello",
            sender=sender,
            key="k1",
        )

    assert sent.provider == "log"
    assert sent.to_count == 1  # the same address twice is sent once, in lower case
    (email,) = sender.sent
    assert email.to == ["levi@example.com"]
    assert email.subject == "Melbourne: 3 good leads"
    logged = " ".join(
        record.getMessage() + json.dumps(record.__dict__, default=str) for record in caplog.records
    )
    assert "levi@example.com" not in logged
    assert "***@example.com" in logged


async def test_a_wrong_address_is_refused_without_showing_it() -> None:
    with pytest.raises(EmailError) as caught:
        await send(["not-an-address"], "Hi", "Hello", sender=LogSender())
    assert "not-an-address" not in caught.value.detail
    assert caught.value.title == "The email isn't valid"


async def test_a_subject_is_one_line() -> None:
    sender = LogSender()
    await send(["a@example.com"], "Line one\r\nBcc: x@y.com", "Hello", sender=sender)
    assert sender.sent[0].subject == "Line one Bcc: x@y.com"


async def test_resend_gets_the_key_the_sender_and_an_idempotency_key() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, json={"id": "email-123"})

    sent = await send(
        ["levi@example.com"], "Subject", "Text", "<p>Html</p>", sender=resend(handler), key="abc"
    )

    assert sent.id == "email-123"
    (request,) = seen
    assert str(request.url) == RESEND_URL
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert request.headers["idempotency-key"] == "abc"
    body = json.loads(request.content)
    assert body == {
        "from": "Contour HQ <hq@example.com>",
        "to": ["levi@example.com"],
        "subject": "Subject",
        "text": "Text",
        "html": "<p>Html</p>",
    }


async def test_resend_is_tried_again_with_the_same_key_when_busy() -> None:
    keys: list[str] = []
    replies = [httpx2.Response(429), httpx2.Response(503), httpx2.Response(200, json={"id": "x"})]

    def handler(request: httpx2.Request) -> httpx2.Response:
        keys.append(request.headers["idempotency-key"])
        return replies.pop(0)

    pauses: list[float] = []
    await send(["a@example.com"], "S", "T", sender=resend(handler, pauses), key="same")
    assert keys == ["same"] * MAX_TRIES  # a retry can't send a second copy
    assert len(pauses) == 2


async def test_a_refused_key_says_what_to_check() -> None:
    with pytest.raises(EmailNotSetUp) as caught:
        await send(["a@example.com"], "S", "T", sender=resend(lambda request: httpx2.Response(401)))
    assert "EMAIL_API_KEY" in caught.value.detail
    assert KEY not in str(caught.value)


async def test_no_connection_is_a_plain_error() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down")

    with pytest.raises(EmailError, match="can't be reached"):
        await send(["a@example.com"], "S", "T", sender=resend(handler))


def test_the_provider_comes_from_the_settings() -> None:
    assert get_sender(Settings(_env_file=None)).provider == "log"
    with pytest.raises(EmailNotSetUp, match="EMAIL_API_KEY"):
        get_sender(Settings(_env_file=None, email_provider="resend"))
    with pytest.raises(EmailNotSetUp, match="EMAIL_FROM"):
        get_sender(Settings(_env_file=None, email_provider="resend", email_api_key=KEY))
    chosen = get_sender(
        Settings(
            _env_file=None, email_provider="resend", email_api_key=KEY, email_from="a@example.com"
        )
    )
    assert chosen.provider == "resend"


def test_masked_keeps_only_the_domain() -> None:
    assert masked("Levi.Young@Contourinteriors.com.au") == "***@contourinteriors.com.au"
    assert masked("nothing") == "***"


async def test_the_email_test_command_writes_to_the_log_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import cli
    from core.email.sender import log_sender

    monkeypatch.setattr(cli, "get_settings", lambda: Settings(_env_file=None))
    before = len(log_sender().sent)
    text, ok = await cli._email_test("al@example.com")
    assert ok
    assert "written to the log" in text
    assert log_sender().sent[before].subject == "Contour HQ: a test email"


async def test_the_email_test_command_says_what_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    from core import cli

    settings = Settings(_env_file=None, email_provider="resend")
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    text, ok = await cli._email_test("al@example.com")
    assert not ok
    assert "EMAIL_API_KEY" in text
