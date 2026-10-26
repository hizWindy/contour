"""rules/watchlist.yaml loads, is part of the rules version, and stops start-up when it's wrong."""

import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from apps.lead_finder.rules import (
    RULE_FILES,
    RULES_DIR,
    industry_name_key,
    load_rules,
    read_rules,
)


def copy_rules(target: Path) -> Path:
    for name in RULE_FILES:
        shutil.copy(RULES_DIR / f"{name}.yaml", target / f"{name}.yaml")
    return target


def edit(path: Path, old: str, new: str) -> None:
    content = path.read_text(encoding="utf-8")
    assert old in content, f"{old!r} not found in {path.name}"
    path.write_text(content.replace(old, new), encoding="utf-8")


def test_the_watchlist_file_is_one_of_the_rules_files() -> None:
    assert "watchlist" in RULE_FILES
    assert (RULES_DIR / "watchlist.yaml").is_file()


def test_the_watchlist_rules_match_the_spec() -> None:
    rules = load_rules().watchlist
    assert rules.count_cities == ["Melbourne", "Adelaide", "Perth"]
    assert rules.staff.missing == "unknown"
    assert rules.staff.staff_max_applies_to_director is False
    assert list(rules.director_industries) == [
        "Hospitals and healthcare",
        "Law firms",
        "Premium banks and finance",
        "Real estate agencies",
        "Education",
        "Industry consultants",
        "Standard not-for-profits",
    ]
    assert rules.director_industries["Premium banks and finance"] == [
        "Financial Services",
        "Insurance",
        "Banking",
    ]
    assert rules.not_office_based["Transport and logistics"] == [
        "Transportation Trucking Railroad",
        "Maritime",
    ]
    assert rules.not_office_based["none"] == ["Oil Energy", "Medical Practice"]
    assert {note.key for note in rules.tbc} >= {"count_cities", "staff.missing"}


def test_the_groups_exist_in_the_criteria() -> None:
    rules = load_rules()
    director = set(rules.criteria.industries.director_review)
    office = set(rules.criteria.industries.check_office_size)
    assert set(rules.watchlist.director_industries) <= director
    assert set(rules.watchlist.not_office_based) - {"none"} <= office


def test_the_version_covers_the_watchlist_file(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    before = read_rules(rules_dir).version
    assert before == load_rules().version  # a copy of the files gives the same version
    edit(rules_dir / "watchlist.yaml", "Hospital Health Care", "Hospital And Health Care")
    assert read_rules(rules_dir).version != before


def test_a_missing_watchlist_file_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    (rules_dir / "watchlist.yaml").unlink()
    with pytest.raises(FileNotFoundError):
        read_rules(rules_dir)


def test_a_typo_in_a_key_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "count_cities:", "count_citys:")
    with pytest.raises(ValidationError):
        read_rules(rules_dir)


def test_an_unknown_staff_rule_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "missing: unknown", "missing: employees")
    with pytest.raises(ValidationError):
        read_rules(rules_dir)


def test_a_director_group_must_be_in_the_criteria(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "  Law firms: [Law Practice]", "  Lawyers: [Law Practice]")
    with pytest.raises(ValidationError, match="director_industries has groups"):
        read_rules(rules_dir)


def test_a_not_office_based_group_must_be_in_the_criteria(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "  Retail: [Retail]", "  Shops: [Retail]")
    with pytest.raises(ValidationError, match="not_office_based has groups"):
        read_rules(rules_dir)


def test_the_none_group_needs_no_criteria_group(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "watchlist.yaml",
        "  none: [Oil Energy, Medical Practice]",
        "  none: [Oil Energy]",
    )
    assert read_rules(rules_dir).watchlist.not_office_based["none"] == ["Oil Energy"]


def test_an_industry_may_not_be_listed_twice(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "  Retail: [Retail]", "  Retail: [Retail, Automotive]")
    with pytest.raises(ValidationError, match="'Automotive' is listed twice"):
        read_rules(rules_dir)


def test_an_industry_may_not_be_both_director_and_not_office_based(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "  Retail: [Retail]", "  Retail: [Retail, Law Practice]")
    with pytest.raises(ValidationError, match="is listed twice"):
        read_rules(rules_dir)


def test_a_repeat_with_other_case_or_spaces_is_still_a_repeat(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "  Retail: [Retail]", "  Retail: [Retail, '  automotive ']")
    with pytest.raises(ValidationError, match="is listed twice"):
        read_rules(rules_dir)


def test_a_blank_industry_name_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "  Retail: [Retail]", "  Retail: [Retail, '  ']")
    with pytest.raises(ValidationError, match="empty industry name"):
        read_rules(rules_dir)


def test_a_count_city_must_be_a_criteria_city(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "watchlist.yaml",
        "count_cities: [Melbourne, Adelaide, Perth]",
        "count_cities: [Melbourne, Hobart]",
    )
    with pytest.raises(ValidationError, match="doesn't: Hobart"):
        read_rules(rules_dir)


def test_a_count_city_may_not_repeat(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "watchlist.yaml",
        "count_cities: [Melbourne, Adelaide, Perth]",
        "count_cities: [Melbourne, Perth, Melbourne]",
    )
    with pytest.raises(ValidationError, match="lists a city twice: Melbourne"):
        read_rules(rules_dir)


def test_count_cities_may_not_be_empty(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "watchlist.yaml",
        "count_cities: [Melbourne, Adelaide, Perth]",
        "count_cities: []",
    )
    with pytest.raises(ValidationError):
        read_rules(rules_dir)


def test_a_tbc_key_must_match_a_watchlist_rule(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "watchlist.yaml", "key: staff.missing", "key: staff.absent")
    with pytest.raises(ValidationError, match="doesn't match a watchlist rule"):
        read_rules(rules_dir)


def test_industry_names_compare_without_case_or_extra_spaces() -> None:
    assert industry_name_key("  Hospital   Health Care ") == industry_name_key(
        "hospital health care"
    )
    assert industry_name_key("Retail") != industry_name_key("Retail Trade")
