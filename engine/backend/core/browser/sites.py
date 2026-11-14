"""A site the browser may read (PLAN-V16 T2-3).

Only the site's own hosts load: every other host, and every image, font and video, is blocked in
the browser itself. Some paths are never opened at all, because opening them changes something
(signing out, adding to a shortlist) or isn't ours to read (payments, account details).
"""

from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

from core.sources.types import SourceId


@dataclass(frozen=True)
class Site:
    id: SourceId
    name: str
    hosts: frozenset[str]  # lower case, like "www.spatialgroup.com.au"
    never_open: tuple[str, ...] = ()  # lower-case parts of a path or query, like "logout"
    # How the sign-in page shows itself: a part of its address, or words on it.
    signin_url_marks: tuple[str, ...] = ()
    signin_text_marks: tuple[str, ...] = ()
    # Words that mean a person-check or a lock on this site, on top of the common ones.
    captcha_marks: tuple[str, ...] = ()
    lockout_marks: tuple[str, ...] = ()

    def own_host(self, url: str) -> bool:
        parts = urlsplit(url)
        return parts.scheme in ("http", "https") and (parts.hostname or "") in self.hosts

    def may_open(self, url: str) -> bool:
        """True for an address on the site's own hosts that isn't on the never-open list."""
        if not self.own_host(url):
            return False
        parts = urlsplit(url)
        # The path and the names of the query's parts, never their values: a search for "Sample
        # Payments Group" is not the payments page (the review before PLAN-V16's M1 found this)
        names = "&".join(name for name, _ in parse_qsl(parts.query, keep_blank_values=True))
        where = f"{parts.path}?{names}".lower()
        return not any(mark in where for mark in self.never_open)
