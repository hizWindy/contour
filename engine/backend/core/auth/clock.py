"""The one clock the sign-in uses. Tests move it: `app.state.clock = lambda: later`.

A request reads the clock once (the route's dependency, or the guard) and passes `now` down, so
every limit in a request is measured from one moment.
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)
