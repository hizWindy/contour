"""The leads table's helpers: the company key, the column length limits and `clip`.

None of these need the database. The key rule is pinned here on purpose: stored keys are copies
of it, so changing it means a new migration (see `company_key`).
"""

import importlib
import json
import subprocess
import sys
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy import String, Table
from sqlalchemy.engine.default import DefaultExecutionContext

from apps.lead_finder.tables import (
    LIMITS,
    UNNAMED_KEY,
    Lead,
    Rival,
    _company_key_from_company,
    clip,
    company_key,
)
from core.config import BACKEND_DIR
from core.runs.models import Run
from core.searches.models import SearchLog

frozen = importlib.import_module("core.db.migrations.versions.0004_lead_columns")

# --- The company key -------------------------------------------------------------------------

KEYS = [
    ("ABC Logistics Pty. Ltd.", "abc logistics"),
    ("Acme Software Pty Ltd", "acme software"),
    ("acme software", "acme software"),  # already a key
    ("Johnson & Johnson Inc", "johnson and johnson"),
    ("Gadget & Co", "gadget and co"),
    ("Harbour Partners Limited", "harbour partners"),
    ("Rio Tinto, Ltd", "rio tinto"),
    ("7-Eleven", "7 eleven"),
    ("O'Connor Partners", "o connor partners"),
    ("  Culture    Amp  ", "culture amp"),
    ("CANVA", "canva"),
    # Letters outside a-z act as separators today. A change to that is a change of every key.
    ("Zürich Insurance", "z rich insurance"),
    # A name made only of legal words falls back to its own lowercase text.
    ("Pty Ltd", "pty ltd"),
    ("  Limited  ", "limited"),
    # Nothing a-z or 0-9 at all: the same fallback.
    ("株式会社", "株式会社"),
    ("Acme™", "acme"),
]


@pytest.mark.parametrize(("name", "key"), KEYS)
def test_company_key_output_is_pinned(name: str, key: str) -> None:
    assert company_key(name) == key


@pytest.mark.parametrize(("name", "key"), KEYS)
def test_company_key_agrees_with_the_frozen_rule_in_migration_0004(name: str, key: str) -> None:
    """0004 filled the keys of the old leads with its own copy of the rule. While the two agree
    the old rows and the new ones are comparable. If `clean_name` changes, this fails first."""
    assert frozen.lead_values(name, None, {})["company_key"] == key


def test_company_key_is_cut_to_the_column_length() -> None:
    limit = LIMITS["lead.company_key"]
    assert company_key("a" * 400) == "a" * limit
    assert len(company_key("word " * 100)) == limit
    assert len(company_key("株" * 400)) == limit  # the fallback is cut too


def test_a_key_is_never_empty_for_a_name_with_text() -> None:
    for name in ("Pty Ltd", "!!!", "株式会社", "™"):
        assert company_key(name) != ""


# A name with no text at all. Spaces and line breaks of every kind count as no text.
BLANK_NAMES = ["", " ", "   ", "\t\n", "\u00a0", "\u2003 \u2003"]


@pytest.mark.parametrize("name", BLANK_NAMES)
def test_a_blank_name_gets_the_fixed_key_unnamed(name: str) -> None:
    assert UNNAMED_KEY == "unnamed"
    assert company_key(name) == "unnamed"


def test_a_key_is_never_empty_for_any_name() -> None:
    for name in (*BLANK_NAMES, "Pty Ltd", "!!!", "\u200b", "x"):
        assert company_key(name) != ""


@pytest.mark.parametrize("name", BLANK_NAMES)
def test_a_blank_name_is_the_one_difference_from_migration_0004(name: str) -> None:
    """Migration 0004's frozen rule is for the legacy rows, and it gave '' for a blank name.
    Every other name gets the same key from both (see the test above). A legacy lead with a
    blank company keeps its '' key, which is why the two rules are not made to agree."""
    assert frozen.lead_values(name, None, {})["company_key"] == ""
    assert company_key(name) == "unnamed"


def test_the_column_default_gives_unnamed_for_a_blank_company() -> None:
    fake = SimpleNamespace(get_current_parameters=lambda: {"company": "  "})
    assert _company_key_from_company(cast(DefaultExecutionContext, fake)) == "unnamed"


def test_the_column_default_gives_the_company_key_of_the_company() -> None:
    """A lead saved without a company_key gets the key of its `company`."""
    column = Lead.__table__.c.company_key
    assert column.default is not None
    assert column.default.is_callable

    def context_for(company: str) -> DefaultExecutionContext:
        fake = SimpleNamespace(get_current_parameters=lambda: {"company": company})
        return cast(DefaultExecutionContext, fake)

    for name, key in KEYS:
        assert _company_key_from_company(context_for(name)) == key


# --- Column length limits and clip -------------------------------------------------------------

MODELS = {"lead": Lead, "rival": Rival, "run": Run}


def string_lengths(prefix: str) -> dict[str, int]:
    """The length of every String column of a model, as keys like 'lead.city'."""
    table = MODELS[prefix].__table__
    return {
        f"{prefix}.{column.name}": column.type.length
        for column in table.columns
        if isinstance(column.type, String) and column.type.length is not None
    }


@pytest.mark.parametrize("prefix", ["lead", "rival", "run"])
def test_limits_match_the_columns_of_the_models(prefix: str) -> None:
    """One list of limits, and the models agree with it. This is what keeps the Run numbers
    (repeated in core/runs/models.py) in step."""
    in_limits = {key: value for key, value in LIMITS.items() if key.startswith(f"{prefix}.")}
    assert in_limits == string_lengths(prefix)


def test_every_limit_belongs_to_the_lead_the_rival_or_the_run() -> None:
    assert {key.split(".")[0] for key in LIMITS} == {"lead", "rival", "run"}


def test_the_search_log_time_index_is_in_the_model() -> None:
    """Migration 0005 made it. The model declares it too, so `alembic check` stays clean."""
    table = SearchLog.__table__
    assert isinstance(table, Table)
    indexes = {str(index.name): [c.name for c in index.columns] for index in table.indexes}
    assert indexes["ix_searches_created_at"] == ["created_at"]
    # Declared once: a second copy elsewhere (it used to be in the Lead Finder's tables.py)
    # would be a second index with the same name.
    assert [str(index.name) for index in table.indexes].count("ix_searches_created_at") == 1


def test_the_search_log_time_index_is_there_when_only_the_search_log_is_imported() -> None:
    """A fresh Python that imports core.searches.models alone, and nothing from apps, sees the
    index. So `alembic check` doesn't depend on which other modules happen to be loaded."""
    code = (
        "import json, sys\n"
        "import core.searches.models as models\n"
        "table = models.SearchLog.__table__\n"
        "print(json.dumps({\n"
        "    'indexes': {str(i.name): [c.name for c in i.columns] for i in table.indexes},\n"
        "    'apps_loaded': sorted(m for m in sys.modules if m.split('.')[0] == 'apps'),\n"
        "}))\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    seen = json.loads(done.stdout.splitlines()[-1])
    assert seen["apps_loaded"] == []  # nothing from apps was needed
    assert seen["indexes"]["ix_searches_created_at"] == ["created_at"]


@pytest.mark.parametrize(
    ("value", "maximum", "expected"),
    [
        ("Melbourne", 120, "Melbourne"),
        ("abcdef", 3, "abc"),
        ("abc", 3, "abc"),  # exactly the limit is not cut
        ("abcd", 3, "abc"),
        ("", 5, ""),
        ("abc", 0, ""),
        ("株式会社", 2, "株式"),  # characters, not bytes
        (None, 5, None),
    ],
)
def test_clip_cuts_to_the_limit_and_leaves_none_alone(
    value: str | None, maximum: int, expected: str | None
) -> None:
    assert clip(value, maximum) == expected


def test_clip_refuses_a_negative_limit() -> None:
    with pytest.raises(ValueError, match="negative"):
        clip("abc", -1)


def test_clip_with_a_limit_from_the_list() -> None:
    assert len(clip("x" * 1000, LIMITS["lead.industry"])) == 120
    assert len(clip("x" * 1000, LIMITS["run.stop_reason"])) == 120
