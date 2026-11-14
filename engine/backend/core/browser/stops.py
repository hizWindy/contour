"""The stop rules (PLAN-V16 T2-3): what a page says about whether to go on. Pure: no browser.

What a page can be (`Outcome`, also kept in `core.source_reads.outcome`):
- `ok`: a normal page. `not_found` (404) is a normal answer too.
- `signin_page`: the site wants a sign-in. The reader signs in once and asks again.
- A **stop**, which pauses the site for 24 hours: `captcha` (a person-check), `lockout` (the
  account is locked, refused, or in use elsewhere), `forbidden` (403), `rate_limited` (429),
  `signin_failed` (the sign-in didn't take) and `signin_twice` (the sign-in page again, right
  after signing in).
- `timeout` and `error`: the page didn't load. Counted, but not a stop.

The words are matched in lower case, in the page's title and text (never its scripts).
"""

from dataclasses import dataclass
from typing import Final, Literal

from core.browser.sites import Site

Outcome = Literal[
    "ok",
    "not_found",
    "signin_page",
    "signin_failed",
    "signin_twice",
    "captcha",
    "lockout",
    "forbidden",
    "rate_limited",
    "timeout",
    "error",
]
STOPS: Final[frozenset[Outcome]] = frozenset(
    {"captcha", "lockout", "forbidden", "rate_limited", "signin_failed", "signin_twice"}
)
GOOD: Final[frozenset[Outcome]] = frozenset({"ok", "not_found"})

CAPTCHA_MARKS: Final[tuple[str, ...]] = (
    "captcha",
    "verify you are human",
    "are you a robot",
    "are you human",
    "unusual traffic",
    "just a moment...",
    "checking your browser",
)
LOCKOUT_MARKS: Final[tuple[str, ...]] = (
    "account is locked",
    "account has been locked",
    "account locked",
    "locked out",
    "too many login attempts",
    "too many failed",
    "account has been suspended",
    "account is suspended",
    "already logged in",
    "logged in elsewhere",
    "logged in from another",
    "automated access",
    "ai browser agent",
)
TEXT_CHARS = 20_000  # the start of the page is enough, and keeps the check quick


@dataclass(frozen=True)
class Seen:
    """What the browser saw: the answer's status, the address it ended on, and the page."""

    status: int | None
    url: str
    title: str
    text: str  # the visible text of the page
    html: str = ""


def classify(seen: Seen, site: Site) -> Outcome:
    if seen.status == 429:
        return "rate_limited"
    if seen.status == 403:
        return "forbidden"
    words = f"{seen.title}\n{seen.text[:TEXT_CHARS]}".lower()
    address = seen.url.lower()
    if any(mark in address or mark in words for mark in (*CAPTCHA_MARKS, *site.captcha_marks)):
        return "captcha"
    if any(mark in words for mark in (*LOCKOUT_MARKS, *site.lockout_marks)):
        return "lockout"
    if is_signin_page(seen, site):
        return "signin_page"
    if seen.status == 404:
        return "not_found"
    if seen.status is None or seen.status >= 400:
        return "error"
    return "ok"


def is_signin_page(seen: Seen, site: Site) -> bool:
    address = seen.url.lower()
    words = seen.text[:TEXT_CHARS].lower()
    return any(mark in address for mark in site.signin_url_marks) or any(
        mark in words for mark in site.signin_text_marks
    )
