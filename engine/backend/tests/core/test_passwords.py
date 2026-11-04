"""Passwords: the rules, the hash, and the common-password list (PLAN-V6 B2). No database.

Every password in these tests is made up. None is, or looks like, a real one in use.
"""

import asyncio
import random
import threading
import time
import unicodedata
from collections.abc import Callable

import pytest
from argon2 import PasswordHasher, Type

from core.auth import passwords
from core.auth.admin import ask_new_password
from core.auth.passwords import (
    A_RUN,
    COMMON_FILE,
    MAX_LENGTH,
    MIN_LENGTH,
    REPETITIVE,
    Hasher,
    PasswordRefused,
    check_rules,
    is_common,
    normalize,
    require_good_password,
)

EMAIL = "al.khair@example.test"
USERNAME = "alkhair"
FAST = {"time_cost": 1, "memory_cost": 8, "parallelism": 1}  # cheap settings, for the tests


def fast_hasher(**changes: int) -> Hasher:
    return Hasher(**{**FAST, **changes})


# --- The rules --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "password",
    [
        "correct horse battery staple",
        "tulip harbour bicycle moonlight",  # no capitals, no symbols: that is fine
        "My cat sleeps on the left side 4ever",
        "ça va très bien aujourd'hui, merci",  # not only English
        "x7#Qm!p2Lz@9vT",  # exactly 14 characters
    ],
)
def test_a_good_password_passes(password: str) -> None:
    assert check_rules(password, email=EMAIL, username=USERNAME) == []
    require_good_password(password, email=EMAIL, username=USERNAME)  # raises nothing


def test_14_characters_is_the_least_and_256_the_most() -> None:
    fourteen = "x7#Qm!p2Lz@9vT"
    assert len(fourteen) == MIN_LENGTH == 14
    assert check_rules(fourteen) == []
    problems = check_rules(fourteen[:-1])
    assert problems == ["Use at least 14 characters. Three or four words in a row work well."]

    # 256 characters of varied words pass; one more does not. The words come from a fixed
    # shuffle, so the text never repeats a chunk.
    words = ["river", "stone", "lantern", "copper", "orchard", "whisper", "meadow"]
    words += ["harvest", "quiet", "thunder", "velvet"]
    shuffled = random.Random(7).choices(words, k=80)
    long_enough = " ".join(shuffled)[:MAX_LENGTH]
    assert len(long_enough) == MAX_LENGTH
    assert check_rules(long_enough) == []
    assert check_rules(long_enough + "z") == ["Use no more than 256 characters."]


def test_a_short_password_gets_one_answer_not_a_list_of_every_rule() -> None:
    """ "abc" is also a run, but the person only needs to hear that it is too short."""
    assert check_rules("abc") == [
        "Use at least 14 characters. Three or four words in a row work well."
    ]
    assert check_rules("") != []


def test_control_characters_are_refused() -> None:
    for bad in ("correct horse\tbattery staple", "correct horse\nbattery staple", "a\x00" * 10):
        assert "Leave out control characters, like a tab or a line break." in check_rules(bad)


@pytest.mark.parametrize(
    "password",
    [
        "1q2w3e4r5t6y7u8i9o0p",  # in the list as written
        "megaparol12345",
        "MegaParol12345",  # the list ignores capitals
        "Mega-Parol 12345",  # and punctuation and spaces
        "1q2w 3e4r 5t6y 7u8i 9o0p",
        "123456789987654321",
    ],
)
def test_a_common_password_is_refused(password: str) -> None:
    assert is_common(password)
    assert "That password is too common. Pick something only you would think of." in check_rules(
        password
    )


def test_a_password_that_only_contains_a_common_one_is_not_refused_for_that() -> None:
    """Only the whole password is compared. "internazionale" is in the list, but a phrase that
    holds it is a different, longer password."""
    assert is_common("internazionale")
    assert not is_common("my internazionale fan club 2026")
    assert check_rules("my internazionale fan club 2026") == []


@pytest.mark.parametrize(
    "password",
    [
        "al.khair@example.test",  # the whole email
        "AL.KHAIR@EXAMPLE.TEST is my login",
        "my name is Al.Khair and I like it",  # the part before the @
        "My-AlKhair-Password-9",  # the same, with the punctuation left out
        "I sign in as alkhair every day",  # the username
        "Alkhair-was-here-in-2026",
    ],
)
def test_a_password_that_holds_the_email_or_username_is_refused(password: str) -> None:
    problems = check_rules(password, email=EMAIL, username=USERNAME)
    assert "Leave your email, your username and the word Contour out of the password." in problems


@pytest.mark.parametrize(
    "password",
    ["Contour is a great place 2026", "my CONTOUR hq login", "Con-tour HQ 2026 yes please"],
)
def test_the_word_contour_is_refused_for_every_account(password: str) -> None:
    assert check_rules(password) != []
    assert "Leave your email, your username and the word Contour out of the password." in (
        check_rules(password)
    )


def test_a_name_too_short_to_mean_anything_is_not_held_against_the_password() -> None:
    """A username "al" would block every password with "al" in it, so under 3 is left out."""
    assert check_rules("the quick brown fox jumps", email="al@x.test", username="al") == []
    assert check_rules("the quick brown fox jumps", email="bob@x.test", username="bob") == []
    assert check_rules("my password for bob is long", email="bob@x.test", username="bob") != []


@pytest.mark.parametrize(
    "password",
    [
        "aaaaaaaaaaaaaaaa",
        "abababababababab",
        "xyxyxyxyxyxyxyxyxy",
        "correcthorsecorrecthorse",  # one chunk, twice
        "ABC abc ABC abc ABC abc",
        "12121212121212",
    ],
)
def test_a_few_characters_repeated_is_refused(password: str) -> None:
    assert REPETITIVE in check_rules(password)


@pytest.mark.parametrize(
    "password",
    [
        "abcdefghijklmnop",
        "9876543210987654",
        "1234567890123456",
        "qwertyuiopasdfgh",  # a keyboard row
        "asdfghjklzxcvbnm",
        "lkjhgfdsapoiuytre",  # a stretch of a keyboard row, backwards
        "ABCDEFG-HIJKLMN-OP",
        "azertyuiopqsdfghj",  # an AZERTY keyboard
    ],
)
def test_a_simple_run_of_characters_is_refused(password: str) -> None:
    assert A_RUN in check_rules(password)


def test_words_that_happen_to_share_neighbouring_letters_are_not_a_run() -> None:
    assert check_rules("the old hotel on the hill") == []
    assert check_rules("Wednesday afternoon in the cafe") == []


def test_several_problems_are_all_reported_in_one_answer() -> None:
    problems = check_rules("alkhair alkhair alkhair", email=EMAIL, username=USERNAME)
    assert "Leave your email, your username and the word Contour out of the password." in problems
    assert REPETITIVE in problems  # the same word three times is a chunk repeated


def test_the_rules_look_at_the_normalised_text() -> None:
    """Full-width digits are the digits 0 to 9 after NFKC, so they are a run like any other."""
    full_width = "".join(
        chr(0xFF10 + int(digit)) for digit in "12345678901234"
    )  # the full-width forms
    assert normalize(full_width) == "12345678901234"
    assert A_RUN in check_rules(full_width)
    # The length is the normalised length: seven "ﬁ" ligatures are 14 letters.
    assert len(normalize("ﬁ" * 7)) == 14


def test_a_huge_password_is_refused_quickly_without_the_slow_checks() -> None:
    started = time.perf_counter()
    problems = check_rules("ab" * 5000, email=EMAIL)
    assert problems == ["Use no more than 256 characters."]
    assert time.perf_counter() - started < 0.5


def test_require_good_password_raises_with_every_problem() -> None:
    with pytest.raises(PasswordRefused) as caught:
        require_good_password("abc")
    assert caught.value.problems == [
        "Use at least 14 characters. Three or four words in a row work well."
    ]
    assert "Use at least 14 characters" in str(caught.value)


# --- The common-password file -----------------------------------------------------------------


def test_the_common_password_file_is_what_its_header_says() -> None:
    lines = COMMON_FILE.read_text(encoding="utf-8").splitlines()
    header = [line for line in lines if line.startswith("#")]
    entries = [line for line in lines if line and not line.startswith("#")]
    assert "Open Government Licence" in " ".join(header)  # the source and licence stay with it
    assert "SecLists" in " ".join(header)
    assert len(entries) > 400
    assert entries == sorted(set(entries))  # sorted, no duplicates
    assert all(len(entry) >= MIN_LENGTH for entry in entries)  # shorter ones are the length rule's
    assert all(entry == entry.lower() for entry in entries)
    assert all(entry.isascii() and entry.isprintable() and " " not in entry for entry in entries)


def test_comment_lines_of_the_file_are_not_passwords() -> None:
    assert not is_common("# Common passwords of 14 characters or more.")
    written, _ = passwords._common()
    assert not any(entry.startswith("#") for entry in written)


# --- The hash ---------------------------------------------------------------------------------


def test_a_password_is_saved_as_an_argon2id_hash_that_does_not_hold_it() -> None:
    hasher = fast_hasher()
    stored = hasher.hash("correct horse battery staple")
    assert stored.startswith("$argon2id$v=19$m=8,t=1,p=1$")
    assert "correct" not in stored
    assert hasher.hash("correct horse battery staple") != stored  # a new random salt each time


def test_the_real_settings_are_the_rfc_9106_low_memory_ones() -> None:
    stored = Hasher().hash("correct horse battery staple")
    assert stored.startswith("$argon2id$v=19$m=65536,t=3,p=4$")


def test_a_right_password_checks_and_a_wrong_one_does_not() -> None:
    hasher = fast_hasher()
    stored = hasher.hash("correct horse battery staple")
    assert hasher.verify(stored, "correct horse battery staple") == (True, False)
    assert hasher.verify(stored, "correct horse battery stapl") == (False, False)
    assert hasher.verify(stored, "") == (False, False)
    assert hasher.verify(stored, "Correct horse battery staple") == (False, False)


@pytest.mark.parametrize(
    "garbage", ["", "not a hash", "$argon2id$", "$argon2id$v=19$m=1,t=1,p=1$x$y", "$2b$12$abc"]
)
def test_a_stored_value_that_is_not_a_hash_never_raises_and_never_matches(garbage: str) -> None:
    hasher = fast_hasher()
    assert hasher.verify(garbage, "correct horse battery staple") == (False, False)
    assert hasher.needs_rehash(garbage) is True


def test_the_same_password_typed_two_ways_is_one_password() -> None:
    """ "é" as one character, or as an "e" and an accent: both give the same password."""
    composed = "café au lait every morning"
    decomposed = "café au lait every morning"
    assert composed != decomposed
    assert unicodedata.normalize("NFC", decomposed) == composed
    hasher = fast_hasher()
    assert hasher.verify(hasher.hash(composed), decomposed) == (True, False)
    assert hasher.verify(hasher.hash(decomposed), composed) == (True, False)
    assert check_rules(composed) == check_rules(decomposed) == []


def test_a_hash_made_with_older_settings_still_works_and_says_to_make_it_again() -> None:
    old = fast_hasher(memory_cost=8, time_cost=1)
    today = fast_hasher(memory_cost=16, time_cost=2)
    stored = old.hash("correct horse battery staple")
    assert old.needs_rehash(stored) is False
    assert today.needs_rehash(stored) is True
    assert today.verify(stored, "correct horse battery staple") == (True, True)
    assert today.verify(stored, "wrong password entirely") == (False, False)  # no rehash to ask for
    fresh = today.hash("correct horse battery staple")
    assert today.verify(fresh, "correct horse battery staple") == (True, False)


def test_a_hash_made_by_another_argon2_kind_says_to_make_it_again() -> None:
    argon2i = PasswordHasher(type=Type.I, time_cost=1, memory_cost=8, parallelism=1)
    stored = argon2i.hash("correct horse battery staple")
    assert fast_hasher().verify(stored, "correct horse battery staple") == (True, True)


def test_burn_does_the_work_of_a_check_that_can_never_succeed() -> None:
    hasher = fast_hasher()
    calls: list[str] = []
    real = hasher.verify

    def spy(stored: str, password: str) -> tuple[bool, bool]:
        calls.append(stored)
        return real(stored, password)

    hasher.verify = spy  # type: ignore[method-assign]
    hasher.burn("anything at all")
    hasher.burn("anything else")
    assert len(calls) == 2
    assert calls[0] == calls[1]  # one dummy hash, made once, with this hasher's own settings
    assert calls[0].startswith("$argon2id$v=19$m=8,t=1,p=1$")
    assert hasher.needs_rehash(calls[0]) is False  # so it costs the same as a real check


async def test_the_async_versions_give_the_same_answers() -> None:
    hasher = fast_hasher()
    stored = await hasher.ahash("correct horse battery staple")
    assert await hasher.averify(stored, "correct horse battery staple") == (True, False)
    assert await hasher.averify(stored, "nope") == (False, False)
    await hasher.aburn("anything")


async def test_only_two_hashes_run_at_a_time_and_the_event_loop_stays_free() -> None:
    """Each hash holds 64 MiB. A flood of sign-in tries must not run them all at once."""
    hasher = fast_hasher(concurrency=2)
    running = 0
    most = 0
    lock = threading.Lock()

    def slow(password: str) -> str:
        nonlocal running, most
        with lock:
            running += 1
            most = max(most, running)
        time.sleep(0.05)
        with lock:
            running -= 1
        return "done"

    hasher.hash = slow  # type: ignore[method-assign]
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.005)
            ticks += 1

    watcher = asyncio.create_task(ticker())
    try:
        answers = await asyncio.gather(*(hasher.ahash("x") for _ in range(8)))
    finally:
        watcher.cancel()
    assert answers == ["done"] * 8
    assert most == 2
    assert ticks >= 10  # the loop kept running while the hashes did their work


# --- The prompt the commands use --------------------------------------------------------------


def scripted(*answers: str) -> tuple[Callable[[str], str], list[str]]:
    """A `read_secret` that gives these answers in turn, and a list of what it was asked."""
    asked: list[str] = []
    remaining = iter(answers)

    def read(prompt: str) -> str:
        asked.append(prompt)
        return next(remaining)

    return read, asked


def test_the_prompt_asks_twice_and_returns_a_good_password() -> None:
    read, asked = scripted("correct horse battery staple", "correct horse battery staple")
    complaints: list[str] = []
    answer = ask_new_password(read, complaints.append, email=EMAIL, username=USERNAME)
    assert answer == "correct horse battery staple"
    assert asked == ["New password: ", "New password again: "]
    assert complaints == []


def test_the_prompt_says_what_is_wrong_and_asks_again_without_asking_twice() -> None:
    read, asked = scripted("short", "correct horse battery staple", "correct horse battery staple")
    complaints: list[str] = []
    answer = ask_new_password(read, complaints.append, email=EMAIL, username=USERNAME)
    assert answer == "correct horse battery staple"
    assert complaints == ["  - Use at least 14 characters. Three or four words in a row work well."]
    # The bad one was refused before the second prompt, so the person isn't asked to type it twice.
    assert asked == ["New password: "] * 2 + ["New password again: "]


def test_two_different_passwords_are_not_accepted() -> None:
    read, _ = scripted(
        "correct horse battery staple",
        "correct horse battery stapel",
        "tulip harbour bicycle moonlight",
        "tulip harbour bicycle moonlight",
    )
    complaints: list[str] = []
    answer = ask_new_password(read, complaints.append, email=None, username=None)
    assert answer == "tulip harbour bicycle moonlight"
    assert complaints == ["  - The two passwords are different."]


def test_the_prompt_gives_up_after_three_bad_tries_and_never_repeats_a_password() -> None:
    tries = ("alkhair rocks every day", "abcdefghijklmnop", "1q2w3e4r5t6y7u8i9o0p")
    read, asked = scripted(*tries)
    complaints: list[str] = []
    assert ask_new_password(read, complaints.append, email=EMAIL, username=USERNAME) is None
    assert len(asked) == 3
    assert len(complaints) == 3
    for tried in tries:
        assert not any(tried in complaint for complaint in complaints)  # plain words only
