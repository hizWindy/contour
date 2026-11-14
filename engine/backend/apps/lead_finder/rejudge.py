"""Judge saved leads again with the current rules, from the facts in their cards (PLAN-V2 D1).

It makes no searches and costs nothing. `table` shows what the current rules would say about leads
made under an older version, and saves nothing. A fact the current rules need but an older card
lacks is unknown, so its check says "not known yet". `save_rejudged` (`rejudge --save`) saves the
new verdict on each lead: its result, score, tier and confidence (PLAN-V16 T1-6).
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.lead_finder.fields import CompanyFacts
from apps.lead_finder.rules import LeadFinderRules
from apps.lead_finder.scoring import Override, Verdict, judge
from apps.lead_finder.tables import Lead
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
    now = judge(facts, hubspot, rules, today, overrides=overrides_of(card))
    return Rejudged(company, was_result, was_score, now, _changes(card.get("checks", []), now))


def overrides_of(card: dict[str, Any]) -> dict[str, Override]:
    """The exclusion a person overrode on this card (PLAN-V16 T1-3), so judging it again keeps it
    judged without the exclusion. Empty for a card with no override."""
    excluded = card.get("excluded")
    if not isinstance(excluded, dict) or not excluded.get("overridden_by"):
        return {}
    return {
        str(excluded["reason_id"]): Override(
            by=str(excluded["overridden_by"]), at=excluded["overridden_at"]
        )
    }


def table(items: list[Rejudged]) -> str:
    """A plain table, how many leads moved from one result to another, and the leads by tier."""
    lines = [
        f"{'Company':<24} {'Was':<16} {'Now':<16} {'Score':<10} {'Tier':<8} {'Confidence':<11} "
        "What changed",
    ]
    for item in items:
        now = item.now
        score = str(now.score)
        if now.score_before_dampeners != now.score:
            score += f" ({now.score_before_dampeners})"
        lines.append(
            f"{item.company[:24]:<24} {item.was_result:<16} {now.result:<16} {score:<10} "
            f"{now.tier:<8} {now.confidence:<11} {'; '.join(item.changes) or 'no rule changed'}"
        )
    moved = sum(1 for item in items if item.was_result != item.now.result)
    tiers = Counter(item.now.tier for item in items)
    by_tier = ", ".join(f"{name} {tiers[name]}" for name in ("A", "B", "C", "discard"))
    lines.append(f"\n{len(items)} leads, {moved} with a different result.")
    lines.append(f"By tier: {by_tier}.")
    return "\n".join(lines)


async def save_rejudged(
    session: AsyncSession, rules: LeadFinderRules, today: date
) -> list[Rejudged]:
    """Judges every saved lead again with the current rules and saves the new verdict on it
    (PLAN-V16 T1-6): its result, score, tier, confidence and card fields, and the rules version. A
    person's note, status and override stay, and so does a lead's own research. It costs nothing.
    A Why now is cleared where the result changed, as for any new verdict. Leads of the test set
    are left alone, as in the table."""
    from apps.lead_finder.research import LeadCard, apply_verdict, verdict_columns

    leads = await session.scalars(
        select(Lead).where(Lead.is_test.is_(False)).order_by(Lead.created_at)
    )
    done: list[Rejudged] = []
    for lead in leads.all():
        item = rejudge(lead.company, lead.result, lead.score, lead.card, rules, today)
        card = apply_verdict(LeadCard.model_validate(lead.card), item.now)
        card = card.model_copy(update={"rules_version": rules.version})
        for column, value in verdict_columns(card).items():
            setattr(lead, column, value)
        lead.rules_version = rules.version
        done.append(item)
    await session.commit()
    return done
