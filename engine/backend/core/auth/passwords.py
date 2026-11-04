"""Passwords: how they are saved, how they are checked, and the rules a new one must pass.
PLAN-V6 B2.

**Saving.** Only an argon2id hash is kept. The hash holds its own settings and a random salt, so
the real password can't be read back from it. The settings are RFC 9106's "low memory" choice
(3 passes, 64 MiB, 4 lanes: about 0.1 second on a laptop). When they are raised later, a hash made
with the old ones still works, and `Hasher.verify` says it needs to be made again, so the next
sign-in saves a new one.

**Work.** A hash takes 64 MiB while it runs, so at most `concurrency` (2) run at once, in threads
of their own. More wait in line. That keeps a flood of sign-in tries from using up the server's
memory, and keeps the event loop free for everything else.

**Same text everywhere.** The password is normalised (Unicode NFKC) before it is hashed or
checked, so "é" typed as one character or as two gives the same password on every device.

**Rules** (`check_rules`, plain words for a person): at least 14 characters (a short phrase is
fine) and at most 256, no control characters, not a common password (`common_passwords.txt`), not
containing the email, the username or the word "contour", and not a few characters repeated or a
simple run like `abcdefghijklmn`. There are no rules about capitals or symbols: they make
passwords harder to remember and not much harder to guess.
"""

import asyncio
import re
import unicodedata
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from itertools import pairwise
from pathlib import Path
from typing import TypeVar

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_LENGTH = 14
MAX_LENGTH = 256
COMMON_FILE = Path(__file__).with_name("common_passwords.txt")

# RFC 9106, section 4: the second recommended choice, for when memory is limited.
TIME_COST = 3  # passes
MEMORY_COST_KIB = 65_536  # 64 MiB
PARALLELISM = 4  # lanes
CONCURRENCY = 2  # hashes at once

# Words that must not be inside a password, whatever the account: the name of the place.
CONTEXT_WORDS = ("contour",)
MIN_CONTEXT_LENGTH = 3  # a shorter name or username would block half the alphabet

# Rows of a keyboard. A password that is a stretch of one (or of its reverse) is a walk.
KEYBOARD_ROWS = (
    "qwertyuiopasdfghjklzxcvbnm",
    "azertyuiopqsdfghjklmwxcvbn",
    "12345678901234567890",
)
MIN_DISTINCT_CHARACTERS = 5
SEQUENTIAL_SHARE = 0.7  # this share of neighbours one step apart (abc, 321) is "a run"

REPETITIVE = "That password repeats the same few characters. Pick something less predictable."
A_RUN = (
    "That password is a simple run of characters, like abcdefghijklmn or 1234567890123. "
    "Pick something less predictable."
)

T = TypeVar("T")


# --- Rules ------------------------------------------------------------------------------------


def normalize(password: str) -> str:
    """The password as it is hashed and checked: Unicode NFKC."""
    return unicodedata.normalize("NFKC", password)


def squash(text: str) -> str:
    """Lower case, with everything that isn't a letter or a digit taken out: how two spellings of
    one thing ("Al-Khair", "al khair") are compared."""
    return re.sub(r"[\W_]+", "", normalize(text).casefold())


@lru_cache
def _common() -> tuple[frozenset[str], frozenset[str]]:
    """The common passwords, as written and squashed, from `common_passwords.txt`."""
    lines = COMMON_FILE.read_text(encoding="utf-8").splitlines()
    written = frozenset(line for line in lines if line and not line.startswith("#"))
    return written, frozenset(squash(line) for line in written)


def is_common(password: str) -> bool:
    written, squashed = _common()
    return normalize(password).casefold() in written or squash(password) in squashed


def _context_terms(email: str | None, username: str | None) -> list[str]:
    """What must not be inside a password for this account: its email (whole and before the @),
    its username, and the words every password here must leave out."""
    terms = list(CONTEXT_WORDS)
    if email:
        terms.append(email)
        terms.append(email.split("@", 1)[0])
    if username:
        terms.append(username)
    squashed = (squash(term) for term in terms)
    return [term for term in dict.fromkeys(squashed) if len(term) >= MIN_CONTEXT_LENGTH]


def _is_repetitive(squashed: str) -> bool:
    if len(set(squashed)) < MIN_DISTINCT_CHARACTERS:
        return True  # aaaaaaaaaaaaaa, abababababababab
    return re.fullmatch(r"(.+?)\1+", squashed, re.DOTALL) is not None  # one chunk, again and again


def _is_a_run(squashed: str) -> bool:
    """abcdefghijklmn, 9876543210987, or a stretch of a keyboard row like qwertyuiopasdf."""
    if len(squashed) < 2:
        return False
    steps = sum(1 for a, b in pairwise(squashed) if abs(ord(a) - ord(b)) == 1)
    if steps / (len(squashed) - 1) >= SEQUENTIAL_SHARE:
        return True
    return any(squashed in row or squashed in row[::-1] for row in KEYBOARD_ROWS)


def check_rules(
    password: str, *, email: str | None = None, username: str | None = None
) -> list[str]:
    """What is wrong with a new password, in plain words. An empty list means it passes.

    `email` and `username` are the account's own, so a password can't be built from them.
    """
    text = normalize(password)
    problems: list[str] = []
    if len(text) < MIN_LENGTH:
        problems.append(
            f"Use at least {MIN_LENGTH} characters. Three or four words in a row work well."
        )
    if len(text) > MAX_LENGTH:
        problems.append(f"Use no more than {MAX_LENGTH} characters.")
    if any(unicodedata.category(character) == "Cc" for character in text):
        problems.append("Leave out control characters, like a tab or a line break.")
    if not MIN_LENGTH <= len(text) <= MAX_LENGTH:
        return problems  # the rest is only worth doing for a password of a sensible size
    squashed = squash(text)
    if is_common(text):
        problems.append("That password is too common. Pick something only you would think of.")
    if any(term in squashed for term in _context_terms(email, username)):
        problems.append("Leave your email, your username and the word Contour out of the password.")
    if _is_repetitive(squashed):
        problems.append(REPETITIVE)
    elif _is_a_run(squashed):
        problems.append(A_RUN)
    return problems


class PasswordRefused(ValueError):
    """A new password broke the rules. `problems` holds each one, in plain words."""

    def __init__(self, problems: Iterable[str]) -> None:
        self.problems = list(problems)
        super().__init__(" ".join(self.problems))


def require_good_password(
    password: str, *, email: str | None = None, username: str | None = None
) -> None:
    problems = check_rules(password, email=email, username=username)
    if problems:
        raise PasswordRefused(problems)


# --- Hashing ----------------------------------------------------------------------------------


class Hasher:
    """argon2id, with the settings above. Tests make one with cheap settings."""

    def __init__(
        self,
        *,
        time_cost: int = TIME_COST,
        memory_cost: int = MEMORY_COST_KIB,
        parallelism: int = PARALLELISM,
        concurrency: int = CONCURRENCY,
    ) -> None:
        self._argon = PasswordHasher(
            time_cost=time_cost,
            memory_cost=memory_cost,
            parallelism=parallelism,
            type=Type.ID,
        )
        self._pool = ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="argon2")
        self._dummy: str | None = None

    def hash(self, password: str) -> str:
        return self._argon.hash(normalize(password))

    def verify(self, stored: str, password: str) -> tuple[bool, bool]:
        """(the password is right, the hash should be made again with today's settings).

        A wrong password, a hash that isn't one, and a hash made another way all give
        (False, False): nothing here raises for bad input, and nothing says which it was.
        """
        try:
            self._argon.verify(stored, normalize(password))
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False, False
        return True, self._argon.check_needs_rehash(stored)

    def needs_rehash(self, stored: str) -> bool:
        try:
            return self._argon.check_needs_rehash(stored)
        except InvalidHashError:
            return True

    def burn(self, password: str) -> None:
        """Does the work of a check against a hash that is never right. A sign-in with an unknown
        login calls it, so it takes as long as one with a known login."""
        if self._dummy is None:
            self._dummy = self._argon.hash("not the password of anyone")
        self.verify(self._dummy, password)

    async def _in_line(self, work: Callable[[], T]) -> T:
        return await asyncio.get_running_loop().run_in_executor(self._pool, work)

    async def ahash(self, password: str) -> str:
        return await self._in_line(lambda: self.hash(password))

    async def averify(self, stored: str, password: str) -> tuple[bool, bool]:
        return await self._in_line(lambda: self.verify(stored, password))

    async def aburn(self, password: str) -> None:
        await self._in_line(lambda: self.burn(password))


@lru_cache
def get_hasher() -> Hasher:
    """The one hasher of the running backend. Its two threads are shared by every sign-in."""
    return Hasher()
