"""The sentences a person reads when the sign-in says no, in the plain words the login page shows.

Kept in one place so the API, the website and the tests agree, and so no message can leak a detail
it shouldn't: the wrong-login message is the same whether the email or the password was wrong.
"""

import math
from datetime import timedelta

INVALID_LOGIN = "That email or password isn't right."
SIGN_IN_NEEDED = "Sign in to use Contour HQ."
SIGNED_OUT = "You were signed out. Sign in again."


def duration(span: timedelta) -> str:
    """ "2 hours", "90 minutes", "14 days": the whole unit it fits, else minutes."""
    minutes = max(1, round(span.total_seconds() / 60))
    if minutes % (24 * 60) == 0:
        days = minutes // (24 * 60)
        return f"{days} day" if days == 1 else f"{days} days"
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"


def wait(seconds: float) -> str:
    """How long to wait, rounded up: "30 seconds", "1 minute", "12 minutes"."""
    whole = max(1, math.ceil(seconds))
    if whole < 60:
        return f"{whole} second" if whole == 1 else f"{whole} seconds"
    minutes = math.ceil(whole / 60)
    return f"{minutes} minute" if minutes == 1 else f"{minutes} minutes"


def too_many_tries(seconds: float) -> str:
    return f"Too many tries. Try again in {wait(seconds)}."


def signed_out_idle(idle: timedelta) -> str:
    return f"You were signed out after {duration(idle)} idle."


def signed_out_expired(lasted: timedelta) -> str:
    return f"Your session ended after {duration(lasted)}. Sign in again."
