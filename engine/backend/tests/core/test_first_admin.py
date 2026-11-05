"""The first Admin account, made by `engine migrate` from settings (PLAN-V8).

A deploy has nobody at a terminal, so the first account can't be typed at `create-admin`'s prompt.
With FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD set and no Admin yet, `engine migrate` makes it.
Once an Admin exists the settings are ignored, so a deploy never fails (or changes a password)
because they are still there. The password follows the same rules as a typed one, and it is never
printed or logged.
"""

from collections.abc import Callable, Iterator
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row

from core import cli
from core.auth.passwords import get_hasher
from core.config import Settings, get_settings
from tests.conftest import server_conninfo
from tests.core.test_passwords import scripted

pytestmark = pytest.mark.integration

GOOD = "tulip harbour bicycle moonlight"
EMAIL = "Al.Khair@Example.test"


@pytest.fixture
def conninfo(database_url: str) -> Iterator[str]:
    """The test database with the sign-in tables emptied. The command runs on it for real."""
    settings = get_settings()
    info = server_conninfo(settings, settings.postgres_db)
    with psycopg.connect(info, autocommit=True) as connection:
        connection.execute("TRUNCATE core.audit_log, core.sessions, core.users")
    yield info


@pytest.fixture(autouse=True)
def only_the_admin_step(monkeypatch: pytest.MonkeyPatch) -> None:
    """The test database is already made. What is under test is the step after the migration."""
    monkeypatch.setattr(cli, "migrate", lambda: None)


@pytest.fixture
def first_admin_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., None]]:
    """Sets FIRST_ADMIN_* in the environment, and takes any other out of it."""
    names = [name.upper() for name in Settings.model_fields if name.startswith("first_admin_")]

    def put(**values: str) -> None:
        for name in names:
            monkeypatch.delenv(name, raising=False)
        for name, value in values.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()

    put()
    yield put
    get_settings.cache_clear()


def rows(info: str, query: str) -> list[dict[str, Any]]:
    with psycopg.connect(info, autocommit=True, row_factory=dict_row) as connection:
        return connection.execute(query).fetchall()


def migrate(capsys: pytest.CaptureFixture[str]) -> tuple[int, str, str]:
    code = cli.main(["migrate"])
    shown = capsys.readouterr()
    return code, shown.out, shown.err


def test_migrate_makes_the_first_admin_from_the_settings(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    first_admin_env(
        FIRST_ADMIN_EMAIL=EMAIL,
        FIRST_ADMIN_PASSWORD=GOOD,
        FIRST_ADMIN_USERNAME="AlKhair",
        FIRST_ADMIN_NAME="Al-khair Pama",
    )
    code, out, err = migrate(capsys)
    assert code == 0
    assert out.splitlines() == [
        "The database is up to date.",
        "Made the first Admin account for al.khair@example.test from FIRST_ADMIN_*. "
        "Remove FIRST_ADMIN_PASSWORD now: it is not read again.",
    ]
    (user,) = rows(conninfo, "SELECT * FROM core.users")
    assert (user["email"], user["username"], user["name"], user["role"]) == (
        "al.khair@example.test",
        "alkhair",
        "Al-khair Pama",
        "admin",
    )
    assert get_hasher().verify(user["password_hash"], GOOD) == (True, False)
    (entry,) = rows(conninfo, "SELECT event, details FROM core.audit_log")
    assert entry == {"event": "account_created", "details": {"by": "settings", "role": "admin"}}
    for shown in (out, err):
        assert GOOD not in shown


def test_without_a_name_the_top_bar_gets_one_from_the_email(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    first_admin_env(FIRST_ADMIN_EMAIL="al.khair@example.test", FIRST_ADMIN_PASSWORD=GOOD)
    assert migrate(capsys)[0] == 0
    (user,) = rows(conninfo, "SELECT name, username FROM core.users")
    assert user == {"name": "Al Khair", "username": None}


def test_a_second_migrate_changes_nothing(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    """Every deploy runs migrate, and the settings stay until someone removes them."""
    first_admin_env(FIRST_ADMIN_EMAIL=EMAIL, FIRST_ADMIN_PASSWORD=GOOD)
    assert migrate(capsys)[0] == 0
    (before,) = rows(conninfo, "SELECT id, password_hash FROM core.users")

    code, out, err = migrate(capsys)

    assert (code, err) == (0, "")
    assert out.splitlines() == [
        "The database is up to date.",
        "An Admin account already exists, so FIRST_ADMIN_* was not used. "
        "Remove FIRST_ADMIN_PASSWORD: it is not needed any more.",
    ]
    assert rows(conninfo, "SELECT id, password_hash FROM core.users") == [before]
    assert len(rows(conninfo, "SELECT 1 FROM core.audit_log")) == 1


def test_the_settings_do_not_change_the_password_of_an_admin_made_another_way(
    conninfo: str,
    first_admin_env: Callable[..., None],
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read, _ = scripted(GOOD, GOOD)
    monkeypatch.setattr(cli, "read_secret", read)
    assert cli.main(["create-admin", "--email", "boss@example.test"]) == 0
    capsys.readouterr()
    (before,) = rows(conninfo, "SELECT id, email, password_hash FROM core.users")

    first_admin_env(
        FIRST_ADMIN_EMAIL="other@example.test", FIRST_ADMIN_PASSWORD="another long phrase"
    )
    code, out, _ = migrate(capsys)

    assert code == 0
    assert "already exists" in out
    assert rows(conninfo, "SELECT id, email, password_hash FROM core.users") == [before]


def test_an_admin_that_exists_means_a_leftover_email_alone_is_not_an_error(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    """The advice is to remove the password after the first deploy. That must not fail the next."""
    first_admin_env(FIRST_ADMIN_EMAIL=EMAIL, FIRST_ADMIN_PASSWORD=GOOD)
    assert migrate(capsys)[0] == 0
    first_admin_env(FIRST_ADMIN_EMAIL=EMAIL)  # the password is removed

    code, out, err = migrate(capsys)

    assert (code, err) == (0, "")
    assert "already exists" in out


@pytest.mark.parametrize(
    "values",
    [{"FIRST_ADMIN_EMAIL": EMAIL}, {"FIRST_ADMIN_PASSWORD": GOOD}],
    ids=["only the email", "only the password"],
)
def test_one_of_the_two_without_an_admin_stops_the_deploy_and_makes_nothing(
    conninfo: str,
    first_admin_env: Callable[..., None],
    capsys: pytest.CaptureFixture[str],
    values: dict[str, str],
) -> None:
    first_admin_env(**values)
    code, out, err = migrate(capsys)
    assert code == 1
    assert err.strip() == "Set both FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD, or neither."
    assert rows(conninfo, "SELECT 1 FROM core.users") == []
    for shown in (out, err):
        assert GOOD not in shown


@pytest.mark.parametrize(
    ("password", "words"),
    [
        ("short phrase", "Use at least 14 characters"),
        ("password1234567", "too common"),
        ("aaaaaaaaaaaaaaaaaaaa", "repeats the same few characters"),
    ],
)
def test_a_password_that_breaks_the_rules_stops_the_deploy_and_is_not_shown(
    conninfo: str,
    first_admin_env: Callable[..., None],
    capsys: pytest.CaptureFixture[str],
    password: str,
    words: str,
) -> None:
    first_admin_env(FIRST_ADMIN_EMAIL=EMAIL, FIRST_ADMIN_PASSWORD=password)
    code, out, err = migrate(capsys)
    assert code == 1
    assert err.startswith("FIRST_ADMIN_PASSWORD breaks the rules:\n  - ")
    assert words in err
    assert rows(conninfo, "SELECT 1 FROM core.users") == []
    for shown in (out, err):
        assert password not in shown


def test_a_login_that_is_not_allowed_stops_the_deploy(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    first_admin_env(FIRST_ADMIN_EMAIL="not an email", FIRST_ADMIN_PASSWORD=GOOD)
    code, _, err = migrate(capsys)
    assert code == 1
    assert err.startswith("FIRST_ADMIN_EMAIL or FIRST_ADMIN_USERNAME isn't allowed.")
    assert rows(conninfo, "SELECT 1 FROM core.users") == []
    assert GOOD not in err


def test_a_password_made_from_the_email_is_refused(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    first_admin_env(
        FIRST_ADMIN_EMAIL="alkhair.pama@example.test",
        FIRST_ADMIN_PASSWORD="alkhair.pama@example.test",
    )
    code, _, err = migrate(capsys)
    assert code == 1
    assert "Leave your email" in err


def test_with_nothing_set_migrate_says_no_more_and_leaves_the_accounts_alone(
    conninfo: str, first_admin_env: Callable[..., None], capsys: pytest.CaptureFixture[str]
) -> None:
    first_admin_env(FIRST_ADMIN_EMAIL=" ", FIRST_ADMIN_PASSWORD="")  # blank counts as not set
    code, out, err = migrate(capsys)
    assert (code, out, err) == (0, "The database is up to date.\n", "")
    assert rows(conninfo, "SELECT 1 FROM core.users") == []
