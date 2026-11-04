"""Structured logs: one JSON object per line, so they're easy to search later.

Secrets and row values never reach the log. Every message, extra field and exception text passes
through two cleaners:
- `redact` replaces the database password, the Anthropic API key, anything shaped like an
  Anthropic key (`sk-ant-...`) and a session cookie (`contour_session=...`) with `[redacted]`.
- `hide_detail` replaces the `DETAIL:` part of a Postgres error with `DETAIL: [hidden]`. That
  part quotes the values of the row that failed, like `Key (company_key)=(Acme) already
  exists.` or `Failing row contains (...)`, and those values are company names, notes and
  keys. (SQLAlchemy's `hide_parameters` hides only its own list of parameters, not this.)

`scrub` does both.
"""

import json
import logging
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any
from urllib.parse import quote, quote_plus

from core.config import get_settings

_STANDARD = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message"}

REDACTED = "[redacted]"
DETAIL_HIDDEN = "DETAIL: [hidden]"
# Anthropic keys look like sk-ant-api03-..., so this also catches a key that isn't configured
# here (one pasted into a prompt or an error text).
_KEY_SHAPE = r"sk-ant-[A-Za-z0-9_\-]+"
# A session cookie, name and value, as it is written in a Cookie or a Set-Cookie header. The
# engine never logs a header, so this only matters if one lands in an error text one day.
_COOKIE_SHAPE = r"(?:__Host-)?contour_session=[^\s;,\"']*"
# A secret shorter than this is skipped: removing every "a" from the log would help nobody.
MIN_SECRET_CHARS = 4

# A Postgres error is the message, then labelled parts: DETAIL, HINT, CONTEXT and the names of
# the table, column and constraint. The value of a DETAIL can hold line breaks (a note), so the
# DETAIL runs until the next label, until what SQLAlchemy adds after it, until the next error
# of a chain, or the end of the text. A blank line does NOT end it.
_AFTER_DETAIL = (
    r"\n(?:HINT:|CONTEXT:|STATEMENT:|LOCATION:|SCHEMA NAME:|TABLE NAME:|COLUMN NAME:"
    r"|DATATYPE NAME:|CONSTRAINT NAME:)"
    r"|\n\[SQL:|\n\[parameters:|\n\(Background on this error"
    r"|\n\nThe above exception was|\n\nDuring handling of the above exception"
    r"|\Z"
)
_DETAIL = re.compile(rf"(?:DETAIL:|Failing row contains).*?(?={_AFTER_DETAIL})", re.DOTALL)


def _written_forms(secret: str) -> list[str]:
    """A secret as it is written in the texts the app builds from it."""
    return [
        secret,
        quote(secret, safe=""),  # inside a web address, like Settings.database_url()
        quote_plus(secret),  # inside a web form
        # inside a connection string, like Settings.psycopg_conninfo(), in single quotes
        secret.replace("\\", "\\\\").replace("'", "\\'"),
        # inside a JSON text, like json.dumps({"password": secret}). Text that isn't plain
        # ASCII is written as \uXXXX by default, and as it is with ensure_ascii=False.
        json.dumps(secret)[1:-1],
        json.dumps(secret, ensure_ascii=False)[1:-1],
        # inside the text of a Python value, like the %r of a dict: its quotes and backslashes
        repr(secret)[1:-1],
    ]


def _configured_secrets() -> tuple[str, ...]:
    """The database password and the API keys from settings, in each form they are written in."""
    try:
        settings = get_settings()
    except Exception:
        return ()  # settings that don't load must not stop a log line
    configured = [settings.postgres_password.get_secret_value()]
    for key in (
        settings.anthropic_api_key,
        settings.signalhire_api_key,
        settings.hubspot_service_key,
    ):
        if key is not None:
            configured.append(key.get_secret_value())
    forms = [form for secret in configured if secret for form in _written_forms(secret)]
    return tuple(dict.fromkeys(form for form in forms if len(form) >= MIN_SECRET_CHARS))


@lru_cache(maxsize=8)
def _pattern(secrets: tuple[str, ...]) -> re.Pattern[str]:
    # The longest first, so a secret that holds another one is removed whole.
    parts = [re.escape(secret) for secret in sorted(secrets, key=len, reverse=True)]
    return re.compile("|".join([*parts, _KEY_SHAPE, _COOKIE_SHAPE]))


def _current_pattern() -> re.Pattern[str]:
    return _pattern(_configured_secrets())


def redact(text: str) -> str:
    """`text` with every secret replaced by `[redacted]`."""
    return _current_pattern().sub(REDACTED, text)


def hide_detail(text: str) -> str:
    """`text` with each Postgres `DETAIL:` part (and any `Failing row contains` text) replaced
    by `DETAIL: [hidden]`. The rest of the error stays, so it still says what went wrong."""
    return _DETAIL.sub(DETAIL_HIDDEN, text)


def scrub(text: str) -> str:
    """`text` as safe to write: secrets redacted and Postgres row values hidden."""
    return hide_detail(redact(text))


def _scrub(text: str, pattern: re.Pattern[str]) -> str:
    return hide_detail(pattern.sub(REDACTED, text))


def _clean(value: Any, pattern: re.Pattern[str]) -> Any:
    """A value that is safe to write: every text in it is cleaned, whatever it is nested in."""
    if isinstance(value, str):
        return _scrub(value, pattern)
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, Mapping):
        return {
            pattern.sub(REDACTED, str(key)): _clean(item, pattern) for key, item in value.items()
        }
    if isinstance(value, list | tuple | set | frozenset):
        return [_clean(item, pattern) for item in value]
    return _scrub(str(value), pattern)  # anything else is written as its text anyway


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        pattern = _current_pattern()
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": _scrub(record.getMessage(), pattern),
        }
        # Extra fields, like run_id, passed with logger.info(..., extra={...}).
        for key, value in record.__dict__.items():
            if key not in _STANDARD and not key.startswith("_"):
                entry[pattern.sub(REDACTED, key)] = _clean(value, pattern)
        if record.exc_info:
            # The whole text, with every chained exception in it.
            entry["error"] = _scrub(self.formatException(record.exc_info), pattern)
        return json.dumps(entry, default=str)


# Loggers that are too chatty at INFO.
QUIET = ("alembic.runtime.plugins",)


def setup_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    for name in QUIET:
        logging.getLogger(name).setLevel(logging.WARNING)
