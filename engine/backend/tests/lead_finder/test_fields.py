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


def test_talking_points_and_firm_names_are_cut_after_parsing() -> None:
    long_text = "word " * 100
    facts = make_facts(
        talking_points=[long_text, "b", "c", "d"], fitout_contractors=["A", " ", *"BCDEF"]
    )
    cut = CompanyFacts.model_validate(facts.model_dump(mode="json"))
    assert len(cut.talking_points) == 3
    assert all(len(point) <= 200 for point in cut.talking_points)
    assert cut.fitout_contractors == ["A", "B", "C", "D", "E"]  # the blank one is dropped


def test_a_card_with_none_of_the_newer_facts_still_opens() -> None:
    old: dict[str, Any] = make_facts().model_dump(mode="json")
    for name in NEWER:
        del old[name]
    facts = CompanyFacts.model_validate(old)
    assert facts.name == "Acme Software"
    assert all(getattr(facts, name) is not None for name in NEWER_LISTS)


def test_decision_makers_keep_a_name_and_title_only_and_at_most_three() -> None:
    def person(name: str, role: str = "Chief Financial Officer") -> dict[str, Any]:
        return {
            "name": name,
            "role": role,
            "source_url": "https://acme.com.au/team",
            "source_date": None,
        }

    data: dict[str, Any] = make_facts().model_dump(mode="json")
    data["decision_makers"] = [
        person("  Jane   Citizen "),
        person("jane citizen", "Chief Executive Officer"),  # the same person twice
        person("jane@acme.com.au"),  # an email address, not a name
        person("Sam Example", "COO, 0412 345 678"),  # a phone number in the title
        person("Agent 47"),  # a name with digits is not a name
        person("", "CEO"),
        person("Lee Person", "Head of Property"),
        person("Kim Person", "Chief Operating Officer"),
        person("Ash Person", "Chief Executive Officer"),
    ]
    people = CompanyFacts.model_validate(data).decision_makers
    assert [(p.name, p.role) for p in people] == [
        ("Jane Citizen", "Chief Financial Officer"),
        ("Lee Person", "Head of Property"),
        ("Kim Person", "Chief Operating Officer"),
    ]


def test_a_card_saved_before_decision_makers_existed_has_none() -> None:
    old: dict[str, Any] = make_facts().model_dump(mode="json")
    del old["decision_makers"]
    assert CompanyFacts.model_validate(old).decision_makers == []
