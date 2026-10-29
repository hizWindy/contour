"""The answer form: Claude must fill every fact, and an older saved card still opens."""

from typing import Any

import pytest

from apps.lead_finder.fields import NEWER_FACTS, NEWER_LISTS, NEWER_TEXTS, CompanyFacts
from tests.lead_finder.samples import make_facts

NEWER = (*NEWER_FACTS, *NEWER_LISTS, *NEWER_TEXTS)


def test_the_form_asks_claude_for_every_fact() -> None:
    required = set(CompanyFacts.model_json_schema()["required"])
    assert set(NEWER) <= required  # no defaults in the form Claude sees


@pytest.mark.parametrize("name", NEWER_FACTS)
def test_a_card_saved_before_a_fact_existed_reads_it_as_unknown(name: str) -> None:
    old: dict[str, Any] = make_facts().model_dump(mode="json")
    del old[name]
    fact = getattr(CompanyFacts.model_validate(old), name)
    assert (fact.value, fact.source_url, fact.source_date, fact.label) == (None, None, None, None)


def test_a_card_with_none_of_the_newer_facts_still_opens() -> None:
    old: dict[str, Any] = make_facts().model_dump(mode="json")
    for name in NEWER:
        del old[name]
    facts = CompanyFacts.model_validate(old)
    assert facts.name == "Acme Software"
    assert all(getattr(facts, name) is not None for name in NEWER_LISTS)
