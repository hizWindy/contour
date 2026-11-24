"""What a person reads about live voice (PLAN-V28 "Words on screen"): the refusals of a start, and
the line a talk ends with. Plain words: no setting names, no commands (the scans in
tests/core/test_safe_deploys.py and tests/companies/test_problem_words.py read this file).
"""

from typing import Final

from apps.companies.live_voice.messages import EndReason
from core.api.errors import Problem

FREE_MIC: Final = "Using the free mic."
LIMIT_LINE_DETAIL: Final = "Live voice is off for now: this month's limit is reached. " + FREE_MIC
UNREACHABLE_LINE_DETAIL: Final = "Live voice can't reach Google. " + FREE_MIC
DROPPED_LINE_DETAIL: Final = "Live voice stopped: the connection dropped. " + FREE_MIC
WRONG_LINE_DETAIL: Final = "Live voice stopped: something went wrong. " + FREE_MIC
IDLE_LINE_DETAIL: Final = (
    "Live voice stopped: nothing was heard for a while. Press V to start again."
)
REPLACED_LINE_DETAIL: Final = "Live voice moved to your newer window."
TIMEOUT_TOOL_DETAIL: Final = "That took too long. Try again."  # the relay's tool answer (TBC)
BUSY_RETRY_SECONDS: Final = 30


def talk_limit_line(minutes: int) -> str:
    return f"Live voice stopped: a talk lasts {minutes} minutes at most. Press V to start again."


def ended_line(reason: EndReason, *, talk_minutes: int) -> str | None:
    """The line a talk ends with, for the pill. None where nothing needs saying (the rep stopped
    it, or left), or where the browser comes back by itself (a restart)."""
    lines: dict[str, str | None] = {
        "limit": LIMIT_LINE_DETAIL,
        "unreachable": UNREACHABLE_LINE_DETAIL,
        "dropped": DROPPED_LINE_DETAIL,
        "refused": WRONG_LINE_DETAIL,
        "error": WRONG_LINE_DETAIL,
        "expired": WRONG_LINE_DETAIL,
        "idle": IDLE_LINE_DETAIL,
        "replaced": REPLACED_LINE_DETAIL,
        "time_limit": talk_limit_line(talk_minutes),
    }
    return lines.get(reason)


# --- A start refused (POST /assistant/voice/session) ----------------------------------------------


def not_allowed(asker: str | None) -> Problem:
    """403: the person's own switch is off (choice 16)."""
    return Problem(
        403,
        "Live voice isn't on for you",
        "Live voice is paid by the minute, so it is turned on for each person. Ask "
        f"{asker or 'the Platform admin'} to turn it on. You can still use the free mic.",
        code="live_voice_not_allowed",
    )


def switched_off() -> Problem:
    """409: the server's switch is off, or it has no key (choice 17)."""
    return Problem(
        409,
        "Live voice is off",
        "Live voice is switched off on the server. Use the free mic or type.",
        code="live_voice_off",
    )


def month_limit(retry_seconds: int) -> Problem:
    """429: this month's limit is reached (choice 18). It comes back when the month changes."""
    return Problem(
        429,
        "This month's live voice limit is reached",
        "Live voice is off for now: this month's limit is reached. Use the free mic, or ask the "
        "Platform admin to raise the limit.",
        code="live_voice_limit",
        headers={"Retry-After": str(retry_seconds)},
    )


def busy() -> Problem:
    """503: the server's talks at once are taken (choice 20)."""
    return Problem(
        503,
        "Live voice is busy",
        "Too many people are using live voice right now. Try again in a minute, or use the free "
        "mic.",
        code="live_voice_busy",
        headers={"Retry-After": str(BUSY_RETRY_SECONDS)},
    )


def too_many_starts(wait_seconds: int) -> Problem:
    """429: a lot of starts in one minute (a guard against a stuck page)."""
    return Problem(
        429,
        "Too many starts",
        "Live voice was started a lot in one minute. Wait a moment, then press V again.",
        code="too_many_starts",
        headers={"Retry-After": str(wait_seconds)},
    )


def month_line(minutes: int, spent_usd: str, cap_usd: str) -> str:
    """The Admin settings line: "Live voice this month: 42 minutes, about US$0.51 of US$4.00."."""
    unit = "minute" if minutes == 1 else "minutes"
    return f"Live voice this month: {minutes} {unit}, about US${spent_usd} of US${cap_usd}."
