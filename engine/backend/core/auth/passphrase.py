"""Starting passphrase generator (PLAN-V19 T1-5): three common words and two digits, like
`maple-harbor-river-47`, generated until `core.auth.passwords.check_rules` accepts it.

Never logged, audited, or stored in plain text: returned once to the caller who made or reset the
account.
"""

import secrets
from functools import lru_cache
from pathlib import Path

from core.auth.passwords import check_rules

WORDS_FILE = Path(__file__).with_name("passphrase_words.txt")
MAX_ATTEMPTS = 64


@lru_cache(maxsize=1)
def word_list() -> tuple[str, ...]:
    """The curated everyday word list, deduplicated and normalized to lowercase."""
    lines = WORDS_FILE.read_text(encoding="utf-8").splitlines()
    seen: list[str] = []
    seen_set: set[str] = set()
    for raw in lines:
        word = raw.strip().lower()
        if not word or word.startswith("#"):
            continue
        if word.isascii() and word.isalpha() and len(word) >= 4 and word not in seen_set:
            seen.append(word)
            seen_set.add(word)
    return tuple(seen)


def generate_password(
    *,
    email: str | None = None,
    username: str | None = None,
    rng: secrets.SystemRandom | None = None,
) -> str:
    """Builds `<word1>-<word2>-<word3>-<2 digits>` that passes today's password rules."""
    words = word_list()
    if len(words) < 3:
        raise RuntimeError("passphrase word list needs at least three words")
    chooser = rng or secrets.SystemRandom()
    for _ in range(MAX_ATTEMPTS):
        chosen = chooser.sample(words, 3)
        digits = f"{chooser.randrange(0, 100):02d}"
        candidate = f"{chosen[0]}-{chosen[1]}-{chosen[2]}-{digits}"
        if not check_rules(candidate, email=email, username=username):
            return candidate
    raise RuntimeError("could not generate a starting password that passes the rules")
