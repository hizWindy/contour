"""What a call command's own words say, read by code (PLAN-V25 T3-1 and T3-3): the call type and
whether the call is only an outcome. Free: no Claude request.

- **The call type** (choice 12): "Prospecting Call" unless the command words at its start say
  another, like "log a follow-up call with Jo" or "a networking call". On an open card, "make it a
  follow-up call" changes it.
- **Only an outcome** (choice 15): "No answer, Jo Sample" or "Jo Sample didn't pick up" says how
  the call went and nothing else: once the outcome, the names and the command words are taken
  out, no word is left. Any other word ("she's moving in March") means a note, so the card opens.
  Only No answer, Left voicemail, Busy and Wrong number may be a quick log: a Connected call has
  something to say.
"""

import re
from collections.abc import Sequence
from typing import Final, cast

from apps.companies.schemas import CallType, OutcomeName
from core.hubspot.activities import CALL_TYPES

DEFAULT: Final[CallType] = "Prospecting Call"
QUICK_OUTCOMES: Final[frozenset[str]] = frozenset(
    {"No answer", "Left voicemail", "Busy", "Wrong number"}
)

# Each call type and the words that name it, checked in this order.
TYPE_WORDS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("Follow Up Call", re.compile(r"\bfollow[\s-]*up\s+(?:phone\s+)?call\b")),
    ("Agent/Networking Phone Call", re.compile(r"\b(?:networking|agent)(?:\s+phone)?\s+call\b")),
    ("Prospecting Call", re.compile(r"\bprospecting(?:\s+call)?\b")),
)

# Each outcome and the words that say it, the longest first, so "left a voicemail" is never
# read as "busy" or "no answer".
OUTCOME_WORDS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("Wrong number", re.compile(r"\bwrong\s+number\b")),
    (
        "Left voicemail",
        re.compile(r"\b(?:left\s+(?:a\s+|them\s+a\s+|him\s+a\s+|her\s+a\s+)?)?voice\s*-?mail\b"),
    ),
    (
        "No answer",
        re.compile(
            r"\bno\s+answer\b|\bnot\s+answering\b|\bunanswered\b|\bno\s+pick\s*-?\s*up\b"
            r"|\b(?:didn't|didnt|did\s+not|don't|dont|won't|wont)\s+(?:answer|pick\s+up)\b"
        ),
    ),
    ("Busy", re.compile(r"\b(?:line\s+)?(?:was\s+)?(?:busy|engaged)\b")),
)

# Words a call command uses that say nothing about the call itself.
COMMAND_WORDS: Final = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "so",
        "just",
        "again",
        "also",
        "please",
        "ok",
        "okay",
        "yeah",
        "yes",
        "log",
        "logged",
        "logging",
        "call",
        "called",
        "calling",
        "calls",
        "rang",
        "ring",
        "rung",
        "phone",
        "phoned",
        "phoning",
        "tried",
        "try",
        "trying",
        "gave",
        "give",
        "dial",
        "dialled",
        "dialed",
        "with",
        "to",
        "from",
        "at",
        "for",
        "of",
        "on",
        "about",
        "re",
        "i",
        "i've",
        "ive",
        "me",
        "my",
        "we",
        "our",
        "it",
        "its",
        "it's",
        "was",
        "were",
        "is",
        "there",
        "they",
        "them",
        "he",
        "him",
        "she",
        "her",
        "his",
        "their",
        "no",
        "today",
        "this",
        "morning",
        "afternoon",
        "now",
        "prospecting",
        "follow",
        "up",
        "networking",
        "agent",
        "outcome",
        "result",
        "left",
    }
)
WORD: Final = re.compile(r"[a-z0-9']+")
CURLY: Final = chr(0x2019)  # a typographic apostrophe


def plain(text: str) -> str:
    """Lower case, one space between words, straight apostrophes."""
    return " ".join(text.replace(CURLY, "'").casefold().split())


def call_type_said(words: str) -> CallType | None:
    """The call type the words name, or None when they name none."""
    text = plain(words)
    for name, pattern in TYPE_WORDS:
        if pattern.search(text):
            return cast(CallType, name)
    return None


def call_type_of(note_cut: str, said: str) -> CallType:
    """A call command's call type: from the command words at its start (Claude's `note_cut`),
    else from its first words, else Prospecting Call."""
    start = note_cut or " ".join(said.split()[:8])
    found = call_type_said(start)
    return found if found is not None and found in CALL_TYPES else DEFAULT


def outcome_said(words: str) -> OutcomeName | None:
    """The one outcome the words say, or None for none, or for two different ones."""
    text = plain(words)
    found = {name for name, pattern in OUTCOME_WORDS if pattern.search(text)}
    if len(found) != 1:
        return None
    return cast(OutcomeName, found.pop())


def only_outcome(said: str, names: Sequence[str]) -> OutcomeName | None:
    """The outcome, when the words say it and nothing else: no word is left once the outcome,
    the names heard (the person, the company) and the command words are taken out."""
    outcome = outcome_said(said)
    if outcome is None:
        return None
    text = plain(said)
    for _, pattern in OUTCOME_WORDS:
        text = pattern.sub(" ", text)
    named = {word for name in names for word in WORD.findall(plain(name))}
    left = [w for w in WORD.findall(text) if w not in named and w not in COMMAND_WORDS]
    left = [w for w in left if not re.fullmatch(r"(?:pty|ltd|limited)", w)]
    return outcome if not left else None
