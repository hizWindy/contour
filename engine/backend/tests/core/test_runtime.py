"""Process setup: LangSmith tracing is forced off, so prompts and answers never leave."""

import os
from collections.abc import Iterator

import langsmith
import langsmith.utils as ls_utils
import pytest

from core.runtime import TRACING_KEYS, TRACING_VARIABLES, disable_tracing


@pytest.fixture
def tracing_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """The worst case: tracing turned on in the environment, with API keys present."""
    # Forget any earlier disable_tracing() in this process (another test, or create_app()).
    langsmith.configure(enabled=None)
    ls_utils.get_env_var.cache_clear()  # type: ignore[attr-defined]
    for name in TRACING_VARIABLES:
        monkeypatch.setenv(name, "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2-secret")
    monkeypatch.setenv("LANGCHAIN_API_KEY", "lsv2-secret-too")
    yield monkeypatch
    langsmith.configure(enabled=False)  # leave tracing off, as the app does


def test_tracing_is_switched_off_even_when_the_environment_turns_it_on(
    tracing_on: pytest.MonkeyPatch,
) -> None:
    assert ls_utils.tracing_is_enabled() is True  # the setup really turns it on

    disable_tracing()

    assert ls_utils.tracing_is_enabled() is False


def test_the_tracing_variables_are_false_and_the_keys_are_gone(
    tracing_on: pytest.MonkeyPatch,
) -> None:
    assert os.environ["LANGSMITH_API_KEY"]
    disable_tracing()

    for name in TRACING_VARIABLES:
        assert os.environ[name] == "false", name
    for name in TRACING_KEYS:
        assert name not in os.environ, name


def test_the_list_covers_every_name_the_libraries_read() -> None:
    assert set(TRACING_VARIABLES) == {
        "LANGSMITH_TRACING",
        "LANGCHAIN_TRACING_V2",
        "LANGCHAIN_TRACING",
        "LANGSMITH_TRACING_V2",
    }
    assert set(TRACING_KEYS) == {"LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"}


def test_disabling_twice_is_fine(tracing_on: pytest.MonkeyPatch) -> None:
    disable_tracing()
    disable_tracing()
    assert ls_utils.tracing_is_enabled() is False
