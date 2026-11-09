"""The rules files load, match the criteria documents, and stop the backend when they're wrong."""

import re
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from apps.lead_finder.params import default_triggers, known_trigger_ids
from apps.lead_finder.prompts import extract_prompt
from apps.lead_finder.rules import RULE_FILES, RULES_DIR, load_rules, read_rules, rules_version


def copy_rules(target: Path) -> Path:
    for name in RULE_FILES:
        shutil.copy(RULES_DIR / f"{name}.yaml", target / f"{name}.yaml")
    return target


def edit(path: Path, old: str, new: str) -> None:
    content = path.read_text(encoding="utf-8")
    assert old in content, f"{old!r} not found in {path.name}"
    path.write_text(content.replace(old, new), encoding="utf-8")


def test_rules_match_the_criteria_documents() -> None:
    criteria = load_rules().criteria
    assert criteria.cities.pass_ == ["Melbourne", "Adelaide", "Perth"]
    assert criteria.cities.director_review == ["Sydney"]
    size = criteria.size
    assert (size.staff_min, size.staff_hint_min, size.staff_max) == (50, 50, 600)  # PLAN-V11 B2
    assert size.grow_into_range_months == 24
    assert (size.office_m2_min, size.office_m2_max) == (1000, 6000)
    assert size.director_band_m2 == (800, 1000)
    assert criteria.fitout.rate_per_m2_aud == 1500
    assert [t.id for t in criteria.triggers.main] == [
        "lease_ending",
        "merger_or_takeover",
        "big_new_contract",
        "fast_growth",
        "new_to_australia",  # PLAN-V9 B3
        "hot_industry_growth",  # PLAN-V9 B4
        "long_tenure",  # PLAN-V11 C1
    ]
    assert [t.id for t in criteria.triggers.other] == [
        "office_consolidation",
        "return_to_office",
        "restructure",
        "new_ceo",
        "new_business_unit",
        "new_facility",
        "underperforming_workplace",
    ]
    assert [t.id for t in criteria.triggers.weak] == [
        "culture_change",
        "hiring_push",
        "rival_growth",  # PLAN-V9 B5
    ]
    assert criteria.triggers.consultant_window_months == 18
    assert (criteria.office_age.due_years, criteria.office_age.recent_move_years) == (5, 3)
    assert criteria.office_age.just_moved_months == 12  # PLAN-V11 B3
    office_age = criteria.office_age
    assert (office_age.tenure_years, office_age.tenure_sign) == (8, "long_tenure")  # PLAN-V11 C1
    assert criteria.never_suggest.dissolved_deal_wait_months == 12


def test_just_moved_longer_than_recent_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "just_moved_months: 12", "just_moved_months: 40")
    with pytest.raises(ValidationError, match="just_moved_months must fit inside"):
        read_rules(rules_dir)


def test_the_old_office_sign_has_no_search_and_claude_is_not_asked_for_it() -> None:
    """PLAN-V11 C1: the code adds it from the office dates, like the rivals' sign has no search."""
    rules = load_rules()
    assert "long_tenure" not in rules.queries.discovery
    assert "long_tenure" not in {t.id for t in rules.criteria.searchable_triggers}
    assert "long_tenure" not in known_trigger_ids()
    assert "long_tenure" not in default_triggers()  # a discovery run never searches for it
    assert "- long_tenure:" not in extract_prompt(rules).text
    assert "- new_to_australia:" in extract_prompt(rules).text


def test_the_old_office_sign_must_be_a_main_sign(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "tenure_sign: long_tenure", "tenure_sign: culture_change")
    with pytest.raises(ValidationError, match="tenure_sign 'culture_change' must be a main"):
        read_rules(rules_dir)


def test_an_old_office_younger_than_due_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "tenure_years: 8", "tenure_years: 3")
    with pytest.raises(ValidationError, match="tenure_years must not be below due_years"):
        read_rules(rules_dir)


def test_two_signs_have_levis_9_nov_wording() -> None:
    """PLAN-V11 B1: no "about 100 more office staff", and a merger counts even with an old office.
    The ids stay, so old leads keep their sign and show the new wording."""
    labels = {trigger.id: trigger.label for trigger in load_rules().criteria.triggers.main}
    assert labels["merger_or_takeover"] == "Merger or acquisition"
    assert labels["big_new_contract"] == (
        "Big new contract or project award that means a large increase in office staff"
    )


def test_numbers_line_up_with_the_deal_criteria() -> None:
    criteria = load_rules().criteria
    rate = float(criteria.fitout.rate_per_m2_aud)
    # The smallest office in range, 1,000 m2 x $1,500, is the bottom of the deal range: $1.5M.
    assert criteria.size.office_m2_min * rate == 1_500_000
    # Since 9 Nov, 50 staff fit (PLAN-V11 B2): 50 x 10 m2 x $1,500 is about $750k, half the
    # bottom of the range. Whether that is a lead when it isn't growing is TBC with Levi.
    smallest = criteria.size.staff_min * criteria.size.m2_per_staff * rate
    assert smallest == 750_000


def test_every_trigger_has_search_templates() -> None:
    rules = load_rules()
    for trigger in rules.criteria.searchable_triggers:
        assert rules.queries.discovery[trigger.id], trigger.id
    # The rivals' sign has no search: it comes from the rivals table (PLAN-V9 B5).
    assert rules.criteria.rivals.sign == "rival_growth"
    assert "rival_growth" not in rules.queries.discovery


def test_discovery_searches_look_for_plans_not_openings() -> None:
    """PLAN-V11 B4 (Levi, 9 Nov): news of an office that has already opened comes too late."""
    discovery = load_rules().queries.discovery
    every = [template for templates in discovery.values() for template in templates]
    assert [template for template in every if re.search(r"\bopens\b", template)] == []
    assert all("plans" in template for template in discovery["new_to_australia"])
    assert "{city} defence contractor plans new office {year}" in discovery["hot_industry_growth"]
    assert "{city} company plans to double staff {year}" in discovery["fast_growth"]


def test_watchlist_searches_from_three_angles_and_the_tenure_questions() -> None:
    """A lease and tenure run asks the tenure angle in place of property (PLAN-V11 C2)."""
    company = load_rules().queries.company
    assert set(company) == {"property", "people", "money", "tenure"}
    assert company["tenure"] == [
        "{company} {city} office address",
        "{company} moved office {city}",
        "{company} office fitout",
    ]


def test_unconfirmed_rules_are_listed() -> None:
    keys = {note.key for note in load_rules().criteria.tbc}
    assert {"size.staff_counted_in", "size.m2_per_staff", "boosters"} <= keys


def test_version_ignores_line_endings() -> None:
    assert rules_version({"criteria": b"a: 1\r\n"}) == rules_version({"criteria": b"a: 1\n"})


def test_version_changes_when_a_rule_changes(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    before = read_rules(rules_dir).version
    edit(
        rules_dir / "criteria.yaml",
        "dissolved_deal_wait_months: 12",
        "dissolved_deal_wait_months: 6",
    )
    assert read_rules(rules_dir).version != before


def test_impossible_size_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "staff_min: 50", "staff_min: 700")
    with pytest.raises(ValidationError, match="staff_min must be below staff_max"):
        read_rules(rules_dir)


def test_a_staff_hint_above_the_minimum_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "staff_hint_min: 50", "staff_hint_min: 150")
    with pytest.raises(ValidationError, match="staff_hint_min must not be above staff_min"):
        read_rules(rules_dir)


def test_the_staff_floor_and_hint_are_both_50_and_marked_tbc() -> None:
    """Levi, 5 Nov: 75+ staff, or about 50 if growing (PLAN-V9 B1). 9 Nov: 50+ staff fits
    (PLAN-V11 B2), so the hint and the floor are both 50. They wait on his team."""
    criteria = load_rules().criteria
    assert (criteria.size.staff_floor, criteria.size.staff_hint_min) == (50, 50)
    tbc = {note.key for note in criteria.tbc}
    assert {"size.staff_floor", "size.staff_hint_min", "size.staff_min"} <= tbc


def test_a_staff_floor_above_the_hint_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "staff_floor: 50", "staff_floor: 80")
    with pytest.raises(ValidationError, match="staff_floor must not be above staff_hint_min"):
        read_rules(rules_dir)


def test_a_growth_sign_must_be_a_trigger(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "growth_signs: [fast_growth", "growth_signs: [fast_grwth")
    with pytest.raises(ValidationError, match="has signs that aren't triggers: fast_grwth"):
        read_rules(rules_dir)


def test_signal_hire_is_on_with_our_guesses_for_its_numbers() -> None:
    """Switched on 2 Nov at Al-khair's say, before the test of 5 companies (PLAN-V3 A4, B1), so a
    run asks Signal Hire for a staff number nobody else found. Its two numbers are guesses."""
    criteria = load_rules().criteria
    size = criteria.size
    assert size.staff_sources == ["hubspot", "headcount_tool", "linkedin", "web_research"]
    assert size.headcount_tool_multiplier == 2  # a guess, TBC until the test of 5 companies
    # Signal Hire's Company API is off for our account, so a name can't be checked yet: the name as
    # typed is used, and the lead card says so. Back to "required" once the Company API is on.
    assert size.headcount_tool_name_check == "auto"
    keys = {note.key for note in criteria.tbc}
    assert {"size.headcount_tool_multiplier", "size.headcount_tool_name_check"} <= keys


@pytest.mark.parametrize("value", ["0", "-2", "21", "200"])
def test_a_headcount_multiplier_that_cannot_be_right_stops_start_up(
    tmp_path: Path, value: str
) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "headcount_tool_multiplier: 2",
        f"headcount_tool_multiplier: {value}",
    )
    with pytest.raises(ValidationError, match="headcount_tool_multiplier"):
        read_rules(rules_dir)


def test_the_name_check_is_required_or_optional_and_nothing_else(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "headcount_tool_name_check: auto",
        "headcount_tool_name_check: required",
    )
    assert read_rules(rules_dir).criteria.size.headcount_tool_name_check == "required"
    edit(
        rules_dir / "criteria.yaml",
        "headcount_tool_name_check: required",
        "headcount_tool_name_check: sometimes",
    )
    with pytest.raises(ValidationError, match="headcount_tool_name_check"):
        read_rules(rules_dir)


def test_signal_hire_can_be_turned_off_by_taking_it_out_of_the_list(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "staff_sources: [hubspot, headcount_tool, linkedin, web_research]",
        "staff_sources: [hubspot, linkedin, web_research]",
    )
    assert "headcount_tool" not in read_rules(rules_dir).criteria.size.staff_sources


def test_the_industry_tiers_come_from_the_profile() -> None:
    industries = load_rules().criteria.industries
    assert "Technology and telecommunications" in industries.tier_1
    assert "Defence and advanced manufacturing" in industries.tier_2


def test_a_tier_group_in_both_tiers_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "    - Defence and advanced manufacturing",
        "    - Energy and infrastructure",
    )
    with pytest.raises(ValidationError, match="A tier group is listed twice: Energy and infra"):
        read_rules(rules_dir)


def test_the_extract_prompt_lists_every_industry_and_tier_group() -> None:
    rules = load_rules()
    text = extract_prompt(rules).text
    industries = rules.criteria.industries
    for group in (
        *industries.director_review,
        *industries.check_office_size,
        *industries.tier_1,
        *industries.tier_2,
    ):
        assert f"- {group}" in text
    assert "$tier_groups" not in text
    assert "$industry_groups" not in text


def test_typo_in_a_key_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "  healthy: true", "  heathy: true")
    with pytest.raises(ValidationError):
        read_rules(rules_dir)


def test_unknown_placeholder_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "queries.yaml", '"{city} company relocating', '"{town} company relocating')
    with pytest.raises(ValidationError, match="Unknown placeholder"):
        read_rules(rules_dir)


def test_tbc_key_must_match_a_rule(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "key: fit.healthy", "key: fit.wealthy")
    with pytest.raises(ValidationError, match="doesn't match a rule"):
        read_rules(rules_dir)


def test_trigger_without_templates_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "queries.yaml",
        '  hiring_push:\n    - "{city} company hiring push {year}"\n',
        "",
    )
    with pytest.raises(ValidationError, match="No discovery templates for triggers: hiring_push"):
        read_rules(rules_dir)


def test_parts_that_do_not_add_up_to_100_stop_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "points: 25 }", "points: 30 }")
    with pytest.raises(ValidationError, match="The six parts add up to 105"):
        read_rules(rules_dir)


def test_checks_that_do_not_add_up_to_their_part_stop_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "{ main: 15, other: 10, weak: 4 }",
        "{ main: 20, other: 10, weak: 4 }",
    )
    with pytest.raises(ValidationError, match="part trigger add up to 30, but the part is 25"):
        read_rules(rules_dir)


def test_a_check_that_does_not_exist_cannot_be_unseen(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "unseen: [hubspot_contact,", "unseen: [nope,")
    with pytest.raises(ValidationError, match="checks that don't exist: nope"):
        read_rules(rules_dir)


def test_each_result_needs_a_stage(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "  drop: Not a target\n", "")
    with pytest.raises(ValidationError, match="stages needs a name for each of the results"):
        read_rules(rules_dir)


def test_bands_must_go_from_low_to_high(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "investigate: 50", "investigate: 80")
    with pytest.raises(ValidationError, match=r"investigate must be below bands\.research_first"):
        read_rules(rules_dir)


def test_every_source_kind_needs_a_score(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", " job_ads: 2 }", " }")
    with pytest.raises(ValidationError, match="one entry for each kind"):
        read_rules(rules_dir)


# --- The two new signs (PLAN-V9 B3, B4) ---------------------------------------------------------


def test_the_new_signs_are_main_signs_with_their_own_searches() -> None:
    rules = load_rules()
    main = {t.id: t.label for t in rules.criteria.triggers.main}
    assert "Australian city" in main["new_to_australia"]
    assert "booming" in main["hot_industry_growth"]
    assert len(rules.queries.discovery["new_to_australia"]) == 3
    booming = rules.queries.discovery["hot_industry_growth"]
    assert any("energy transition" in search for search in booming)
    assert any("defence" in search for search in booming)
    assert any("critical minerals" in search for search in booming)
    assert {"new_to_australia", "hot_industry_growth"} <= set(rules.criteria.size.growth_signs)
    assert {"triggers.main", "cities.no_city_director_signs"} <= {n.key for n in rules.criteria.tbc}


def test_a_sign_with_no_search_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "queries.yaml", "  hot_industry_growth:", "  hot_industry_growth_off:")
    with pytest.raises(ValidationError, match="hot_industry_growth"):
        read_rules(rules_dir)


def test_another_booming_industry_is_one_more_line(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "queries.yaml",
        '    - "{city} critical minerals company expansion {year}"',
        '    - "{city} critical minerals company expansion {year}"\n'
        '    - "{city} space industry company expansion {year}"',
    )
    assert len(read_rules(rules_dir).queries.discovery["hot_industry_growth"]) == 4


def test_the_extract_prompt_lists_the_new_signs_and_reads_an_announced_office() -> None:
    from apps.lead_finder.prompts import extract_prompt

    text = extract_prompt(load_rules()).text
    assert "- new_to_australia:" in text
    assert "- hot_industry_growth:" in text
    assert "overseas company announces its first" in text
