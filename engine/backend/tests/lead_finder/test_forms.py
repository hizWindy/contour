"""Every answer form Claude gets stays well under Anthropic's limits for strict forms.

From 30 Oct 2026 the company form had 18 fields that could be "null or a value", over the limit of
16, and Claude refused every request with "The compiled grammar is too large" (PLAN-V4 B1). From
16 Nov 2026 it was refused again with only 3 such fields: it had grown from 7,687 to 10,357
characters (PLAN-V16), and the size of the whole form counts too. So the company facts are asked in
two smaller forms (PLAN-V20). These tests fail first next time. They are free: nothing is sent.
"""

import argparse
import uuid
from typing import Any

import pytest
from pydantic import BaseModel, create_model

from apps.lead_finder import cli
from apps.lead_finder.fields import (
    COMPANY_FORMS,
    EXTRA_FACTS,
    AngleNotes,
    Candidates,
    CompanyCoreForm,
    CompanyExtrasForm,
    CompanyFacts,
    Fact,
    join_facts,
)
from core.claude.forms import CHARACTERS_LIMIT, MARGIN, UNION_FIELDS_LIMIT, form_schema, form_size
from tests.lead_finder.samples import make_facts

# Every form Claude is sent. `CompanyFacts` itself is not one: it is what the two company forms
# are joined into, and it is too big to send (a test below).
FORMS: list[type[BaseModel]] = [AngleNotes, CompanyCoreForm, CompanyExtrasForm, Candidates]


@pytest.mark.parametrize("form", FORMS, ids=lambda form: form.__name__)
def test_every_form_stays_well_under_the_limits(form: type[BaseModel]) -> None:
    size = form_size(form)
    assert size.within_limits, size
    assert size.union_fields <= UNION_FIELDS_LIMIT - MARGIN
    assert size.characters <= CHARACTERS_LIMIT


def test_only_a_facts_value_can_be_null_in_the_company_forms() -> None:
    assert form_size(CompanyCoreForm).union_fields == 3  # Fact[str], Fact[int] and Fact[bool]
    assert form_size(CompanyExtrasForm).union_fields == 2  # Fact[int] and Fact[bool]


def test_a_form_like_the_one_that_broke_on_30_oct_fails_the_check() -> None:
    fields: dict[str, Any] = {f"field_{n}": (str | None, ...) for n in range(18)}
    too_big = create_model("TooBig", **fields)
    size = form_size(too_big)
    assert size.union_fields == 18
    assert not size.within_limits


def test_the_whole_company_form_is_too_big_to_send_in_one_request() -> None:
    """16 Nov 2026: Claude refused this form, 10,357 characters, with "The compiled grammar is too
    large", though it has 3 null-or-value fields and no optional ones. If this test fails, the
    form got smaller: try it live (`lead-finder forms --live --yes`) before sending it whole."""
    size = form_size(CompanyFacts)
    assert size.characters > CHARACTERS_LIMIT
    assert not size.within_limits
    assert size.union_fields <= UNION_FIELDS_LIMIT - MARGIN  # the old counts alone say it is fine


def test_a_form_over_the_biggest_size_we_know_works_fails_the_check() -> None:
    fields: dict[str, Any] = {f"a_field_with_a_long_name_{n}": (str, ...) for n in range(300)}
    size = form_size(create_model("Long", **fields))
    assert size.union_fields == 0 and size.optional_fields == 0
    assert size.characters > CHARACTERS_LIMIT
    assert not size.within_limits


def test_the_two_company_forms_hold_every_fact_once() -> None:
    first, second = set(CompanyCoreForm.model_fields), set(CompanyExtrasForm.model_fields)
    assert first | second == set(CompanyFacts.model_fields)
    assert not first & second
    assert second == set(EXTRA_FACTS)
    assert (CompanyCoreForm, CompanyExtrasForm) == COMPANY_FORMS


def test_a_company_form_reads_an_empty_answer_as_unknown_like_the_whole_form_does() -> None:
    schema = form_schema(CompanyCoreForm)
    assert schema["properties"]["industry_group"]["type"] == "string"  # plain text for Claude
    dump = make_facts().model_dump(mode="json")
    first = {name: dump[name] for name in CompanyCoreForm.model_fields} | {"industry_group": ""}
    assert CompanyCoreForm.model_validate(first).industry_group is None  # type: ignore[attr-defined]


def test_two_answers_join_into_the_facts_they_were_made_from() -> None:
    facts = make_facts()
    dump = facts.model_dump(mode="json")
    first = CompanyCoreForm.model_validate({n: dump[n] for n in CompanyCoreForm.model_fields})
    second = CompanyExtrasForm.model_validate({n: dump[n] for n in CompanyExtrasForm.model_fields})
    assert join_facts(first, second) == facts


def test_without_the_second_answer_its_facts_are_unknown_and_the_rest_is_kept() -> None:
    facts = make_facts()
    dump = facts.model_dump(mode="json")
    first = CompanyCoreForm.model_validate({n: dump[n] for n in CompanyCoreForm.model_fields})
    joined = join_facts(first)
    assert joined.city == facts.city and joined.summary == facts.summary
    assert joined.dampeners == [] and joined.contact_roles == []
    assert joined.staff_projected.value is None and joined.contour_angle is None


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
    assert "company extras: 2 of 16 null-or-value fields" in out
    assert "TOO COMPLEX" not in out


def test_the_live_check_asks_for_yes_before_it_spends(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def never(*_: object) -> None:
        raise AssertionError("Claude was set up before the person said yes")

    monkeypatch.setattr(cli, "configure_claude", never)
    assert cli._forms(forms_args(live=True)) == 1
    assert "--yes" in capsys.readouterr().out


# --- The command: `lead-finder refill` (PLAN-V4 B5) -----------------------------------------------


def test_the_refill_command_says_what_it_costs_before_it_spends(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def two_failed() -> list[tuple[uuid.UUID, str]]:
        return [(uuid.uuid4(), "Myer"), (uuid.uuid4(), "KBR")]

    async def never(leads: object) -> None:
        raise AssertionError("a lead was refilled before the person said yes")

    monkeypatch.setattr(cli, "_failed_leads", two_failed)
    monkeypatch.setattr(cli, "_refill", never)
    assert cli._refill_command(argparse.Namespace(yes=False)) == 1
    out = capsys.readouterr().out
    assert "2 leads have missing facts: Myer, KBR." in out
    assert "about US$0.70 in all" in out and "--yes" in out


def test_the_refill_command_has_nothing_to_do_without_failed_leads(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def none_failed() -> list[tuple[uuid.UUID, str]]:
        return []

    monkeypatch.setattr(cli, "_failed_leads", none_failed)
    assert cli._refill_command(argparse.Namespace(yes=True)) == 0
    assert "Nothing to refill" in capsys.readouterr().out
