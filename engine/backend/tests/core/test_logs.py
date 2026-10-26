"""The log: one JSON line each, and never a secret in it.

The database password and the Anthropic API key are replaced by `[redacted]` in every message,
extra field and exception text, whatever way they were written (as they are, percent-encoded in
a web address, escaped in a connection string, written inside JSON or inside the text of a
Python value). Anything shaped like `sk-ant-...` goes too.

The `DETAIL:` part of a Postgres error quotes the values of the row that failed (a company name,
a note). It is replaced by `DETAIL: [hidden]` everywhere: in messages, extra fields and exception
text. The rest of the error stays, so the log still says what went wrong.
"""

import io
import json
import logging
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from core.config import Settings, get_settings
from core.db.engine import get_engine
from core.logs import (
    DETAIL_HIDDEN,
    MIN_SECRET_CHARS,
    QUIET,
    REDACTED,
    JsonFormatter,
    _written_forms,
    hide_detail,
    redact,
    scrub,
    setup_logging,
)

# A password with a space, a quote, a backslash, a slash and an ampersand: every one of them is
# written differently inside a web address, a connection string and a JSON text.
PASSWORD = 'p@ss w"0rd\\9/&x'
API_KEY = "sk-ant-api03-AbCdEf_0123456789-xyz"
OTHER_KEY = "sk-ant-api03-NotConfiguredAnywhere_99"


def make_settings(**values: Any) -> Settings:
    return Settings(_env_file=None, **values)


@pytest.fixture
def secrets(monkeypatch: pytest.MonkeyPatch) -> Settings:
    """Settings with a known password and API key, as the log reads them."""
    settings = make_settings(postgres_password=PASSWORD, anthropic_api_key=API_KEY)
    monkeypatch.setattr("core.logs.get_settings", lambda: settings)
    return settings


@pytest.fixture
def output() -> Iterator[io.StringIO]:
    """A logger that writes its lines to a string, through the real formatter."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("test.logs")
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    yield stream
    logger.handlers = []


log = logging.getLogger("test.logs")


def lines(stream: io.StringIO) -> list[dict[str, Any]]:
    """Every line written so far, each one parsed (so each one must be valid JSON)."""
    return [json.loads(line) for line in stream.getvalue().splitlines()]


def forms_of_the_password() -> list[str]:
    """The password as it would be written in each place it can end up."""
    return [
        PASSWORD,
        quote(PASSWORD, safe=""),  # in a web address
        quote(PASSWORD, safe="").replace("%20", "+"),  # in a web form
        PASSWORD.replace("\\", "\\\\").replace('"', '\\"'),  # in a JSON text
    ]


# --- The exception that holds both secrets ---------------------------------------------------


def test_an_exception_with_the_password_and_the_key_in_its_text_leaves_neither_in_the_log(
    secrets: Settings, output: io.StringIO
) -> None:
    try:
        try:
            raise ConnectionError(f"could not connect, password {PASSWORD} refused")
        except ConnectionError as inner:
            raise RuntimeError(f"the Anthropic call failed, key {API_KEY}") from inner
    except RuntimeError:
        log.exception("run failed")

    written = output.getvalue()
    for secret in (*forms_of_the_password(), API_KEY, "sk-ant-"):
        assert secret not in written, secret
    (entry,) = lines(output)
    assert entry["message"] == "run failed"
    assert entry["level"] == "error"
    # The text is still useful: what happened is there, only the secrets are not.
    assert "RuntimeError: the Anthropic call failed, key [redacted]" in entry["error"]
    assert "ConnectionError: could not connect, password [redacted] refused" in entry["error"]
    assert "Traceback" in entry["error"]


def test_the_chained_cause_and_context_are_cleaned_too(
    secrets: Settings, output: io.StringIO
) -> None:
    try:
        try:
            raise ValueError(PASSWORD)
        except ValueError:
            raise KeyError(API_KEY)  # noqa: B904  (the point: an implicit context)
    except KeyError:
        log.exception("failed")
    written = output.getvalue()
    assert PASSWORD not in written
    assert API_KEY not in written
    assert written.count(REDACTED) >= 2


# --- Messages, arguments and extra fields ------------------------------------------------------


def test_a_message_and_its_arguments_are_cleaned(secrets: Settings, output: io.StringIO) -> None:
    log.info("using %s and %s", PASSWORD, API_KEY)
    log.warning(f"plain f-string with {PASSWORD}")
    written = output.getvalue()
    assert PASSWORD not in written
    assert API_KEY not in written
    first, second = lines(output)
    assert first["message"] == f"using {REDACTED} and {REDACTED}"
    assert second["message"] == f"plain f-string with {REDACTED}"


def test_the_connection_strings_the_engine_builds_are_cleaned(
    secrets: Settings, output: io.StringIO
) -> None:
    """A web address and a connection string write the password in their own ways."""
    log.error("url %s", secrets.database_url())
    log.error("conninfo %s", secrets.psycopg_conninfo())
    written = output.getvalue()
    for form in forms_of_the_password():
        assert form not in written, form
    assert secrets.database_url() not in written
    assert secrets.psycopg_conninfo() not in written
    first, second = lines(output)
    assert first["message"].startswith("url postgresql+psycopg://leadfinder:[redacted]@127.0.0.1")
    assert second["message"].startswith("conninfo host=127.0.0.1 port=5433 user=leadfinder")
    assert REDACTED in second["message"]


def test_extra_fields_are_cleaned_whatever_they_are_nested_in(
    secrets: Settings, output: io.StringIO
) -> None:
    class Holder:
        def __str__(self) -> str:
            return f"holder of {PASSWORD}"

    log.info(
        "step done",
        extra={
            "run_id": "1b2c",
            "count": 3,
            "ratio": 0.5,
            "ok": True,
            "nothing": None,
            "headers": {"x-api-key": API_KEY, "n": 1},
            "list": ["fine", PASSWORD, ("deep", API_KEY)],
            "object": Holder(),
            f"key_{API_KEY}": "the key as a field name",
        },
    )
    written = output.getvalue()
    assert PASSWORD not in written
    assert API_KEY not in written
    (entry,) = lines(output)
    assert entry["run_id"] == "1b2c"
    assert (entry["count"], entry["ratio"], entry["ok"], entry["nothing"]) == (3, 0.5, True, None)
    assert entry["headers"] == {"x-api-key": REDACTED, "n": 1}
    assert entry["list"] == ["fine", REDACTED, ["deep", REDACTED]]
    assert entry["object"] == f"holder of {REDACTED}"
    assert f"key_{REDACTED}" in entry


def test_a_line_is_still_one_line_of_valid_json(secrets: Settings, output: io.StringIO) -> None:
    log.info('multi\nline %s\twith quotes " and %s', PASSWORD, API_KEY)
    assert len(output.getvalue().splitlines()) == 1
    (entry,) = lines(output)
    assert entry["message"] == f'multi\nline {REDACTED}\twith quotes " and {REDACTED}'


# --- Keys that nothing configured, and secrets that must not be touched --------------------------


def test_anything_shaped_like_an_anthropic_key_is_cleaned_even_if_not_configured(
    secrets: Settings, output: io.StringIO
) -> None:
    log.info("a pasted key %s, and again (%s).", OTHER_KEY, "sk-ant-oat01-x_y-z")
    (entry,) = lines(output)
    assert entry["message"] == f"a pasted key {REDACTED}, and again ({REDACTED})."


def test_the_key_shape_is_cleaned_when_no_key_is_configured_at_all(
    monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    monkeypatch.setattr("core.logs.get_settings", lambda: make_settings())  # no key, no password
    log.info("Authorization %s", OTHER_KEY)
    (entry,) = lines(output)
    assert entry["message"] == f"Authorization {REDACTED}"


def test_text_with_nothing_to_hide_is_unchanged(secrets: Settings, output: io.StringIO) -> None:
    log.info("Researched Acme (Melbourne): score 80, cost $0.31", extra={"run_id": "abc"})
    (entry,) = lines(output)
    assert entry["message"] == "Researched Acme (Melbourne): score 80, cost $0.31"
    assert entry["run_id"] == "abc"
    assert redact("sk-ant is not a key, and neither is sk-ant-") == (
        "sk-ant is not a key, and neither is sk-ant-"
    )


def test_an_empty_password_does_not_mangle_the_log(
    monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    """The default password is empty. Replacing an empty text would put [redacted] everywhere."""
    monkeypatch.setattr("core.logs.get_settings", lambda: make_settings())
    log.info("hello world")
    (entry,) = lines(output)
    assert entry["message"] == "hello world"


def test_a_very_short_secret_is_left_alone_not_cut_out_of_every_word(
    monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    short = "a" * (MIN_SECRET_CHARS - 1)
    monkeypatch.setattr("core.logs.get_settings", lambda: make_settings(postgres_password=short))
    log.info("a banana")
    assert lines(output)[0]["message"] == "a banana"
    long_enough = "a" * MIN_SECRET_CHARS
    monkeypatch.setattr(
        "core.logs.get_settings", lambda: make_settings(postgres_password=long_enough)
    )
    log.info("pw %s end", long_enough)
    assert lines(output)[1]["message"] == f"pw {REDACTED} end"


def test_the_longer_secret_wins_when_one_holds_the_other(
    monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    settings = make_settings(postgres_password="hunter2", anthropic_api_key="hunter2-and-more")
    monkeypatch.setattr("core.logs.get_settings", lambda: settings)
    log.info("both: hunter2-and-more, and hunter2")
    assert lines(output)[0]["message"] == f"both: {REDACTED}, and {REDACTED}"


def test_settings_that_do_not_load_do_not_stop_a_log_line(
    monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    def broken() -> Settings:
        raise RuntimeError("the settings file is wrong")

    monkeypatch.setattr("core.logs.get_settings", broken)
    log.error("startup failed %s", OTHER_KEY)
    (entry,) = lines(output)
    assert entry["message"] == f"startup failed {REDACTED}"  # the key shape still goes


# --- A password written inside JSON, or inside the text of a Python value -----------------------

# Each has something that JSON and Python write differently: quotes, a backslash, a tab, a line
# break, and letters that are not plain ASCII (JSON writes é, Python keeps the letter).
HARD_PASSWORDS = [
    PASSWORD,
    'it\'s "both" kinds',
    "back\\slash and\ttab",
    "line one\nline two-secret",
    "café-päss-wörd",
]


def test_the_password_in_a_json_text_is_cleaned(secrets: Settings, output: io.StringIO) -> None:
    log.info("payload %s", json.dumps({"p": PASSWORD}))
    (entry,) = lines(output)
    assert entry["message"] == f'payload {{"p": "{REDACTED}"}}'


def test_the_password_in_the_text_of_a_dict_is_cleaned(
    secrets: Settings, output: io.StringIO
) -> None:
    log.info("payload %r", {"p": PASSWORD})
    log.info("payload %s", {"p": PASSWORD})  # %s of a dict writes the same text
    first, second = lines(output)
    assert first["message"] == second["message"] == f"payload {{'p': '{REDACTED}'}}"


@pytest.mark.parametrize("password", HARD_PASSWORDS)
def test_a_password_is_cleaned_in_every_way_it_is_written(
    password: str, monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    settings = make_settings(postgres_password=password)
    monkeypatch.setattr("core.logs.get_settings", lambda: settings)
    texts = [
        password,
        json.dumps({"p": password}),
        json.dumps({"p": password}, ensure_ascii=False),
        repr({"p": password}),
        str([password]),
        f"{password!r}",
    ]
    for written in texts:
        log.info(written)
    log.info("again", extra={"payload": texts})
    entries = lines(output)
    forms = [password, json.dumps(password)[1:-1], repr(password)[1:-1]]
    for entry in entries[: len(texts)]:
        assert REDACTED in entry["message"]
        for form in forms:
            assert form not in entry["message"]
    for form in forms:
        assert not any(form in item for item in entries[-1]["payload"])


def test_the_written_forms_include_the_json_and_the_python_text() -> None:
    forms = _written_forms(PASSWORD)
    assert json.dumps(PASSWORD)[1:-1] in forms
    assert repr(PASSWORD)[1:-1] in forms
    assert json.dumps("café", ensure_ascii=False)[1:-1] in _written_forms("café")
    assert "caf\\u00e9" in _written_forms("café")  # what json.dumps writes by default


def test_text_that_only_looks_like_a_written_form_is_left_alone(
    secrets: Settings, output: io.StringIO
) -> None:
    log.info("a json text {\"p\": \"something else\"} and a dict {'p': 'other'}")
    (entry,) = lines(output)
    assert entry["message"] == "a json text {\"p\": \"something else\"} and a dict {'p': 'other'}"


# --- The values a Postgres error quotes ---------------------------------------------------------

UNIQUE = (
    'duplicate key value violates unique constraint "uq_leads_run_id_company_key"\n'
    "DETAIL:  Key (run_id, company_key)=(1b2c3d, acme software) already exists."
)
NOT_NULL = (
    'null value in column "card" of relation "leads" violates not-null constraint\n'
    "DETAIL:  Failing row contains (3f2a, Acme Pty Ltd, null, a private note, 0.00)."
)
SQLALCHEMY_FIRST_LINE = (
    '(psycopg.errors.UniqueViolation) duplicate key value violates unique constraint "pk_settings"'
)
SQLALCHEMY_AFTER = (
    "[SQL: INSERT INTO core.settings (key, value) VALUES (%(key)s::VARCHAR, %(value)s::JSONB)]\n"
    "(Background on this error at: https://sqlalche.me/e/20/gkpj)"
)
SQLALCHEMY = (
    f"{SQLALCHEMY_FIRST_LINE}\n"
    "DETAIL:  Key (key)=(Acme Private Co) already exists.\n"
    f"{SQLALCHEMY_AFTER}"
)
MULTI_LINE = (
    'duplicate key value violates unique constraint "uq_notes"\n'
    "DETAIL:  Key (note)=(first line of the note\n"
    "\n"
    "second line, Acme Private Co) already exists.\n"
    "HINT:  Use another note."
)


def test_a_detail_line_in_a_message_is_hidden_and_the_rest_stays(
    secrets: Settings, output: io.StringIO
) -> None:
    log.error("save failed: %s", UNIQUE)
    log.error("save failed: %s", NOT_NULL)
    first, second = lines(output)
    assert first["message"] == (
        'save failed: duplicate key value violates unique constraint "uq_leads_run_id_company_key"'
        "\nDETAIL: [hidden]"
    )
    assert second["message"] == (
        'save failed: null value in column "card" of relation "leads" violates not-null '
        "constraint\nDETAIL: [hidden]"
    )
    assert DETAIL_HIDDEN == "DETAIL: [hidden]"
    for private in ("acme software", "1b2c3d", "Acme Pty Ltd", "private note"):
        assert private not in output.getvalue()


def test_failing_row_text_without_a_detail_label_is_hidden_too(
    secrets: Settings, output: io.StringIO
) -> None:
    log.error("row problem. Failing row contains (3f2a, Acme Pty Ltd, null)")
    (entry,) = lines(output)
    assert entry["message"] == "row problem. DETAIL: [hidden]"


def test_what_sqlalchemy_adds_after_the_detail_is_kept(
    secrets: Settings, output: io.StringIO
) -> None:
    log.error("%s", SQLALCHEMY)
    (entry,) = lines(output)
    assert entry["message"] == f"{SQLALCHEMY_FIRST_LINE}\nDETAIL: [hidden]\n{SQLALCHEMY_AFTER}"


def test_a_value_with_line_breaks_is_hidden_whole_and_the_hint_after_it_stays(
    secrets: Settings, output: io.StringIO
) -> None:
    log.error("%s", MULTI_LINE)
    (entry,) = lines(output)
    assert entry["message"] == (
        'duplicate key value violates unique constraint "uq_notes"\n'
        "DETAIL: [hidden]\n"
        "HINT:  Use another note."
    )
    assert "second line" not in output.getvalue()
    assert "Acme Private Co" not in output.getvalue()


def test_the_detail_of_every_chained_exception_is_hidden_and_the_traceback_stays(
    secrets: Settings, output: io.StringIO
) -> None:
    try:
        try:
            raise ValueError(UNIQUE)
        except ValueError as inner:
            raise RuntimeError(f"could not save the lead\n{SQLALCHEMY}") from inner
    except RuntimeError:
        log.exception("run failed")
    (entry,) = lines(output)
    error = entry["error"]
    assert error.count(DETAIL_HIDDEN) == 2
    assert error.count("Traceback (most recent call last):") == 2
    assert "The above exception was the direct cause of the following exception:" in error
    assert 'ValueError: duplicate key value violates unique constraint "uq_leads_run_id_' in error
    assert "RuntimeError: could not save the lead" in error
    assert "[SQL: INSERT INTO core.settings" in error  # after the second detail: kept
    for private in ("acme software", "1b2c3d", "Acme Private Co"):
        assert private not in output.getvalue()


def test_the_detail_in_an_extra_field_is_hidden_too(secrets: Settings, output: io.StringIO) -> None:
    log.error("step failed", extra={"error": UNIQUE, "more": {"errors": [NOT_NULL, 3]}})
    (entry,) = lines(output)
    assert entry["error"] == (
        'duplicate key value violates unique constraint "uq_leads_run_id_company_key"'
        "\nDETAIL: [hidden]"
    )
    assert entry["more"]["errors"][0].endswith("\nDETAIL: [hidden]")
    assert entry["more"]["errors"][1] == 3
    assert "acme software" not in output.getvalue()


def test_a_secret_inside_a_detail_is_gone_either_way(
    secrets: Settings, output: io.StringIO
) -> None:
    log.error("bad: DETAIL:  Key (password)=(%s) already exists.", PASSWORD)
    (entry,) = lines(output)
    assert entry["message"] == "bad: DETAIL: [hidden]"
    assert PASSWORD not in output.getvalue()


def test_text_without_a_detail_part_is_not_changed(secrets: Settings, output: io.StringIO) -> None:
    for plain in (
        "Researched Acme: see the detail below, or the DETAILS: page",
        "detail: lower case is not a Postgres label",
        'duplicate key value violates unique constraint "x"',
        "A failing row is one that fails",
    ):
        assert hide_detail(plain) == plain
        log.info(plain)
    assert [entry["message"] for entry in lines(output)] == [
        "Researched Acme: see the detail below, or the DETAILS: page",
        "detail: lower case is not a Postgres label",
        'duplicate key value violates unique constraint "x"',
        "A failing row is one that fails",
    ]


def test_hide_detail_and_scrub_work_on_plain_text(secrets: Settings) -> None:
    assert hide_detail(UNIQUE).endswith("\nDETAIL: [hidden]")
    assert hide_detail("") == ""
    # `redact` is for secrets only. `scrub` does both.
    assert redact(f"{UNIQUE} {API_KEY}").endswith(f"already exists. {REDACTED}")
    assert scrub(f"{UNIQUE}\nHINT:  x {API_KEY}") == (
        'duplicate key value violates unique constraint "uq_leads_run_id_company_key"'
        f"\nDETAIL: [hidden]\nHINT:  x {REDACTED}"
    )


# --- Wiring: the real settings, and the handler the app installs ---------------------------------


def test_the_real_settings_supply_the_secrets(
    monkeypatch: pytest.MonkeyPatch, output: io.StringIO
) -> None:
    """The environment gives the secrets, as it does when the backend runs."""
    for key in Settings.model_fields:
        monkeypatch.delenv(key.upper(), raising=False)
    monkeypatch.setenv("POSTGRES_PASSWORD", "correct-horse-battery")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-from-the-environment")
    get_settings.cache_clear()
    try:
        log.error("both correct-horse-battery and sk-ant-api03-from-the-environment")
        assert lines(output)[0]["message"] == f"both {REDACTED} and {REDACTED}"
    finally:
        get_settings.cache_clear()  # no later test sees what this one set


@pytest.fixture
def root_logger_restored() -> Iterator[logging.Logger]:
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    quiet_levels = {name: logging.getLogger(name).level for name in QUIET}
    yield root
    root.handlers = handlers
    root.setLevel(level)
    for name, quiet_level in quiet_levels.items():
        logging.getLogger(name).setLevel(quiet_level)


def test_setup_logging_installs_the_cleaning_formatter(
    secrets: Settings, root_logger_restored: logging.Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    setup_logging()
    (handler,) = root_logger_restored.handlers
    assert isinstance(handler.formatter, JsonFormatter)

    try:
        raise RuntimeError(f"{PASSWORD} and {API_KEY}")
    except RuntimeError:
        logging.getLogger("some.other.library").exception("it broke")
    written = capsys.readouterr().err
    assert PASSWORD not in written
    assert API_KEY not in written
    assert json.loads(written)["message"] == "it broke"


# --- The database engine hides the values it sent ------------------------------------------------


@pytest.fixture
def fresh_engine_cache() -> Iterator[None]:
    get_engine.cache_clear()
    yield
    get_engine.cache_clear()


def test_the_engine_is_built_to_hide_parameters(fresh_engine_cache: None) -> None:
    assert get_engine().sync_engine.hide_parameters is True


@pytest.mark.integration
async def test_a_database_error_does_not_show_the_values_that_were_sent(
    database_url: str, fresh_engine_cache: None
) -> None:
    """Values can be company names or notes. An error text goes to logs and run records."""
    engine = get_engine()
    try:
        async with engine.connect() as connection:
            with pytest.raises(DBAPIError) as caught:
                await connection.execute(
                    text("SELECT 1 / (CAST(:n AS integer) - CAST(:n AS integer))"),
                    {"n": 424242},
                )
    finally:
        await engine.dispose()
    message = str(caught.value)
    assert "division by zero" in message  # the useful part is there
    assert "424242" not in message  # the value is not


# A key and a note with line breaks. Each is written in the DETAIL line of the error.
PRIVATE_KEYS = ["Acme-Private-Co-424242", "first line Acme-Private\n\nsecond line Co-424242"]
INSERT_SETTING = text("INSERT INTO core.settings (key, value) VALUES (:key, CAST(:value AS jsonb))")


@pytest.mark.integration
@pytest.mark.usefixtures("engine")
@pytest.mark.parametrize("key", PRIVATE_KEYS)
@pytest.mark.parametrize("failure", ["unique", "not_null"])
async def test_a_real_database_error_leaves_the_row_values_out_of_the_log(
    key: str, failure: str, fresh_engine_cache: None, output: io.StringIO
) -> None:
    """Postgres quotes the row in a DETAIL line: `Key (key)=(...) already exists.` or
    `Failing row contains (...)`. `hide_parameters` does not hide that, the log formatter does."""
    engine = get_engine()
    raised: IntegrityError | None = None
    try:
        if failure == "unique":
            async with engine.begin() as connection:
                await connection.execute(INSERT_SETTING, {"key": key, "value": "1"})
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    INSERT_SETTING, {"key": key, "value": "1" if failure == "unique" else None}
                )
        except IntegrityError as error:
            raised = error
            log.exception("could not save the setting")
        async with engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM core.settings WHERE key = :key"), {"key": key}
            )
    finally:
        await engine.dispose()

    assert raised is not None, "the database should have refused the row"
    # The premise: without the formatter, the error text does hold the value.
    assert "Co-424242" in str(raised)
    written = output.getvalue()
    for part in ("Acme-Private", "Co-424242", "second line"):
        assert part not in written
    (entry,) = lines(output)
    assert "DETAIL: [hidden]" in entry["error"]
    assert "DETAIL:  " not in entry["error"]
    wanted = {
        "unique": 'violates unique constraint "pk_settings"',
        "not_null": 'null value in column "value" of relation "settings"',
    }
    assert wanted[failure] in entry["error"]  # what went wrong is still there
    assert "Traceback" in entry["error"]
