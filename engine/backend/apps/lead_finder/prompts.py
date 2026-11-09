"""Loads the instructions for Claude from prompts/, and gives each a version.

The version is a fingerprint of the file, so every saved lead shows which wording made it.
"""

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from string import Template

from apps.lead_finder.rules import LeadFinderRules

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


@dataclass(frozen=True)
class Prompt:
    name: str
    text: str
    version: str


def _read(name: str) -> tuple[str, str]:
    raw = (PROMPTS_DIR / f"{name}.md").read_bytes().replace(b"\r\n", b"\n")
    return raw.decode("utf-8"), hashlib.sha256(raw).hexdigest()[:12]


@lru_cache
def research_prompt() -> Prompt:
    text, version = _read("research")
    return Prompt("research", text, version)


@lru_cache
def discover_prompt() -> Prompt:
    """The discovery instructions. They hold no rules and no lists, so the version is the file's."""
    text, version = _read("discover")
    return Prompt("discover", text, version)


def extract_prompt(rules: LeadFinderRules) -> Prompt:
    """The form-filling instructions, with the trigger, booster and industry lists filled in."""
    template, version = _read("extract")
    criteria = rules.criteria
    # The old office's sign isn't Claude's to find: the code adds it (PLAN-V11 C1)
    triggers = "\n".join(f"- {t.id}: {t.label}" for t in criteria.claude_triggers)
    boosters = "\n".join(f"- {b.id}: {b.label}" for b in criteria.boosters)
    industries = criteria.industries
    groups = [*industries.director_review, *industries.check_office_size]
    tiers = [*industries.tier_1, *industries.tier_2]
    text = Template(template).substitute(
        triggers=triggers,
        boosters=boosters,
        industry_groups="\n".join(f"- {g}" for g in groups),
        tier_groups="\n".join(f"- {g}" for g in tiers),
    )
    # The lists come from the rules, so their version is part of this prompt's version.
    return Prompt("extract", text, f"{version}+{rules.version[:6]}")


def versions(rules: LeadFinderRules) -> str:
    """The versions a saved lead shows: the two prompts that make a lead."""
    return f"research {research_prompt().version}, extract {extract_prompt(rules).version}"


def run_versions(rules: LeadFinderRules) -> str:
    """The versions a run shows: research, extract and discover (at most 128 characters)."""
    return f"{versions(rules)}, discover {discover_prompt().version}"
