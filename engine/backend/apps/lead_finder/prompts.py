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


def extract_prompt(rules: LeadFinderRules) -> Prompt:
    """The form-filling instructions, with the trigger, booster and industry lists filled in."""
    template, version = _read("extract")
    criteria = rules.criteria
    triggers = "\n".join(f"- {t.id}: {t.label}" for t in criteria.triggers.every)
    boosters = "\n".join(f"- {b.id}: {b.label}" for b in criteria.boosters)
    groups = [*criteria.industries.director_review, *criteria.industries.check_office_size]
    text = Template(template).substitute(
        triggers=triggers, boosters=boosters, industry_groups="\n".join(f"- {g}" for g in groups)
    )
    # The lists come from the rules, so their version is part of this prompt's version.
    return Prompt("extract", text, f"{version}+{rules.version[:6]}")


def versions(rules: LeadFinderRules) -> str:
    return f"research {research_prompt().version}, extract {extract_prompt(rules).version}"
