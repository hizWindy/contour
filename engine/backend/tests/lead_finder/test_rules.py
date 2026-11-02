"""The rules files load, match the criteria documents, and stop the backend when they're wrong."""

import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

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
    assert (size.staff_min, size.staff_hint_min, size.staff_max) == (100, 75, 600)
    assert size.grow_into_range_months == 24
    assert (size.office_m2_min, size.office_m2_max) == (1000, 6000)
    assert size.director_band_m2 == (800, 1000)
    assert criteria.fitout.rate_per_m2_aud == 1500
    assert [t.id for t in criteria.triggers.main] == [
        "lease_ending",
        "merger_or_takeover",
        "big_new_contract",
        "fast_growth",
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
    assert [t.id for t in criteria.triggers.weak] == ["culture_change", "hiring_push"]
    assert criteria.triggers.consultant_window_months == 18
    assert (criteria.office_age.due_years, criteria.office_age.recent_move_years) == (5, 3)
    assert criteria.never_suggest.dissolved_deal_wait_months == 12


def test_numbers_line_up_with_the_deal_criteria() -> None:
    criteria = load_rules().criteria
    smallest = (
        criteria.size.staff_min
        * criteria.size.m2_per_staff
        * float(criteria.fitout.rate_per_m2_aud)
    )
    assert smallest == 1_500_000  # 100 staff x 10 m2 x $1,500 = $1.5M, the bottom of the range


def test_every_trigger_has_search_templates() -> None:
    rules = load_rules()
    for trigger in rules.criteria.triggers.every:
        assert rules.queries.discovery[trigger.id], trigger.id


def test_watchlist_searches_from_three_angles() -> None:
    assert set(load_rules().queries.company) == {"property", "people", "money"}


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
    edit(rules_dir / "criteria.yaml", "staff_min: 100", "staff_min: 700")
    with pytest.raises(ValidationError, match="staff_min must be below staff_max"):
        read_rules(rules_dir)


def test_a_staff_hint_above_the_minimum_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "staff_hint_min: 75", "staff_hint_min: 150")
    with pytest.raises(ValidationError, match="staff_hint_min must not be above staff_min"):
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
    assert size.headcount_tool_name_check == "optional"
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
        "headcount_tool_name_check: optional",
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
