"""Cleaning of text that comes from outside: a typed list, a web page, or Claude's answer.

Pure code: no AI, no database, no input or output. Every way into the Lead Finder uses these
functions, so a company name or a web address that could confuse a prompt, a page or a file
is stopped in one place.

The rule for names is to reject, not to repair. A name that isn't usable becomes "name not
usable" in the run feed, and a person can see it. A name is never cut short.
"""

import json
import re
import unicodedata
from collections.abc import Iterable, Mapping
from typing import Any
from urllib.parse import urlsplit

# Unicode categories that are never wanted in text we use: control characters (Cc), format
# characters such as zero-width spaces and the bidi controls that reorder text (Cf), lone
# surrogates (Cs), private use (Co) and unassigned code points (Cn).
DROPPED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn"})
# Besides those, line and paragraph separators, and any kind of space, count as blank.
BLANK_CATEGORIES = frozenset({"Zs", "Zl", "Zp"})
# Characters that are not letters but that NFKC may turn into other characters: symbols (other,
# modifier, currency), like the trademark sign (TM) and the rupee sign (Rs), and numbers that
# are not plain digits (other, letter-like), like the superscript two (2) and the roman
# numeral eight (VIII). Plain digits (Nd) are not in this list: full-width digits are fine.
REWRITTEN_SYMBOL_CATEGORIES = frozenset({"So", "Sk", "Sc", "No", "Nl"})
# This includes the curly apostrophe (U+2019), as phones type it in O'Connor.
NAME_PUNCTUATION = frozenset("&'\u2019.,-()/")

NAME_MIN_CHARS = 2
NAME_MAX_CHARS = 80
NAME_MAX_WORDS = 8
DOMAIN_MAX_CHARS = 100
URL_MAX_CHARS = 500

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_DOMAIN = re.compile(rf"(?:{_LABEL}\.)+(?:[a-z]{{2,24}}|xn--[a-z0-9-]{{2,59}})")
_SCHEME = re.compile(r"https?://", re.IGNORECASE)


def _is_blank(char: str) -> bool:
    return char.isspace() or unicodedata.category(char) in BLANK_CATEGORIES


def normalize(value: str) -> str:
    """NFKC, then one line: blanks and line breaks become one space, unwanted characters go.

    A tab or a line break between two words is a blank, so the words stay apart. Zero-width
    and bidi characters have no width, so they just disappear.
    """
    text = unicodedata.normalize("NFKC", value)
    kept = (
        " " if _is_blank(char) else char
        for char in text
        if _is_blank(char) or unicodedata.category(char) not in DROPPED_CATEGORIES
    )
    return " ".join("".join(kept).split())


def _symbol_would_be_rewritten(value: str) -> bool:
    """True if NFKC would turn a symbol or a special number into other characters.

    The trademark sign becomes the letters TM, the rupee sign becomes Rs, the superscript two
    becomes a 2 and the roman numeral eight becomes VIII (categories So, Sk, Sc, No and Nl).
    Letters and digits in another form (full-width, ligatures) are fine: they become plain
    ones.
    """
    return any(
        unicodedata.category(char) in REWRITTEN_SYMBOL_CATEGORIES
        and unicodedata.normalize("NFKC", char) != char
        for char in value
    )


def _allowed_in_name(char: str) -> bool:
    category = unicodedata.category(char)
    return category.startswith("L") or category == "Nd" or char == " " or char in NAME_PUNCTUATION


def clean_company_name(value: str | None) -> str | None:
    """A usable company name, or None to reject it.

    NFKC, unwanted characters dropped, whitespace collapsed. Then only letters, digits, a
    space and & ' . , - ( ) / (or the curly apostrophe) may remain, with at least one letter
    or digit. 2 to 80 characters, at most 8 words. A name that fails any of this is rejected
    whole. So is a name with a symbol or special number that NFKC would rewrite (the trademark
    sign becomes the letters TM, a superscript two becomes a 2), because the name that is stored
    would no longer be the one that was typed.
    """
    if value is None:
        return None
    if _symbol_would_be_rewritten(value):
        return None
    name = normalize(value)
    if not NAME_MIN_CHARS <= len(name) <= NAME_MAX_CHARS:
        return None
    if len(name.split(" ")) > NAME_MAX_WORDS:
        return None
    if not all(_allowed_in_name(char) for char in name):
        return None
    if not any(char.isalnum() for char in name):
        return None
    return name


def _fold(value: str) -> str:
    return normalize(value).casefold()


def clean_city(value: str | None, cities: Iterable[str]) -> str | None:
    """The run's own spelling of the city if the value is one of its cities, else None."""
    if value is None:
        return None
    wanted = _fold(value)
    if not wanted:
        return None
    for city in cities:
        if _fold(city) == wanted:
            return city
    return None


def clean_domain(value: str | None) -> str | None:
    """A bare domain like acme.com.au, or None.

    Case is lowered. A leading http:// or https://, a leading www. and a closing slash are
    removed, because they say nothing more. Anything else beyond the domain (a path, a port,
    a query, a login, a space, a character outside a-z, 0-9, hyphen and dot) makes it invalid.
    Text that isn't plain ASCII is rejected before its case is lowered. At most 100
    characters, with at least one dot.
    """
    if value is None:
        return None
    text = value.strip()
    # Before lower(): the Kelvin sign (U+212A) lowers to a plain k, so a non-ASCII domain
    # would otherwise pass as an ASCII one.
    if not text.isascii():
        return None
    text = text.lower()
    if len(text) > DOMAIN_MAX_CHARS + len("https://www./"):
        return None
    text = _SCHEME.sub("", text, count=1).removesuffix("/").removeprefix("www.")
    if len(text) > DOMAIN_MAX_CHARS:
        return None
    return text if _DOMAIN.fullmatch(text) else None


def one_line(value: str | None, max_chars: int) -> str:
    """Text on one line, with unwanted characters gone and at most `max_chars` characters.

    A longer text is cut and ends with an ellipsis. For the short sentences Claude writes
    (what happened, a note's claim), where cutting after parsing beats rejecting a paid answer.
    """
    if not value:
        return ""
    text = normalize(value)
    if len(text) <= max_chars:
        return text
    if max_chars <= 1:
        return text[:max_chars]
    return text[: max_chars - 1].rstrip() + "…"


def json_text(value: str | None, max_chars: int = 400) -> str:
    """A value as a JSON string, for a prompt: `"Acme"`. Quotes and line breaks are escaped,
    so the value can't end its own line or pretend to be an instruction."""
    return json.dumps(one_line(value, max_chars), ensure_ascii=False)


def json_line(fields: Mapping[str, Any], max_chars: int = 400) -> str:
    """A small record as one line of JSON, for a prompt. Text values are cleaned and cut first.

    Example: `{"claim": "Acme moves", "url": "https://...", "published": null}`.
    """
    clean = {
        key: one_line(value, max_chars) if isinstance(value, str) else value
        for key, value in fields.items()
    }
    return json.dumps(clean, ensure_ascii=False)


def safe_http_url(url: str | None) -> bool:
    """True only for a plain web address we may store and show as a link.

    The scheme is http or https, a host is present, there is no login in it (`user:pw@`), no
    space or control character anywhere, no backslash, and it is at most 500 characters. The
    host has no `%`, no closing dot and only plain ASCII characters, because each can hide a
    blocked site: a browser reads full-width letters, the ideographic full stop and the
    full-width full stop as the plain letters and dot. A site with a non-English name is
    written as `xn--...` (punycode), which is ASCII and so still passes.
    """
    if not url or len(url) > URL_MAX_CHARS:
        return False
    # Check the raw text: urlsplit quietly deletes tabs and line breaks, which hides them.
    for char in url:
        if _is_blank(char) or char == "\\" or unicodedata.category(char) in DROPPED_CATEGORIES:
            return False
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises ValueError for a port that isn't a number
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    host = parts.hostname
    if not host:
        return False
    # A browser reads %2e as a dot (and %70 as a p), so a host with a % in it could be a
    # blocked site in disguise. A closing dot names the same site as the host without it.
    # Browsers also map non-ASCII look-alikes (UTS 46) onto plain letters and dots, so
    # a full-width p or an ideographic full stop in 'propertydaily.com.au' is the blocked site
    # too. A real address writes such a name as xn-- (punycode).
    # The raw netloc is checked, not `host`: `hostname` lowers its text, and the Kelvin sign
    # (U+212A) lowers to a plain k, so the host would look like ASCII.
    if "%" in host or host.endswith(".") or not parts.netloc.isascii():
        return False
    return "@" not in parts.netloc
