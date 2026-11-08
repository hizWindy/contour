"""Sending email, for every project (PLAN-V9 C1).

One function, `send(to, subject, text, html)`, and two kinds of sender, picked by `EMAIL_PROVIDER`:

- `log` (the default): writes the email to the log and keeps it in memory. For the laptop and the
  tests. Nothing leaves this computer.
- `resend`: Resend's web API (https://resend.com/docs/api-reference/emails/send-email), over
  HTTPS with the HTTP client the engine already uses. It needs `EMAIL_API_KEY` and `EMAIL_FROM`.
  Contour already pays for Resend (Levi, 2 Nov); access to that account is TBC.

Rules this follows:
- **Never twice.** Each email carries an idempotency key, so a retry after a timeout or a busy
  answer can't send a second copy (Resend keeps the key for 24 hours).
- **No contact details in the log.** An address is written as its domain only, like
  `***@contourinteriors.com.au`. The log sender writes the subject and the text, which hold no
  contact details (a run email holds company names, numbers and a link).
- **Plain errors.** A failure raises `EmailError` with a title and a detail a person can read.
- The key goes in an `Authorization` header and is never logged.

Sending from a contourinteriors.com.au address needs DNS records on Contour's domain (TBC: Dawn or
IT). Outlook through Microsoft's API can come later, when Levi gives Outlook admin.
"""

import asyncio
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal, Protocol

import httpx2
from pydantic import BaseModel, Field, ValidationError, field_validator

from core.config import Settings, get_settings

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
MAX_TRIES = 3  # a busy answer (429) or a server error is tried again, at most twice
MAX_WAIT_SECONDS = 10.0
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
MAX_RECIPIENTS = 20
MAX_SUBJECT_CHARS = 200
MAX_LOGGED_TEXT_CHARS = 4000
# One address: something, an @, then a domain with a dot. Enough to refuse a typo like a missing @;
# the provider checks the rest.
_ADDRESS = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")

Provider = Literal["log", "resend"]


class EmailError(Exception):
    """The email couldn't be sent. `title` and `detail` are safe to show to a person."""

    def __init__(self, title: str, detail: str) -> None:
        super().__init__(f"{title}: {detail}")
        self.title = title
        self.detail = detail


class EmailNotSetUp(EmailError):
    """The settings don't allow sending: no key, no sender address, or a refused key."""


def is_address(text: str) -> bool:
    return bool(_ADDRESS.match(text.strip()))


def masked(address: str) -> str:
    """An address as it may be written to the log: its domain only."""
    _, at, domain = address.strip().rpartition("@")
    return f"***@{domain.lower()}" if at and domain else "***"


class Email(BaseModel):
    """One email. `text` is required (every mail program can show it); `html` is optional."""

    to: list[str] = Field(min_length=1, max_length=MAX_RECIPIENTS)
    subject: str = Field(min_length=1, max_length=MAX_SUBJECT_CHARS)
    text: str = Field(min_length=1)
    html: str | None = None

    @field_validator("to")
    @classmethod
    def _addresses(cls, value: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(address.strip().lower() for address in value))
        wrong = [address for address in cleaned if not is_address(address)]
        if wrong:
            raise ValueError(f"Not an email address: {', '.join(masked(a) for a in wrong)}")
        return cleaned

    @field_validator("subject")
    @classmethod
    def _one_line(cls, value: str) -> str:
        return " ".join(value.split())  # a line break in a subject could add a mail header


@dataclass(frozen=True)
class Sent:
    """What the sender says about an email it sent."""

    provider: Provider
    id: str  # the provider's id, or the idempotency key for the log sender
    to_count: int


class EmailSender(Protocol):
    provider: Provider

    async def deliver(self, email: Email, key: str) -> Sent: ...


@dataclass
class LogSender:
    """Writes each email to the log, and keeps it in `sent` (the tests read it). Sends nothing."""

    provider: Provider = "log"
    sent: list[Email] = field(default_factory=list)

    async def deliver(self, email: Email, key: str) -> Sent:
        self.sent.append(email)
        log.info(
            "email_logged",
            extra={
                "to": [masked(address) for address in email.to],
                "subject": email.subject,
                "text": email.text[:MAX_LOGGED_TEXT_CHARS],
                "key": key,
            },
        )
        return Sent(provider="log", id=key, to_count=len(email.to))


class ResendSender:
    """Resend's web API. `client` and `pause` are for tests."""

    provider: Provider = "resend"

    def __init__(
        self,
        api_key: str,
        sender: str,
        *,
        timeout: float = 20.0,
        client: httpx2.AsyncClient | None = None,
        pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._key = api_key
        self._from = sender
        self._client = client
        self._timeout = timeout
        self._pause = pause

    async def deliver(self, email: Email, key: str) -> Sent:
        body: dict[str, object] = {
            "from": self._from,
            "to": email.to,
            "subject": email.subject,
            "text": email.text,
        }
        if email.html:
            body["html"] = email.html
        headers = {"Authorization": f"Bearer {self._key}", "Idempotency-Key": key}
        owned = self._client is None
        client = self._client or httpx2.AsyncClient(timeout=httpx2.Timeout(self._timeout))
        try:
            for attempt in range(MAX_TRIES):
                try:
                    response = await client.post(RESEND_URL, json=body, headers=headers)
                except httpx2.TimeoutException:
                    if attempt + 1 < MAX_TRIES:  # safe: the key stops a second copy
                        await self._pause(_backoff(attempt))
                        continue
                    raise EmailError(
                        "The email service took too long", "It didn't answer in time."
                    ) from None
                except httpx2.HTTPError:
                    raise EmailError(
                        "The email service can't be reached", "Check the connection, then retry."
                    ) from None
                log.info("email_call", extra={"provider": "resend", "status": response.status_code})
                if response.status_code in RETRY_STATUSES and attempt + 1 < MAX_TRIES:
                    await self._pause(_wait(response, attempt))
                    continue
                if response.status_code >= 400:
                    raise _resend_error(response.status_code)
                found = response.json() if response.content else {}
                sent_id = str(found.get("id", "")) if isinstance(found, dict) else ""
                return Sent(provider="resend", id=sent_id or key, to_count=len(email.to))
        finally:
            if owned:
                await client.aclose()
        raise EmailError("The email service is busy", "Try again in a moment.")  # pragma: no cover


def _backoff(attempt: int) -> float:
    return min(0.5 * (1 << attempt), MAX_WAIT_SECONDS)


def _wait(response: httpx2.Response, attempt: int) -> float:
    asked = str(response.headers.get("retry-after", ""))
    if asked.isdigit():
        return min(float(asked), MAX_WAIT_SECONDS)
    return _backoff(attempt)


def _resend_error(status: int) -> EmailError:
    if status in (401, 403):
        return EmailNotSetUp(
            "The email key was refused",
            f"Resend answered {status}. Check EMAIL_API_KEY, and that EMAIL_FROM's domain is "
            "checked in Resend.",
        )
    if status == 422:
        return EmailError(
            "The email service didn't accept the email",
            "A value was refused (422). Check EMAIL_FROM and the addresses.",
        )
    if status == 429:
        return EmailError("The email service is busy", "Too many emails (429). Try again later.")
    return EmailError("The email service had a problem", f"It answered with error {status}.")


_log_sender = LogSender()


def get_sender(settings: Settings | None = None) -> EmailSender:
    """The sender the settings ask for. The log sender is one for the whole process, so a test
    can read what was "sent"."""
    settings = settings or get_settings()
    if settings.email_provider == "log":
        return _log_sender
    secret = settings.email_api_key
    key = secret.get_secret_value().strip() if secret is not None else ""
    if not key:
        raise EmailNotSetUp("Email isn't set up", "EMAIL_API_KEY is empty in engine/.env.")
    if not settings.email_from:
        raise EmailNotSetUp("Email isn't set up", "EMAIL_FROM is empty in engine/.env.")
    return ResendSender(key, settings.email_from)


def log_sender() -> LogSender:
    """The process's log sender: what the log provider has "sent" (tests and the fake backend)."""
    return _log_sender


async def send(
    to: list[str],
    subject: str,
    text: str,
    html: str | None = None,
    *,
    settings: Settings | None = None,
    sender: EmailSender | None = None,
    key: str | None = None,
) -> Sent:
    """Sends one email. `key` makes a retry safe: the same key never sends twice (a new one is
    made when none is given). Raises `EmailError` with plain words when it can't."""
    try:
        email = Email(to=to, subject=subject, text=text, html=html)
    except ValidationError as error:
        first = error.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        message = str(first["msg"]).removeprefix("Value error, ")
        raise EmailError("The email isn't valid", f"{where}: {message}") from None
    chosen = sender or get_sender(settings)
    sent = await chosen.deliver(email, key or uuid.uuid4().hex)
    log.info(
        "email_sent",
        extra={"provider": sent.provider, "to": [masked(a) for a in email.to], "id": sent.id},
    )
    return sent
