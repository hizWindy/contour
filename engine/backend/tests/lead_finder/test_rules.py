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


def test_a_score_over_100_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "boosters_max: 15", "boosters_max: 40")
    with pytest.raises(ValidationError, match="best possible score"):
        read_rules(rules_dir)


def test_every_source_kind_needs_a_score(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", " job_ads: 4 }", " }")
    with pytest.raises(ValidationError, match="one entry for each kind"):
        read_rules(rules_dir)
