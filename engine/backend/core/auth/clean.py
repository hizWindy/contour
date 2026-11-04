"""Cleaning what comes in, before it is compared or saved: logins, IP addresses and browser names.

Everything here is pure: no database, no request. Emails and usernames are saved in lower case, so
"compared in lower case" is a plain match. An email is plain ASCII, so Python's `lower()` and
Postgres's `lower()` always agree (the table's check compares the two).
"""

import ipaddress
import re

from core.auth.models import IP_MAX, USER_AGENT_MAX, USERNAME_PATTERN

EMAIL_MAX = 254
LOGIN_MAX = 254  # the longest an email can be: a longer login can't be anyone's
_EMAIL_SHAPE = re.compile(r"[^@\s]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+")  # name@host.domain
_USERNAME = re.compile(USERNAME_PATTERN)

BAD_EMAIL = "That doesn't look like an email address, like name@company.com.au."
BAD_USERNAME = (
    "A username is 3 to 64 letters, digits, dots, dashes or underscores, and starts with a "
    "letter or a digit. It can't hold an @."
)


def email(text: str) -> str:
    """The email in lower case. Raises ValueError (in plain words) if it isn't one."""
    value = text.strip().lower()
    if len(value) > EMAIL_MAX or not value.isascii() or _EMAIL_SHAPE.fullmatch(value) is None:
        raise ValueError(BAD_EMAIL)
    return value


def username(text: str | None) -> str | None:
    """The username in lower case, or None for none. Raises ValueError if it isn't allowed."""
    if text is None or not text.strip():
        return None
    value = text.strip().lower()
    if _USERNAME.fullmatch(value) is None:
        raise ValueError(BAD_USERNAME)
    return value


def login(text: str) -> str:
    """What a person typed to sign in (an email or a username), as it is looked up. It is never
    checked for its shape here: a wrong login is a wrong login, not a different answer."""
    return text.strip().lower()[:LOGIN_MAX]


def ip(text: str | None) -> str | None:
    """An IP address in its short form, or None if it isn't one. An IPv4 address that arrives in
    IPv6 clothes (::ffff:203.0.113.7) is the IPv4 address."""
    if not text:
        return None
    try:
        address = ipaddress.ip_address(text.strip().strip("[]"))
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    saved = str(address)
    return saved if len(saved) <= IP_MAX else None


def user_agent(text: str | None) -> str | None:
    """The browser's name, cut to what the table holds. A NUL is taken out: Postgres can't keep
    it in text."""
    if not text:
        return None
    return text.replace("\x00", "").strip()[:USER_AGENT_MAX] or None


# The browser, then the system. The order matters: an Edge name also says Chrome and Safari, a
# Chrome name also says Safari, an Android name also says Linux, and an iPhone's says Mac OS X.
_BROWSERS = (
    ("Edge", re.compile(r"Edg(e|A|iOS)?/")),
    ("Opera", re.compile(r"OPR/|Opera")),
    ("Firefox", re.compile(r"Firefox/|FxiOS/")),
    ("Chrome", re.compile(r"Chrome/|CriOS/")),
    ("Safari", re.compile(r"Safari/")),
    ("curl", re.compile(r"^curl/")),
)
_SYSTEMS = (
    ("iOS", re.compile(r"iPhone|iPad|iPod")),
    ("Android", re.compile(r"Android")),
    ("Windows", re.compile(r"Windows")),
    ("macOS", re.compile(r"Macintosh|Mac OS X")),
    ("Linux", re.compile(r"Linux|X11")),
)


def device(agent: str | None) -> str:
    """A short name for a browser, for the list of sessions: "Chrome on Windows". The full text
    is kept too. What can't be told is left out, and no guess is made."""
    if not agent:
        return "Unknown device"
    browser = next((name for name, pattern in _BROWSERS if pattern.search(agent)), None)
    system = next((name for name, pattern in _SYSTEMS if pattern.search(agent)), None)
    if browser and system:
        return f"{browser} on {system}"
    return browser or system or "Unknown device"
