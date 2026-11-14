"""The rules files load, match the criteria documents, and stop the backend when they're wrong."""

import re
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from apps.lead_finder.params import default_triggers, known_trigger_ids
from apps.lead_finder.prompts import extract_prompt
from apps.lead_finder.rules import (
    MAX_DAMPENER_SEARCHES,
    RULE_FILES,
    RULES_DIR,
    load_rules,
    read_rules,
    rules_version,
)


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
    cities = criteria.cities  # all of Australia in four groups (PLAN-V16 T1-2, Criteria_v3.md)
    assert cities.groups["priority"] == ["Melbourne", "Adelaide", "Perth"]
    assert cities.groups["secondary"] == ["Sydney", "Brisbane"]
    assert cities.groups["capital"] == ["Canberra", "Hobart", "Darwin"]
    assert len(cities.groups["regional"]) == 12
    assert cities.national == "Australia"
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
        "capital_raise",  # PLAN-V16 T1-4, Levi's section 4
        "tenant_advisor",  # PLAN-V16 T1-4
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
        "growth_list",  # PLAN-V16 T1-4
    ]
    assert criteria.triggers.consultant_window_months == 18
    assert criteria.triggers.recent_months == 18  # Levi's section 4: ignore anything older
    assert (criteria.office_age.due_years, criteria.office_age.recent_move_years) == (5, 3)
    assert criteria.office_age.just_moved_months == 12  # PLAN-V11 B3
    office_age = criteria.office_age
    assert (office_age.tenure_years, office_age.tenure_sign) == (8, "long_tenure")  # PLAN-V11 C1
    assert criteria.never_suggest.dissolved_deal_wait_months == 12


def test_every_sign_has_the_strength_levi_gave_it() -> None:
    """Levi's section 4 (PLAN-V16 T1-4): very high, high, medium or low. The ids stay."""
    triggers = load_rules().criteria.triggers
    by_strength = {
        strength: [sign.id for sign in triggers.every if sign.strength == strength]
        for strength in ("very_high", "high", "medium", "low")
    }
    assert by_strength["very_high"] == ["lease_ending", "long_tenure"]
    assert by_strength["high"] == [
        "merger_or_takeover",
        "big_new_contract",
        "fast_growth",
        "new_to_australia",
        "capital_raise",
        "tenant_advisor",
    ]
    assert by_strength["medium"] == [
        "hot_industry_growth",
        "office_consolidation",
        "return_to_office",
        "restructure",
        "new_ceo",
        "new_business_unit",
        "new_facility",
        "underperforming_workplace",
    ]
    assert by_strength["low"] == ["culture_change", "hiring_push", "rival_growth", "growth_list"]
    assert triggers.strength_of("capital_raise") == "high"
    assert triggers.strength_of("no_such_sign") is None


def test_a_sign_without_a_strength_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "      strength: low # low on its own",
        "      # low on its own",
    )
    with pytest.raises(ValidationError, match="strength"):
        read_rules(rules_dir)


def test_a_made_up_strength_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "strength: low # low on its own",
        "strength: huge # low on its own",
    )
    with pytest.raises(ValidationError, match="strength"):
        read_rules(rules_dir)


def test_the_competitor_sweep_also_follows_a_sector_tailwind() -> None:
    rivals = load_rules().criteria.rivals
    assert rivals.also_after == ["hot_industry_growth"]


def test_the_sweep_signs_must_be_signs(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml", "also_after: [hot_industry_growth]", "also_after: [moon_base]"
    )
    with pytest.raises(ValidationError, match=r"rivals.also_after has signs that aren't triggers"):
        read_rules(rules_dir)


def test_every_place_has_a_group_and_a_search_area() -> None:
    """All of Australia (PLAN-V16 T1-2): 20 places in four groups, each with a CBD to search."""
    rules = load_rules()
    cities = rules.criteria.cities
    assert len(cities.every) == len(set(cities.every)) == 20
    for place in cities.every:
        assert cities.group_of(place) is not None, place
        assert rules.queries.areas[place]["cbd"], place
    assert cities.group_of("Albury") is None  # not listed: it still passes, with a flag
    assert cities.national not in cities.every


def test_the_six_exclusions_are_levis_section_3() -> None:
    criteria = load_rules().criteria
    assert [(rule.id, rule.kind) for rule in criteria.exclusions] == [
        ("government", "industry"),
        ("not_for_profit", "industry"),
        ("law_firm", "industry"),
        ("big_bank", "industry"),
        ("office_incidental", "office_incidental"),
        ("tender_only", "tender_only"),
    ]
    assert criteria.exclusion_groups == [
        "Government",
        "Standard not-for-profits",
        "Law firms",
        "Premium banks and finance",
    ]
    # They left the Director review (PLAN-V16 T1-3). The rest of the list stays (TBC).
    assert criteria.industries.director_review == [
        "Education",
        "Industry consultants",
        "Real estate agencies",
        "Hospitals and healthcare",
    ]


def test_an_exclusion_group_that_is_also_a_director_group_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml", "industry_groups: [Law firms]", "industry_groups: [Education]"
    )
    with pytest.raises(ValidationError, match="also a Director review or a site-heavy group"):
        read_rules(rules_dir)


def test_two_exclusions_cannot_share_an_id(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "id: law_firm", "id: government")
    with pytest.raises(ValidationError, match="Exclusion ids appear twice: government"):
        read_rules(rules_dir)


def test_the_words_that_save_a_company_need_a_flag(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "    flag: A government-owned or commercialised body. Flagged, not left out\n",
        "",
    )
    with pytest.raises(ValidationError, match="`unless` and `flag` go together"):
        read_rules(rules_dir)


def test_a_place_in_two_groups_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "capital: [Canberra, Hobart, Darwin]",
        "capital: [Hobart, Sydney]",
    )
    with pytest.raises(ValidationError, match=r"listed twice in cities.groups: Sydney"):
        read_rules(rules_dir)


def test_the_national_name_cannot_also_be_a_place(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "national: Australia", "national: Perth")
    with pytest.raises(ValidationError, match=r"cities.national is a run choice"):
        read_rules(rules_dir)


def test_a_place_with_no_search_area_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "capital: [Canberra, Hobart, Darwin]",
        "capital: [Canberra, Hobart, Darwin, Albury]",
    )
    with pytest.raises(ValidationError, match=r"No areas in queries.yaml for: Albury"):
        read_rules(rules_dir)


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


def test_every_source_group_levi_names_has_a_search() -> None:
    """His section 7 (PLAN-V16 T1-7): ten groups, and at least one search for each."""
    groups = load_rules().queries.source_groups
    assert list(groups) == [
        "mergers",
        "funding",
        "hiring",
        "leases_and_tenure",
        "recent_fitouts",
        "outsourcing",
        "leadership",
        "sector_growth",
        "procurement",
        "company_facts",
    ]
    for group_id, group in groups.items():
        assert group.company, group_id  # a search for one company
        assert group.angles, group_id  # asked by at least one research angle
        assert bool(group.signs) == bool(group.discovery), group_id  # a sign's search needs one


def test_the_sites_levi_names_are_in_the_searches() -> None:
    groups = load_rules().queries.source_groups
    text = " ".join(t for group in groups.values() for t in [*group.company, *group.discovery])
    for site in (
        "ACCC acquisitions register",
        "AFR Street Talk",
        "Crunchbase",
        "SmartCompany",
        "Startup Daily",
        "SEEK",
        "The Urban Developer",
        "AFR Commercial Real Estate",
        "Wayback Machine",
        "ArchitectureAU",
        "Office Snapshots",
        "JLL CBRE Cushman and Wakefield Colliers",
        "AusTender",
        "ASIC",
        "WGEA",
        "Infrastructure Australia",
    ):
        assert site in text, site


def test_a_research_angle_asks_the_groups_that_name_it() -> None:
    queries = load_rules().queries
    assert [g.label for g in queries.groups_for_angle("money")] == [
        "Mergers and acquisitions",
        "Funding and growth",
        "Sector growth",
    ]
    assert [g.label for g in queries.groups_for_angle("dampeners")] == [
        "Recent fitouts",
        "Outsourcing and competitor ties",
        "Procurement",
    ]
    tenure = [g.label for g in queries.groups_for_angle("tenure")]
    assert tenure == ["Leases, moves and tenure"]


def test_a_sign_asks_the_groups_that_name_it() -> None:
    queries = load_rules().queries
    assert [g.label for g in queries.groups_for_sign("fast_growth")] == [
        "Funding and growth",
        "Hiring",
    ]
    assert queries.groups_for_sign("long_tenure") == []  # it has no search


def test_a_missing_source_group_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    text = (rules_dir / "queries.yaml").read_text(encoding="utf-8")
    start = text.index("  procurement:\n    label: Procurement")
    end = text.index("  company_facts:")
    (rules_dir / "queries.yaml").write_text(text[:start] + text[end:], encoding="utf-8")
    with pytest.raises(ValidationError, match="source_groups needs Levi's ten groups"):
        read_rules(rules_dir)


def test_a_group_with_no_search_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    text = (rules_dir / "queries.yaml").read_text(encoding="utf-8")
    start = text.index("  outsourcing:\n")
    block_end = text.index("  leadership:\n")
    block = text[start:block_end]
    emptied = block[: block.index("    company:\n")] + "    company: []\n"
    (rules_dir / "queries.yaml").write_text(
        text[:start] + emptied + text[block_end:], encoding="utf-8"
    )
    with pytest.raises(ValidationError, match="company"):
        read_rules(rules_dir)


def test_a_group_with_signs_needs_discovery_searches(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    text = (rules_dir / "queries.yaml").read_text(encoding="utf-8")
    start = text.index("  leadership:\n")
    end = text.index("  sector_growth:\n")
    block = text[start:end]
    without = block[: block.index("    discovery:\n")]
    (rules_dir / "queries.yaml").write_text(text[:start] + without + text[end:], encoding="utf-8")
    with pytest.raises(ValidationError, match="a group with signs needs discovery searches"):
        read_rules(rules_dir)


def test_a_group_can_only_name_a_sign_that_has_a_search(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "queries.yaml", "    signs: [new_ceo]\n", "    signs: [rival_growth]\n")
    with pytest.raises(ValidationError, match=r"source_groups\.leadership has signs that aren't"):
        read_rules(rules_dir)


def test_the_two_kinds_of_search_name_the_company_or_not(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "queries.yaml",
        '      - "{company} jobs SEEK {city}"\n',
        '      - "jobs on SEEK in {city}"\n',
    )
    with pytest.raises(ValidationError, match=r"company searches must name the \{company\}"):
        read_rules(rules_dir)
    other = tmp_path / "other"
    other.mkdir()
    rules_dir = copy_rules(other)
    edit(
        rules_dir / "queries.yaml",
        '      - "SEEK {city} company hiring many office roles {year}"\n',
        '      - "{company} SEEK {city} hiring {year}"\n',
    )
    with pytest.raises(ValidationError, match="discovery searches can't name a "):
        read_rules(rules_dir)


def test_discovery_searches_look_for_plans_not_openings() -> None:
    """PLAN-V11 B4 (Levi, 9 Nov): news of an office that has already opened comes too late."""
    discovery = load_rules().queries.discovery
    every = [template for templates in discovery.values() for template in templates]
    assert [template for template in every if re.search(r"\bopens\b", template)] == []
    assert all("plans" in template for template in discovery["new_to_australia"])
    assert "{city} defence contractor plans new office {year}" in discovery["hot_industry_growth"]
    assert "{city} company plans to double staff {year}" in discovery["fast_growth"]


def test_watchlist_searches_from_three_angles_the_tenure_questions_and_the_dampeners() -> None:
    """A lease and tenure run asks the tenure angle in place of property (PLAN-V11 C2). The
    dampeners angle is searched on purpose in every research (PLAN-V16 T1-5)."""
    company = load_rules().queries.company
    assert set(company) == {"property", "people", "money", "tenure", "dampeners"}
    assert company["tenure"] == [
        "{company} {city} office address",
        "{company} moved office {city}",
        "{company} office fitout",
    ]
    assert company["dampeners"] == [
        "{company} office fitout {city}",
        "{company} JLL OR CBRE OR Colliers corporate real estate",
        "{company} tender fitout",
    ]


def test_the_dampeners_are_levis_five_in_his_order() -> None:
    """His section 5: a fitout or move (strong in 3 years, moderate to 5), an outsourcing deal, a
    tie to a competitor, procurement red flags and financial stress."""
    criteria = load_rules().criteria
    assert [rule.id for rule in criteria.dampeners] == [
        "recent_fitout",
        "outsourcing",
        "competitor_tie",
        "procurement",
        "financial_stress",
    ]
    fitout = criteria.dampener("recent_fitout")
    assert (fitout.strong_years, fitout.moderate_years, fitout.outgrow_months) == (3, 5, 24)
    assert criteria.dampener("outsourcing").strength == "strong"
    assert criteria.dampener("competitor_tie").strength == "moderate"
    procurement = criteria.dampener("procurement")
    assert procurement.kinds == {
        "tender_portal": "strong",
        "offshore_buying": "strong",
        "lowest_price": "moderate",
        "separate_design_and_build": "moderate",
    }
    stress = criteria.dampener("financial_stress")
    assert stress.strength == "strong"
    assert stress.waived_by == ["office_consolidation", "merger_or_takeover"]


def test_the_dampener_search_is_limited_to_three_searches_a_company() -> None:
    assert MAX_DAMPENER_SEARCHES == 3
    assert 1 <= len(load_rules().queries.company["dampeners"]) <= MAX_DAMPENER_SEARCHES


def test_a_fourth_dampener_search_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "queries.yaml",
        '    - "{company} tender fitout"\n',
        '    - "{company} tender fitout"\n    - "{company} outsourcing"\n',
    )
    with pytest.raises(ValidationError, match="dampeners angle needs 1 to 3 search templates"):
        read_rules(rules_dir)


def test_a_missing_dampeners_angle_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    text = (rules_dir / "queries.yaml").read_text(encoding="utf-8")
    start = text.index("  # PLAN-V16 T1-5")
    end = text.index("# Levi's source groups")
    (rules_dir / "queries.yaml").write_text(
        text[:start].rstrip() + "\n\n" + text[end:], encoding="utf-8"
    )
    with pytest.raises(ValidationError, match="the property, people, money, tenure and dampeners"):
        read_rules(rules_dir)


def test_a_dampener_missing_or_out_of_order_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "id: outsourcing", "id: competitor_tie")
    with pytest.raises(ValidationError, match="dampeners needs these, in this order"):
        read_rules(rules_dir)


def test_a_dampener_without_a_strength_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "    strength: strong\n  - id: competitor_tie",
        "  - id: competitor_tie",
    )
    with pytest.raises(ValidationError, match="outsourcing needs a strength"):
        read_rules(rules_dir)


def test_the_fitout_dampener_needs_its_years_and_no_strength(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "    outgrow_months: 24", "    strength: strong")
    with pytest.raises(ValidationError, match="recent_fitout needs strong_years"):
        read_rules(rules_dir)


def test_the_strong_years_stay_under_the_moderate_years(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "strong_years: 3", "strong_years: 6")
    with pytest.raises(ValidationError, match="strong_years must be below moderate_years"):
        read_rules(rules_dir)


def test_only_procurement_has_kinds(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "    strength: strong\n  - id: competitor_tie",
        "    strength: strong\n    kinds: {x: strong}\n  - id: competitor_tie",
    )
    with pytest.raises(ValidationError, match="outsourcing has no kinds"):
        read_rules(rules_dir)


def test_only_financial_stress_can_be_waived(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "    strength: strong\n  - id: competitor_tie",
        "    strength: strong\n    waived_by: [office_consolidation]\n  - id: competitor_tie",
    )
    with pytest.raises(ValidationError, match="outsourcing can't be waived"):
        read_rules(rules_dir)


def test_a_dampener_waiver_must_be_a_sign(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "waived_by: [office_consolidation,", "waived_by: [made_up,")
    with pytest.raises(ValidationError, match="waived_by has signs that aren't triggers: made_up"):
        read_rules(rules_dir)


def test_a_searched_dampener_needs_a_meaning(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    text = (rules_dir / "criteria.yaml").read_text(encoding="utf-8")
    start = text.index("    meaning: A press release or case study")
    end = text.index("\n", start) + 1
    (rules_dir / "criteria.yaml").write_text(text[:start] + text[end:], encoding="utf-8")
    with pytest.raises(ValidationError, match="outsourcing needs a meaning"):
        read_rules(rules_dir)


def test_a_procurement_kind_must_be_named_in_its_meaning(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "lowest_price is a history", "the cheapest bid is a history")
    with pytest.raises(ValidationError, match="meaning must name each kind: lowest_price"):
        read_rules(rules_dir)


def test_the_extract_prompt_asks_for_the_four_dampener_checks() -> None:
    text = extract_prompt(load_rules()).text
    for check in ("recent_fitout", "outsourcing", "competitor_tie", "procurement"):
        assert f"- {check}: " in text
    assert "- financial_stress: " not in text  # it comes from the `healthy` fact
    assert "tender_portal" in text and "separate_design_and_build" in text
    assert 'Never write "none" or "no".' in text
    assert "$dampeners" not in text


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


def test_the_priority_sectors_replace_the_two_tiers() -> None:
    """Levi's section 2 (PLAN-V16 T1-6). Life sciences and medtech was a tier 2 industry, and his
    list doesn't name it."""
    industries = load_rules().criteria.industries
    assert "Technology and telecommunications" in industries.priority_sectors
    assert "Defence and advanced manufacturing" in industries.priority_sectors
    assert "Life sciences and medtech" not in industries.priority_sectors
    assert not hasattr(industries, "tier_1")


def test_a_priority_sector_listed_twice_stops_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "    - Defence and advanced manufacturing # defence",
        "    - Energy and infrastructure # defence",
    )
    with pytest.raises(
        ValidationError, match="A priority sector is listed twice: Energy and infra"
    ):
        read_rules(rules_dir)


def test_the_extract_prompt_lists_every_industry_and_priority_sector() -> None:
    rules = load_rules()
    text = extract_prompt(rules).text
    industries = rules.criteria.industries
    for group in (
        *industries.director_review,
        *industries.check_office_size,
        *industries.priority_sectors,
    ):
        assert f"- {group}" in text
    assert "$priority_sectors" not in text
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
    edit(
        rules_dir / "criteria.yaml",
        "access: { label: Access, points: 20 }",
        "access: { label: Access, points: 25 }",
    )
    with pytest.raises(ValidationError, match="The three parts add up to 105"):
        read_rules(rules_dir)


def test_checks_that_do_not_add_up_to_their_part_stop_start_up(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "  priority_sector: 8\n", "  priority_sector: 10\n")
    with pytest.raises(ValidationError, match="part fit add up to 32, but the part is 30"):
        read_rules(rules_dir)


def test_a_check_that_does_not_exist_cannot_be_unseen(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "unseen: [warm_path]", "unseen: [nope]")
    with pytest.raises(ValidationError, match="checks that don't exist: nope"):
        read_rules(rules_dir)


def test_each_result_needs_a_stage(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(rules_dir / "criteria.yaml", "  drop: Not a target\n", "")
    with pytest.raises(ValidationError, match="stages needs a name for each of the results"):
        read_rules(rules_dir)


def test_the_tiers_must_go_down_from_a_to_c(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "tiers: { a: 75, b: 55, c: 40 }",
        "tiers: { a: 75, b: 80, c: 40 }",
    )
    with pytest.raises(ValidationError, match=r"score\.tiers must go down from a to b to c"):
        read_rules(rules_dir)


def test_the_score_is_levis_three_parts_and_cuts() -> None:
    score = load_rules().criteria.score
    assert {part_id: part.points for part_id, part in score.parts.items()} == {
        "fit": 30,
        "change": 50,
        "access": 20,
    }
    assert (score.tiers.a, score.tiers.b, score.tiers.c) == (75, 55, 40)
    assert (score.dampeners.strong, score.dampeners.moderate) == (20, 10)
    assert score.strongest_sign == {"very_high": 25, "high": 18, "medium": 10, "low": 4}
    assert [(step.from_staff, step.points) for step in score.local_staff] == [
        (250, 12),
        (150, 10),
        (100, 5),
        (50, 2),
    ]
    assert (score.city.priority, score.city.secondary, score.city.other) == (5, 2, 1)
    assert (score.other_signs.points_each, score.other_signs.at_most) == (8, 2)
    assert score.warm_path == 4 and score.unseen == ["warm_path"]
    assert [score.staff_points(staff) for staff in (49, 50, 99, 100, 150, 250)] == [
        0,
        2,
        2,
        5,
        10,
        12,
    ]


def test_a_weaker_sign_cannot_earn_more_than_a_stronger_one(tmp_path: Path) -> None:
    rules_dir = copy_rules(tmp_path)
    edit(
        rules_dir / "criteria.yaml",
        "strongest_sign: { very_high: 25, high: 18, medium: 10, low: 4 }",
        "strongest_sign: { very_high: 25, high: 18, medium: 19, low: 4 }",
    )
    with pytest.raises(ValidationError, match="must not give a weaker sign more points"):
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
