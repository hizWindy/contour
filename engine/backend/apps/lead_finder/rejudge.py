"""Judge saved leads again with the current rules, from the facts in their cards (PLAN-V2 D1).

It makes no searches, costs nothing and saves nothing. It shows what the current rules would say
about leads made under an older version. A fact the current rules need but an older card lacks
is unknown, so its check says "not known yet".
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from pydantic import TypeAdapter

from apps.lead_finder.fields import CompanyFacts
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.scoring import Verdict, judge
from core.hubspot.matching import HubSpotMatch

RULE_RENAMES = {"Industry": "Office"}  # version 1 called the office check "Industry"
OUTCOME_WORDS = {
    "ok": "met",
    "fail": "not met",
    "director": "Director review",
    "unknown": "not known",
    "flag": "check",
}


@dataclass(frozen=True)
class Rejudged:
    company: str
    was_result: str
    was_score: int
    now: Verdict
    changes: list[str]  # the rule checks whose outcome changed, in plain words


def _changes(old_checks: list[dict[str, Any]], now: Verdict) -> list[str]:
    before = {RULE_RENAMES.get(c["rule"], c["rule"]): c["outcome"] for c in old_checks}
    found = []
    for check in now.checks:
        was = before.get(check.rule)
        if was is not None and was != check.outcome:
            found.append(f"{check.rule}: {OUTCOME_WORDS[was]} to {OUTCOME_WORDS[check.outcome]}")
    return found


def rejudge(
    company: str,
    was_result: str,
    was_score: int,
    card: dict[str, Any],
    rules: LeadFinderRules,
    today: date,
) -> Rejudged:
    """The lead as the current rules judge it, and what changed from its saved rule checks."""
    facts = CompanyFacts.model_validate(card["facts"])
    hubspot = TypeAdapter(HubSpotMatch).validate_python(card["hubspot"])
    now = judge(facts, hubspot, rules, today)
    return Rejudged(company, was_result, was_score, now, _changes(card.get("checks", []), now))


def table(items: list[Rejudged]) -> str:
    """A plain table, and how many leads moved from one result to another."""
    lines = [
        f"{'Company':<24} {'Was':<16} {'Now':<16} {'Points':<10} {'Band':<15} What changed",
    ]
    for item in items:
        now = item.now
        points = f"{now.score} of {now.score_checked}" if now.score_checked else "-"
        lines.append(
            f"{item.company[:24]:<24} {item.was_result:<16} {now.result:<16} {points:<10} "
            f"{now.band or '-':<15} {'; '.join(item.changes) or 'no rule changed'}"
        )
    moved = sum(1 for item in items if item.was_result != item.now.result)
    lines.append(f"\n{len(items)} leads, {moved} with a different result.")
    return "\n".join(lines)
