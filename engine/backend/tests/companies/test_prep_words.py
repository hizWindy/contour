"""Call prep's error words (PLAN-V15 T3-7):

- no message call prep can show holds a command, a file name or a local address;
- each kind of Claude failure gets its own plain words and a code, never Claude's raw text;
- a failed prep says one thing to do ("Try again"), and keeps why in its facts;
- "Claude's answer came back incomplete" replaces the form words;
- a line edit with a phone number says it can't be saved in a script line, without Claude;
- the facts say when the HubSpot copy was last synced, so the card can say it is old.
"""

import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import anthropic
import pytest
from pydantic import BaseModel

from apps.companies import api_preps, prep, script_notes
from apps.companies.prep import PrepRunner, claude_words
from apps.companies.tables import Prep
from core.api.deps import settings_dependency
from core.claude.client import ClaudeError, ClaudeUnavailable, Reply, WebTools
from core.claude.daily import DailyLimitReached
from core.hubspot.models import HubSpotSync
from tests.companies.helpers import API, add, signed_in_as
from tests.companies.test_prep import FakeClaude, people_and_calls, prep_settings
from tests.core.auth_world import World
from tests.lead_finder.factories import FakeEmbedder

# A command, a file name, a setting's name or a local address: never on screen.
TECHNICAL = re.compile(
    r"uv run|docker|engine serve|\.env\b|localhost|127\.0\.0\.1|[A-Z]{3,}_[A-Z_]{3,}|\.py\b|"
    r"\(\d{3}\)|Traceback|Exception",
)


def _cause(kind: type[BaseException], **attributes: Any) -> BaseException:
    """An SDK error made without a request or a response, for its type alone."""
    error = kind.__new__(kind)
    for name, value in attributes.items():
        setattr(error, name, value)
    return error


def claude_error(error: ClaudeError, cause: BaseException | None) -> ClaudeError:
    error.__cause__ = cause
    return error


CASES = [
    (
        claude_error(ClaudeError("Rate", "Wait."), _cause(anthropic.RateLimitError)),
        "claude_busy",
    ),
    (
        claude_error(
            ClaudeError("Claude returned an error (529)", "Overloaded {raw}"),
            _cause(anthropic.APIStatusError, status_code=529),
        ),
        "claude_busy",
    ),
    (
        claude_error(
            ClaudeError("Claude returned an error (400)", "raw text"),
            _cause(anthropic.APIStatusError, status_code=400),
        ),
        "claude_error",
    ),
    (
        claude_error(ClaudeError("Slow", "Timed out"), _cause(anthropic.APITimeoutError)),
        "timeout",
    ),
    (
        claude_error(
            ClaudeUnavailable("Can't reach Claude", "Check the internet connection."),
            _cause(anthropic.APIConnectionError),
        ),
        "unreachable",
    ),
    (
        claude_error(
            ClaudeUnavailable("Claude rejected the API key", "Check ANTHROPIC_API_KEY."),
            _cause(anthropic.AuthenticationError),
        ),
        "claude_setup",
    ),
    (claude_error(ClaudeUnavailable("No key", "Add it to engine/.env."), None), "claude_setup"),
]


@pytest.mark.parametrize(("error", "code"), CASES)
def test_each_claude_failure_has_its_own_plain_words(error: ClaudeError, code: str) -> None:
    found, words = claude_words(error)
    assert found == code
    assert not TECHNICAL.search(words), words
    assert error.detail not in words


def test_no_call_prep_message_holds_a_command_a_file_or_a_local_address() -> None:
    messages = [
        prep.STUCK_ERROR,
        prep.STOPPED,
        prep.INCOMPLETE,
        prep.SERVER_FAULT,
        prep.DAILY_LIMIT,
        prep.CLAUDE_BUSY,
        prep.UNREACHABLE,
        prep.CLAUDE_SETUP,
        prep.TOO_SLOW,
        prep.CLAUDE_ERROR,
    ]
    problems = [
        api_preps.company_not_found(),
        api_preps.prep_not_found(),
        api_preps.prep_off(),
        api_preps.prep_running(),
        script_notes.contact_details(),
        script_notes.contact_details(line=True),
        script_notes.admins_only(),
    ]
    messages += [f"{problem.title}. {problem.detail}" for problem in problems]
    for message in messages:
        assert not TECHNICAL.search(message), message
        # One thing to do: never "Press Research again" and "Try again" together.
        assert not ("Research again" in message and "Try again" in message), message
    assert prep.INCOMPLETE == "Claude's answer came back incomplete. Try again."
    assert "script line" in str(script_notes.contact_details(line=True).detail)
    assert "Claude" not in str(script_notes.contact_details(line=True).detail)
    assert "Claude" in str(script_notes.contact_details().detail)


# --- A failed prep, end to end ------------------------------------------------------------------


class FailingClaude(FakeClaude):
    """Raises the error it is given, or answers with nothing that fits the form."""

    def __init__(self, error: BaseException | None) -> None:
        super().__init__()
        self.error = error

    async def ask[T: BaseModel](
        self,
        *,
        system: str,
        prompt: str,
        form: type[T],
        web: WebTools | None = None,
        model: str | None = None,
        effort: str | None = None,
        max_continues: int | None = None,
    ) -> Reply[T]:
        if self.error is not None:
            raise self.error
        self.replies = [(None, "0.01", [])]
        return await super().ask(
            system=system,
            prompt=prompt,
            form=form,
            web=web,
            model=model,
            effort=effort,
            max_continues=max_continues,
        )


async def failed_prep(world: World, claude: FakeClaude) -> Prep:
    runner = PrepRunner(sessions=world.factory, claude=lambda: claude, embedder=FakeEmbedder)
    world.app.state.prep_runner = runner
    world.app.dependency_overrides[settings_dependency] = lambda: prep_settings()
    await people_and_calls(world)
    async with signed_in_as(world, "mia", ["companies"]) as client:
        started = await client.post(f"{API}/preps", json={"company_key": "101", "contact_id": "c1"})
        assert started.status_code == 202, started.text
        await runner.wait()
    async with world.factory() as db:
        done = await db.get(Prep, started.json()["id"])
        assert done is not None
        return done


@pytest.mark.integration
@pytest.mark.parametrize(
    ("error", "code", "words"),
    [
        (CASES[1][0], "claude_busy", prep.CLAUDE_BUSY),
        (CASES[4][0], "unreachable", prep.UNREACHABLE),
        (
            DailyLimitReached(
                cap=Decimal(5), spent=Decimal(5), held=Decimal(0), needed=Decimal("0.25")
            ),
            "daily_limit",
            prep.DAILY_LIMIT,
        ),
        (RuntimeError("a bug"), "server", prep.SERVER_FAULT),
        (None, "incomplete", prep.INCOMPLETE),
    ],
)
async def test_a_failed_prep_says_what_happened_and_keeps_why(
    world: World, error: BaseException | None, code: str, words: str
) -> None:
    done = await failed_prep(world, FailingClaude(error))
    assert done.status == "failed"
    assert done.error == words
    assert (done.facts or {}).get("error_code") == code


# --- Line edits and the copy's age --------------------------------------------------------------


@pytest.mark.integration
async def test_a_line_with_a_phone_number_says_so_without_claude(world: World) -> None:
    async with signed_in_as(world, "mia", ["companies"]) as client:
        line = await client.put(
            f"{API}/script-edits",
            json={"company_key": "101", "slot": "goal", "text": "Ring 0412 345 678."},
        )
        style = await client.put(f"{API}/script-style/mine", json={"text": "Ring 0412 345 678."})
    assert line.status_code == style.status_code == 422
    assert line.json()["detail"].startswith("Phone numbers and emails can't be saved in a script")
    assert "Claude" in style.json()["detail"]


@pytest.mark.integration
async def test_the_facts_say_when_the_copy_was_last_synced(world: World) -> None:
    await people_and_calls(world)
    world.app.dependency_overrides[settings_dependency] = lambda: prep_settings()
    synced = datetime.now(UTC) - timedelta(days=3)
    await add(
        world,
        HubSpotSync(
            mode="full", trigger="schedule", status="failed", finished_at=datetime.now(UTC)
        ),
        HubSpotSync(mode="full", trigger="schedule", status="done", finished_at=synced),
    )
    async with signed_in_as(world, "mia", ["companies"]) as client:
        facts = (await client.get(f"{API}/101/facts")).json()
    # The failed sync after it doesn't count: the copy is as old as the last good one.
    assert datetime.fromisoformat(facts["copy_at"]) == synced
