"""The session cookie, written by hand so the same text is made by a route and by the guard.

- `contour_session` over plain http (on this computer), or `__Host-contour_session` over HTTPS.
  The browser accepts a `__Host-` cookie only if it is Secure, has no Domain and has Path=/, so it
  can't be set by a sibling site or kept off another path.
- Always `HttpOnly` (a page's script can't read it) and `SameSite=Strict` (it is never sent with
  a request that starts on another site).
- A session cookie (it goes when the browser closes) unless "Keep me signed in": then it lives as
  long as the session can.
"""

from starlette.requests import cookie_parser

PLAIN_NAME = "contour_session"
HOST_NAME = f"__Host-{PLAIN_NAME}"
EXPIRED = "Thu, 01 Jan 1970 00:00:00 GMT"


def cookie_name(secure: bool) -> str:
    return HOST_NAME if secure else PLAIN_NAME


def _attributes(secure: bool) -> str:
    return "Path=/; HttpOnly; SameSite=Strict" + ("; Secure" if secure else "")


def set_cookie(token: str, *, secure: bool, max_age: int | None) -> str:
    """The `Set-Cookie` text that gives the browser this token."""
    life = f"; Max-Age={max_age}" if max_age is not None else ""
    return f"{cookie_name(secure)}={token}; {_attributes(secure)}{life}"


def clear_cookie(*, secure: bool) -> str:
    """The `Set-Cookie` text that makes the browser forget the cookie."""
    return f"{cookie_name(secure)}=; {_attributes(secure)}; Max-Age=0; Expires={EXPIRED}"


def read_token(cookie_header: str | None, *, secure: bool) -> str | None:
    """The token in a `Cookie` header, or None. Only this one cookie is looked at."""
    if not cookie_header:
        return None
    return cookie_parser(cookie_header).get(cookie_name(secure)) or None
