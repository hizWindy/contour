"""Every problem a person can see on the Companies pages has a title and a next step (PLAN-V18
T1-8), in `apps/companies/` and in core's meetings (`core/hubspot/meetings.py`):

- each `Problem(...)`, and each `refused(...)` a note's checks raise, has a title, and its detail
  says what to do (try again, pick, write, wait, ask or tell an admin ...);
- none names a command, a file, a local address or a setting (the scanner in
  test_safe_deploys.py);
- core's meetings errors (a `HubSpotError` the sync shows) follow the same rule;
- the sentences PLAN-V18's "Words for when things go wrong" gives are the ones sent.

The scan reads the code, so a problem added later is checked with no change here.
"""

import ast
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from apps.companies import meeting_form, meeting_send, meeting_store
from core.hubspot import meetings
from tests.core.test_safe_deploys import FORBIDDEN, SETTING_NAMES

BACKEND = Path(__file__).resolve().parents[2]
FILES = [*sorted(BACKEND.glob("apps/companies/**/*.py")), BACKEND / "core/hubspot/meetings.py"]
MAKERS = {"Problem", "refused", "HubSpotError"}  # what builds a problem: (status,) title, detail
# The verbs a next step starts with, after a full stop, and the ones that hand it to an admin.
DO = (
    "Try|Ask|Check|Pick|Write|Switch|Start|Wait|Use|Open|Press|Take|Fill|Shorten|Send|Look|Add|"
    "Copy|Draft|Link|Connect|Say|Remove|Save|Sign|Go|Reload|Choose|Type|Keep|Clear|Tell|Give|"
    "Paste|Log|Change|Retire|Sync|Prep|Leave"
)
NEXT_STEP = re.compile(rf"(?:^|[.:!?]\s+)(?:{DO})\b|\ban? admin\b|\byou can\b", re.IGNORECASE)
HOLE = "{}"  # where an f-string puts a value


@dataclass(frozen=True)
class Found:
    where: str
    title: str | None
    detail: str | None


def text_of(node: ast.expr, names: dict[str, str]) -> str | None:
    """A string, an f-string with holes, or a module constant's text. None for anything else."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = [
            text_of(part, names) if isinstance(part, ast.Constant) else HOLE for part in node.values
        ]
        return "".join(part or HOLE for part in parts)
    if isinstance(node, ast.Name):
        return names.get(node.id)
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return names.get(node.attr)
    return None


def constants(tree: ast.Module) -> dict[str, str]:
    """The module's own text constants, like TOO_MANY_DETAIL, joined across lines."""
    found: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name):
                value = text_of(node.value, found)
                if value is not None:
                    found[target.id] = value
    return found


def caller(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


def problems() -> Iterator[Found]:
    for path in FILES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        names = constants(tree)
        where = path.relative_to(BACKEND).as_posix()
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and caller(node) in MAKERS):
                continue
            args = list(node.args)
            if args and isinstance(args[0], ast.Constant) and isinstance(args[0].value, int):
                args = args[1:]  # Problem(404, title, detail): the status first
            if not args:
                continue
            title = text_of(args[0], names)
            detail = text_of(args[1], names) if len(args) > 1 else None
            if title is None and isinstance(args[0], ast.Name | ast.Attribute):
                continue  # passes on what it was given: where it is made is checked instead
            yield Found(f"{where}:{node.lineno}", title, detail)


def test_the_scan_reads_the_companies_problems() -> None:
    found = list(problems())
    assert len(found) > 40
    assert any(item.where.startswith("core/hubspot/meetings.py") for item in found)


def test_every_problem_has_a_title_and_a_next_step() -> None:
    no_title = [item.where for item in problems() if not (item.title or "").strip()]
    no_step = [
        (item.where, item.detail)
        for item in problems()
        if item.detail is not None and not NEXT_STEP.search(item.detail)
    ]
    assert no_title == []
    assert no_step == []


def test_no_problem_names_a_command_a_file_or_a_setting() -> None:
    bad = [
        (item.where, text)
        for item in problems()
        for text in (item.title, item.detail)
        if text is not None and (FORBIDDEN.search(text) or SETTING_NAMES.search(text))
    ]
    assert bad == []


def test_the_plans_words_are_the_ones_sent() -> None:
    """PLAN-V18 "Words for when things go wrong", Meetings and the pre-read."""
    assert meeting_store.NOT_LINKED == (
        "Your account isn't linked to a HubSpot owner yet, so My meetings is empty. All shows "
        "everyone's. An admin can link you in Admin, People."
    )
    assert meeting_store.NO_TEAM == (
        "You aren't in a HubSpot team yet, so My team is empty. All shows everyone's."
    )
    assert meeting_store.SYNC_WAITING == (
        "Waiting for HubSpot access to meetings. An admin adds it in HubSpot. You can still "
        "start a new pre-read."
    )
    assert f"{meetings.NOT_READ_YET} {meeting_store.STILL_WORKS}" == (
        "Meetings can't be read from HubSpot yet. You can still start a new pre-read."
    )
    assert meeting_form.DAILY_LIMIT == (
        "The summaries weren't written: today's AI spending limit is reached. Write them "
        "yourself, or draft again tomorrow."
    )
    ai_service = (
        "The summaries weren't written: the AI service didn't answer. Try again in a minute, "
        "or write them yourself."
    )
    assert meeting_form.UNREACHABLE == meeting_form.CLAUDE_ERROR == ai_service
    assert meeting_send.email_not_set_up().detail == (
        "Email isn't set up yet, so nothing was sent. The pre-read stays here: copy it, or send "
        "it once email is set up."
    )


def test_the_next_step_check_tells_a_step_from_none() -> None:
    assert NEXT_STEP.search("Nothing was sent. Try again in a minute.")
    assert NEXT_STEP.search("Meetings are switched off. An admin can switch them on in Settings.")
    assert not NEXT_STEP.search("It may have been removed, or it isn't open to your account.")
    assert not NEXT_STEP.search("Only an active team note can be retired.")
