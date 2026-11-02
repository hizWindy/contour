"""Every answer form Claude gets stays well under Anthropic's limits for strict forms.

From 30 Oct 2026 the company form had 18 fields that could be "null or a value", over the limit of
16, and Claude refused every request with "The compiled grammar is too large" (PLAN-V4 B1). These
tests fail first next time. They are free: nothing is sent.
"""

import argparse
from typing import Any

import pytest
from pydantic import BaseModel, create_model

from apps.lead_finder import cli
from apps.lead_finder.fields import AngleNotes, Candidates, CompanyFacts, Fact
from core.claude.forms import MARGIN, UNION_FIELDS_LIMIT, form_schema, form_size
from tests.lead_finder.samples import make_facts

FORMS: list[type[BaseModel]] = [AngleNotes, CompanyFacts, Candidates]


@pytest.mark.parametrize("form", FORMS, ids=lambda form: form.__name__)
def test_every_form_stays_well_under_the_limits(form: type[BaseModel]) -> None:
    size = form_size(form)
    assert size.within_limits, size
    assert size.union_fields <= UNION_FIELDS_LIMIT - MARGIN


def test_only_a_facts_value_can_be_null_in_the_company_form() -> None:
    assert form_size(CompanyFacts).union_fields == 3  # Fact[str], Fact[int] and Fact[bool]


def test_a_form_like_the_one_that_broke_on_30_oct_fails_the_check() -> None:
    fields: dict[str, Any] = {f"field_{n}": (str | None, ...) for n in range(18)}
    too_big = create_model("TooBig", **fields)
    size = form_size(too_big)
    assert size.union_fields == 18
    assert not size.within_limits


def test_claude_writes_empty_text_for_unknown_and_python_keeps_none() -> None:
    answer = Fact[str].model_validate(
        {"value": None, "source_url": "", "source_date": "  ", "label": ""}
    )
    assert (answer.source_url, answer.source_date, answer.label) == (None, None, None)

    facts = make_facts().model_dump(mode="json")
    facts.update(industry_group="", tier_group="", contact_role="", opening_line=" ")
    read = CompanyFacts.model_validate(facts)
    assert (read.industry_group, read.tier_group, read.contact_role, read.opening_line) == (
        None,
        None,
        None,
        None,
    )


def test_only_claudes_form_changed_the_api_still_says_text_or_null() -> None:
    """`mode="validation"` makes the text plain only in the form Claude gets. The API the website
    reads (serialization) still allows null, so the contract and the website types don't change."""
    for_claude = form_schema(Fact[str])["properties"]
    assert for_claude["source_url"]["type"] == "string"
    assert "" in for_claude["label"]["enum"]
    for_api = Fact[str].model_json_schema(mode="serialization")["properties"]
    assert {"type": "null"} in for_api["source_url"]["anyOf"]
    assert {"type": "null"} in for_api["label"]["anyOf"]


def test_a_saved_card_with_nulls_still_reads() -> None:
    saved = make_facts(contact_role=None, opening_line=None).model_dump(mode="json")
    assert CompanyFacts.model_validate(saved).contact_role is None


# --- The command: `lead-finder forms` -------------------------------------------------------------


def forms_args(**values: object) -> argparse.Namespace:
    return argparse.Namespace(**{"live": False, "yes": False, **values})


def test_the_forms_command_prints_each_form_and_spends_nothing(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def never(*_: object) -> None:
        raise AssertionError("Claude was set up for a free check")

    monkeypatch.setattr(cli, "configure_claude", never)
    assert cli._forms(forms_args()) == 0
    out = capsys.readouterr().out
    assert "company facts: 3 of 16 null-or-value fields" in out
    assert "TOO COMPLEX" not in out


def test_the_live_check_asks_for_yes_before_it_spends(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def never(*_: object) -> None:
        raise AssertionError("Claude was set up before the person said yes")

    monkeypatch.setattr(cli, "configure_claude", never)
    assert cli._forms(forms_args(live=True)) == 1
    assert "--yes" in capsys.readouterr().out
