"""The Admin account and the three commands that run it (PLAN-V6 B2), on the test database.

Passwords here are made up. The tests also prove that none of them is ever saved as text, printed
or logged: only the argon2id hash is kept.
"""

import hashlib
import sys
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core import cli
from core.auth import admin, clean, users
from core.auth.models import AuditEntry, User, UserSession
from core.auth.passwords import Hasher, PasswordRefused, get_hasher
from core.auth.users import LoginTaken
from core.config import get_settings
from tests.conftest import server_conninfo
from tests.core.test_passwords import scripted

pytestmark = pytest.mark.integration

Factory = async_sessionmaker[AsyncSession]
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
GOOD = "tulip harbour bicycle moonlight"
NEW = "river stone lantern copper orchard"
FAST = Hasher(time_cost=1, memory_cost=8, parallelism=1)  # cheap settings for the service tests


async def make_admin(factory: Factory, **changes: Any) -> User:
    values: dict[str, Any] = {
        "email": "al.khair@example.test",
        "username": "alkhair",
        "name": None,
        "password": GOOD,
        "now": NOW,
        "hasher": FAST,
    }
    async with factory() as db:
        return await admin.create_admin(db, **{**values, **changes})


def make_session(user: User, label: str, **changes: Any) -> UserSession:
    values: dict[str, Any] = {
        "token_hash": hashlib.sha256(label.encode()).hexdigest(),
        "user_id": user.id,
        "expires_at": NOW + timedelta(hours=12),
    }
    return UserSession(**{**values, **changes})


async def count_of(factory: Factory, table: type[Any]) -> int:
    async with factory() as db:
        return int(await db.scalar(select(func.count()).select_from(table)) or 0)


# --- Making the Admin account -----------------------------------------------------------------


async def test_an_admin_is_saved_with_a_hash_and_a_log_entry(session_factory: Factory) -> None:
    made = await make_admin(
        session_factory, email="Al.Khair@Example.TEST", username="AlKhair", name=" Al-khair Pama "
    )
    async with session_factory() as db:
        saved = await db.get(User, made.id)
        entries = list(await db.scalars(select(AuditEntry)))
    assert saved is not None
    assert (saved.email, saved.username, saved.name) == (
        "al.khair@example.test",
        "alkhair",
        "Al-khair Pama",
    )
    assert (saved.role, saved.active, saved.failed_attempts) == ("admin", True, 0)
    assert saved.password_changed_at == NOW
    assert saved.password_hash.startswith("$argon2id$")
    assert FAST.verify(saved.password_hash, GOOD) == (True, False)
    assert [(e.event, e.user_id, e.ip, e.user_agent) for e in entries] == [
        ("account_created", made.id, None, None)
    ]
    assert entries[0].details == {"by": "command", "role": "admin"}


async def test_without_a_name_the_top_bar_gets_one_from_the_email(session_factory: Factory) -> None:
    made = await make_admin(session_factory, email="al.khair@example.test", name=None)
    assert made.name == "Al Khair"
    assert admin.default_name("jo_smith-jones@x.test") == "Jo Smith Jones"
    assert admin.default_name("x@y.test") == "X"
    other = await make_admin(session_factory, email="bo@example.test", username=None, name="  ")
    assert other.name == "Bo"
    assert other.username is None


async def test_a_password_that_breaks_the_rules_makes_nothing(session_factory: Factory) -> None:
    for bad in ("short", "alkhair is my name too", "1q2w3e4r5t6y7u8i9o0p", "abcdefghijklmnop"):
        with pytest.raises(PasswordRefused):
            await make_admin(session_factory, password=bad)
    assert await count_of(session_factory, User) == 0
    assert await count_of(session_factory, AuditEntry) == 0


async def test_a_login_that_is_not_allowed_makes_nothing(session_factory: Factory) -> None:
    with pytest.raises(ValueError, match="email address"):
        await make_admin(session_factory, email="not an email")
    with pytest.raises(ValueError, match="username"):
        await make_admin(session_factory, username="Al@Khair")
    assert await count_of(session_factory, User) == 0


async def test_an_email_or_username_in_use_is_refused_and_the_first_account_is_kept(
    session_factory: Factory,
) -> None:
    first = await make_admin(session_factory)
    with pytest.raises(LoginTaken) as same_email:
        await make_admin(session_factory, email="AL.KHAIR@example.test", username="other")
    assert same_email.value.field == "email"
    with pytest.raises(LoginTaken) as same_username:
        await make_admin(session_factory, email="other@example.test", username="ALKHAIR")
    assert same_username.value.field == "username"
    assert "already used" in str(same_username.value)
    async with session_factory() as db:
        assert [user.id for user in await db.scalars(select(User))] == [first.id]
        assert await count_of(session_factory, AuditEntry) == 1  # only the first one's entry


# --- Finding a user ---------------------------------------------------------------------------


async def test_a_user_is_found_by_email_or_username_in_any_case(session_factory: Factory) -> None:
    made = await make_admin(session_factory)
    async with session_factory() as db:
        for typed in ("al.khair@example.test", "AL.KHAIR@Example.Test", "alkhair", " ALKhair "):
            found = await users.find_by_login(db, typed)
            assert found is not None
            assert found.id == made.id, typed
        for nobody in ("", "   ", "al", "al.khair", "al.khair@example.tes", "someone@else.test"):
            assert await users.find_by_login(db, nobody) is None, nobody
        assert (await users.find_by_id(db, made.id)) is not None


# --- Setting a new password -------------------------------------------------------------------


async def test_a_new_password_replaces_the_old_one_and_ends_every_session(
    session_factory: Factory,
) -> None:
    made = await make_admin(session_factory)
    later = NOW + timedelta(hours=1)
    async with session_factory() as db:
        user = await users.find_by_id(db, made.id)
        assert user is not None
        user.failed_attempts, user.locked_until = 7, later + timedelta(minutes=15)
        db.add_all(
            [
                make_session(user, "live one"),
                make_session(user, "live two", remember=True),
                make_session(user, "old", expires_at=NOW - timedelta(hours=1)),  # past its time
            ]
        )
        await db.commit()
        ended = await admin.reset_password(db, user, NEW, now=later, hasher=FAST)

    assert ended == 2  # the two that were still live (the old one is ended too, but isn't counted)
    async with session_factory() as db:
        saved = await db.get(User, made.id)
        assert saved is not None
        assert FAST.verify(saved.password_hash, NEW) == (True, False)
        assert FAST.verify(saved.password_hash, GOOD) == (False, False)
        assert saved.password_changed_at == later
        assert (saved.failed_attempts, saved.locked_until) == (0, None)
        sessions = list(await db.scalars(select(UserSession)))
        assert len(sessions) == 3
        assert all(session.ended_at == later for session in sessions)
        changed = (
            await db.scalars(select(AuditEntry).where(AuditEntry.event == "password_changed"))
        ).all()
    assert [entry.details for entry in changed] == [{"by": "command", "sessions_ended": 2}]
    assert changed[0].user_id == made.id


async def test_a_new_password_that_breaks_the_rules_changes_nothing(
    session_factory: Factory,
) -> None:
    made = await make_admin(session_factory)
    async with session_factory() as db:
        user = await users.find_by_id(db, made.id)
        assert user is not None
        db.add(make_session(user, "live"))
        await db.commit()
        for bad in ("short", "alkhair alkhair alkhair", "contour is my place 2026"):
            with pytest.raises(PasswordRefused):
                await admin.reset_password(db, user, bad, now=NOW, hasher=FAST)
    async with session_factory() as db:
        saved = await db.get(User, made.id)
        assert saved is not None
        assert FAST.verify(saved.password_hash, GOOD) == (True, False)  # the old one still works
        assert (await db.scalar(select(UserSession.ended_at))) is None  # and nobody was signed out
        assert await count_of(session_factory, AuditEntry) == 1  # only "account_created"


# --- Signing everyone out ---------------------------------------------------------------------


async def test_everyone_is_signed_out_and_each_person_gets_a_log_entry(
    session_factory: Factory,
) -> None:
    one = await make_admin(session_factory)
    two = await make_admin(session_factory, email="bo@example.test", username="bo-b")
    three = await make_admin(session_factory, email="cy@example.test", username=None)  # no session
    earlier = NOW - timedelta(days=1)
    async with session_factory() as db:
        db.add_all(
            [
                make_session(one, "a"),
                make_session(one, "b"),
                make_session(two, "c"),
                make_session(two, "d", expires_at=NOW - timedelta(hours=1)),  # past its time
                make_session(two, "e", ended_at=earlier),  # signed out before
            ]
        )
        await db.commit()
    async with session_factory() as db:
        assert await admin.sign_out_everyone(db, now=NOW) == (3, 2)  # 3 live sessions, 2 people

    async with session_factory() as db:
        sessions = {s.token_hash: s for s in await db.scalars(select(UserSession))}
        entries = list(
            await db.scalars(select(AuditEntry).where(AuditEntry.event == "sign_out_everywhere"))
        )
    by_label = {label: sessions[hashlib.sha256(label.encode()).hexdigest()] for label in "abcde"}
    assert {label: s.ended_at for label, s in by_label.items()} == {
        "a": NOW,
        "b": NOW,
        "c": NOW,
        "d": NOW,
        "e": earlier,  # a session that had ended keeps the time it ended
    }
    counts = {entry.user_id: entry.details["sessions_ended"] for entry in entries}
    assert counts == {one.id: 2, two.id: 1}  # the third person had none, so no entry
    assert three.id not in counts
    assert all(entry.details["by"] == "command" for entry in entries)


async def test_signing_everyone_out_when_no_one_is_in_says_so_and_logs_nothing(
    session_factory: Factory,
) -> None:
    await make_admin(session_factory)
    async with session_factory() as db:
        assert await admin.sign_out_everyone(db, now=NOW) == (0, 0)
    assert await count_of(session_factory, AuditEntry) == 1  # only "account_created"


# --- Nothing secret is saved ------------------------------------------------------------------


async def test_no_password_is_saved_as_text_anywhere(session_factory: Factory) -> None:
    made = await make_admin(session_factory)
    async with session_factory() as db:
        user = await users.find_by_id(db, made.id)
        assert user is not None
        await admin.reset_password(db, user, NEW, now=NOW, hasher=FAST)
        await admin.sign_out_everyone(db, now=NOW)
    async with session_factory() as db:
        dump = ""
        for table in ("core.users", "core.sessions", "core.audit_log"):
            rows = await db.execute(text(f"SELECT row_to_json(t)::text FROM {table} t"))
            dump += " ".join(row[0] for row in rows)
    for password in (GOOD, NEW):
        assert password not in dump
        assert password.split()[0] not in dump.replace("alkhair", "")  # not a word of it either


def test_the_log_refuses_a_detail_that_sounds_like_a_secret() -> None:
    from core.auth import audit

    class NoDatabase:
        def add(self, entry: object) -> None:
            raise AssertionError("must not be saved")

    for key in ("password", "new_password", "Token", "session_token", "cookie", "secret", "hash"):
        with pytest.raises(ValueError, match="never holds a secret"):
            audit.add_entry(NoDatabase(), "sign_in", details={key: "x"})  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="not a kind of log entry"):
        audit.add_entry(NoDatabase(), "typed_a_password")  # type: ignore[arg-type]


# --- The three commands -----------------------------------------------------------------------


@pytest.fixture
def conninfo(database_url: str) -> Iterator[str]:
    """The test database with the sign-in tables emptied. The commands run on it for real."""
    settings = get_settings()
    info = server_conninfo(settings, settings.postgres_db)
    with psycopg.connect(info, autocommit=True) as connection:
        connection.execute("TRUNCATE core.audit_log, core.sessions, core.users")
    yield info


def rows(info: str, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with psycopg.connect(info, autocommit=True, row_factory=dict_row) as connection:
        return connection.execute(query, params).fetchall()


def run(monkeypatch: pytest.MonkeyPatch, *answers: str, argv: list[str]) -> tuple[int, list[str]]:
    """Runs one command with these typed answers. Returns its exit code and what it asked."""
    read, asked = scripted(*answers)
    monkeypatch.setattr(cli, "read_secret", read)
    return cli.main(argv), asked


CREATE = ["create-admin", "--email", "Al.Khair@Example.test", "--username", "AlKhair"]


def test_create_admin_asks_twice_and_makes_the_account(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, asked = run(monkeypatch, GOOD, GOOD, argv=[*CREATE, "--name", "Al-khair Pama"])
    out = capsys.readouterr()
    assert code == 0
    assert asked == ["New password: ", "New password again: "]
    assert out.out.strip() == (
        "Made the Admin account for al.khair@example.test. It signs in with its email or username."
    )
    (user,) = rows(conninfo, "SELECT * FROM core.users")
    assert (user["email"], user["username"], user["name"], user["role"]) == (
        "al.khair@example.test",
        "alkhair",
        "Al-khair Pama",
        "admin",
    )
    assert user["password_hash"].startswith("$argon2id$v=19$m=65536,t=3,p=4$")  # the real settings
    assert get_hasher().verify(user["password_hash"], GOOD) == (True, False)
    assert [r["event"] for r in rows(conninfo, "SELECT event FROM core.audit_log")] == [
        "account_created"
    ]
    for shown in (out.out, out.err):
        assert GOOD not in shown


def test_create_admin_does_not_make_a_second_account_with_the_same_login(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0
    capsys.readouterr()
    code, _ = run(monkeypatch, NEW, NEW, argv=["create-admin", "--email", "AL.KHAIR@example.test"])
    assert code == 1
    assert "That email is already used by an account" in capsys.readouterr().err
    assert len(rows(conninfo, "SELECT 1 FROM core.users")) == 1


def test_create_admin_checks_the_login_before_it_asks_for_a_password(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, asked = run(monkeypatch, argv=["create-admin", "--email", "not an email"])
    assert (code, asked) == (1, [])
    assert "doesn't look like an email" in capsys.readouterr().err
    code, asked = run(
        monkeypatch, argv=["create-admin", "--email", "a@b.test", "--username", "A B"]
    )
    assert (code, asked) == (1, [])
    assert "A username is 3 to 64" in capsys.readouterr().err
    assert rows(conninfo, "SELECT 1 FROM core.users") == []


def test_create_admin_asks_again_after_a_weak_password_and_stops_after_three(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    weak = ("short", "alkhair alkhair alkhair", "1q2w3e4r5t6y7u8i9o0p")
    code, asked = run(monkeypatch, *weak, argv=CREATE)
    err = capsys.readouterr().err
    assert code == 1
    assert len(asked) == 3
    assert "Use at least 14 characters" in err
    assert "too common" in err
    assert "No account was made" in err
    assert rows(conninfo, "SELECT 1 FROM core.users") == []
    for password in weak:
        assert password not in err

    # A weak one and then a good one, with a typing slip in between, works.
    code, asked = run(monkeypatch, "short", GOOD, NEW, GOOD, GOOD, argv=CREATE)
    assert code == 0
    assert len(asked) == 5
    assert "different" in capsys.readouterr().err


def test_a_command_that_asks_for_a_password_needs_a_terminal(
    conninfo: str, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The real `read_secret` refuses a pipe or a script: a password must not come from one."""
    real = cli.read_secret
    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0  # an account for reset-password
    capsys.readouterr()
    monkeypatch.setattr(cli, "read_secret", real)
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False)  # even when run with pytest -s
    before = rows(conninfo, "SELECT password_hash FROM core.users")
    for argv in (
        ["create-admin", "--email", "bo@example.test"],
        ["reset-password", "--user", "alkhair"],
    ):
        assert cli.main(argv) == 1
        assert "has to run in a terminal" in capsys.readouterr().err
    assert rows(conninfo, "SELECT password_hash FROM core.users") == before  # nothing changed


def test_reset_password_sets_the_new_password_and_ends_the_sessions(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0
    (user,) = rows(conninfo, "SELECT id FROM core.users")
    with psycopg.connect(conninfo, autocommit=True) as connection:
        connection.execute(
            "UPDATE core.users SET failed_attempts = 10, locked_until = now() + interval '15 min'"
        )
        for label in ("one", "two"):
            connection.execute(
                "INSERT INTO core.sessions (id, token_hash, user_id, expires_at) "
                "VALUES (gen_random_uuid(), %s, %s, now() + interval '12 hours')",
                (hashlib.sha256(label.encode()).hexdigest(), user["id"]),
            )
    capsys.readouterr()

    code, asked = run(monkeypatch, NEW, NEW, argv=["reset-password", "--user", "ALKHAIR"])
    out = capsys.readouterr()
    assert code == 0
    assert asked == ["New password: ", "New password again: "]
    assert out.out.strip() == (
        "The password for al.khair@example.test is changed, and any lock is lifted. "
        "2 sessions ended: it must sign in again."
    )
    (saved,) = rows(conninfo, "SELECT * FROM core.users")
    assert get_hasher().verify(saved["password_hash"], NEW) == (True, False)
    assert get_hasher().verify(saved["password_hash"], GOOD) == (False, False)
    assert (saved["failed_attempts"], saved["locked_until"]) == (0, None)
    assert all(
        s["ended_at"] is not None for s in rows(conninfo, "SELECT ended_at FROM core.sessions")
    )
    events = [r["event"] for r in rows(conninfo, "SELECT event FROM core.audit_log ORDER BY id")]
    assert events == ["account_created", "password_changed"]
    for shown in (out.out, out.err):
        assert NEW not in shown


def test_reset_password_for_an_account_that_is_not_signed_in_says_so(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0
    capsys.readouterr()
    assert run(monkeypatch, NEW, NEW, argv=["reset-password", "--user", "alkhair"])[0] == 0
    assert capsys.readouterr().out.strip() == (
        "The password for al.khair@example.test is changed, and any lock is lifted. "
        "It had no open sessions."
    )


def test_reset_password_for_nobody_asks_nothing(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, asked = run(monkeypatch, argv=["reset-password", "--user", "nobody"])
    assert (code, asked) == (1, [])
    assert "No account has that email or username." in capsys.readouterr().err


def test_reset_password_does_not_change_it_when_no_good_one_is_given(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0
    before = rows(conninfo, "SELECT password_hash FROM core.users")
    code, _ = run(
        monkeypatch, "short", "tiny", "1234", argv=["reset-password", "--user", "alkhair"]
    )
    assert code == 1
    assert "The password was not changed" in capsys.readouterr().err
    assert rows(conninfo, "SELECT password_hash FROM core.users") == before


def test_sign_out_everyone_says_how_many_and_who(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["sign-out-everyone"]) == 0
    assert capsys.readouterr().out.strip() == "Signed out 0 sessions of 0 people."

    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0
    (user,) = rows(conninfo, "SELECT id FROM core.users")
    with psycopg.connect(conninfo, autocommit=True) as connection:
        connection.execute(
            "INSERT INTO core.sessions (id, token_hash, user_id, expires_at) "
            "VALUES (gen_random_uuid(), %s, %s, now() + interval '12 hours')",
            (hashlib.sha256(b"only one").hexdigest(), user["id"]),
        )
    capsys.readouterr()
    assert cli.main(["sign-out-everyone"]) == 0
    assert capsys.readouterr().out.strip() == "Signed out 1 session of 1 person."
    (entry,) = rows(conninfo, "SELECT * FROM core.audit_log WHERE event = 'sign_out_everywhere'")
    assert entry["details"] == {"by": "command", "sessions_ended": 1}


def test_nothing_the_commands_print_or_log_holds_a_password(
    conninfo: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The commands start the app's logger, which writes JSON lines to stderr: it is read here."""
    assert run(monkeypatch, GOOD, GOOD, argv=CREATE)[0] == 0
    assert run(monkeypatch, NEW, NEW, argv=["reset-password", "--user", "alkhair"])[0] == 0
    assert cli.main(["sign-out-everyone"]) == 0
    seen = capsys.readouterr()
    for password in (GOOD, NEW):
        assert password not in seen.out
        assert password not in seen.err


def test_clean_logins_are_lower_case_and_plain_ascii() -> None:
    assert clean.email("  Al.Khair@Example.TEST ") == "al.khair@example.test"
    for bad in ("", "al", "al@", "@x.test", "al@x", "a l@x.test", "al@x.test\n.evil", "ål@x.test"):
        with pytest.raises(ValueError, match="email"):
            clean.email(bad)
    assert clean.username(None) is None
    assert clean.username("   ") is None
    assert clean.username(" Al-Khair ") == "al-khair"
    for bad in ("ab", "-ab", "a b c", "al@khair", "ål-khair", "x" * 65):
        with pytest.raises(ValueError, match="username"):
            clean.username(bad)
    assert clean.login("  AL@x.test  ") == "al@x.test"
    assert len(clean.login("x" * 1000)) == 254


def test_clean_ip_and_browser_names() -> None:
    assert clean.ip("203.0.113.7") == "203.0.113.7"
    assert clean.ip(" 2001:0db8:0000:0000:0000:0000:0000:0001 ") == "2001:db8::1"
    assert clean.ip("::ffff:203.0.113.7") == "203.0.113.7"  # IPv4 in IPv6 clothes
    assert clean.ip("[::1]") == "::1"
    for bad in (None, "", "not an ip", "999.1.1.1", "1.2.3.4, 5.6.7.8"):
        assert clean.ip(bad) is None
    assert clean.user_agent(None) is None
    assert clean.user_agent("") is None
    assert clean.user_agent("  \x00 ") is None
    assert clean.user_agent("Mozilla/5.0\x00 (X11)") == "Mozilla/5.0 (X11)"
    assert clean.user_agent("x" * 1000) == "x" * 300
