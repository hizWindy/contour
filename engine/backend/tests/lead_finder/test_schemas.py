"""The Lead Finder's API types: patches, cards, HubSpot matches, options and the test set."""

import uuid
from dataclasses import asdict
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from apps.lead_finder import schemas
from apps.lead_finder.context import ResearchContext, Signal, StepModels
from apps.lead_finder.params import LeadFinderRunParams
from apps.lead_finder.research import (
    HubSpotOut,
    LeadCard,
    NoteOut,
    ResearchCost,
    ResearchRequest,
    empty_facts,
)
from apps.lead_finder.schemas import (
    CityOption,
    LeadDetail,
    LeadPatch,
    LeadRow,
    RunOptions,
    SimilarOut,
    TestItem,
    TestPage,
    TestReport,
    TestSummary,
    WatchCounts,
    WatchItem,
    WatchlistOut,
)
from core.hubspot.matching import HubSpotMatch, MatchCandidate

NOW = datetime(2026, 10, 26, 9, 30, tzinfo=UTC)
LEAD_ID = uuid.UUID("11111111-2222-3333-4444-555555555555")
RUN_ID = uuid.UUID("99999999-2222-3333-4444-555555555555")


def card_json() -> dict[str, Any]:
    """A lead card as Phase 1 saved it: no notes, and a HubSpot match without candidates."""
    card = LeadCard(
        id=LEAD_ID,
        company="Acme Software",
        result="pass",
        score=82,
        summary="A software company with a Melbourne office.",
        why_it_fits="City: Melbourne. Result: Pass.",
        contact_role="Head of Property",
        opening_line=None,
        checks=[],
        triggers=[],
        office_m2=2500,
        office_m2_estimated=False,
        fitout_aud=Decimal("3750000"),
        facts=empty_facts("Acme Software"),
        hubspot=HubSpotOut(
            status="new",
            hubspot_id=None,
            name=None,
            owner=None,
            matched_by=None,
            open_deals=[],
            last_dissolved=None,
        ),
        dropped=[],
        problems=[],
        research=ResearchCost(
            cost_usd=Decimal("1.05"),
            cap_usd=Decimal("2.50"),
            web_searches=6,
            claude_requests=4,
            angles_from_memory=[],
        ),
        rules_version="abc123def456",
        prompt_version="research 1, extract 2",
        created_at=NOW,
    )
    data = card.model_dump(mode="json")
    del data["notes"]
    del data["hubspot"]["candidates"]
    return data


def detail_extras(**changes: Any) -> dict[str, Any]:
    extras: dict[str, Any] = {
        "status": "new",
        "reject_reason": None,
        "note": None,
        "useful": None,
        "run_id": None,
        "origin": "typed",
        "is_test": False,
        "updated_at": NOW,
        "previous": [],
    }
    return extras | changes


# --- LeadPatch: a merge patch ---------------------------------------------------------------


def test_a_patch_tells_omitted_from_null() -> None:
    patch = LeadPatch.model_validate({"note": None, "useful": True})
    assert patch.model_fields_set == {"note", "useful"}
    assert patch.note is None  # cleared: it was sent as null
    assert "status" not in patch.model_fields_set  # unchanged: it was left out
    assert LeadPatch.model_validate({}).model_fields_set == set()


def test_a_status_can_be_new_watching_or_rejected_only() -> None:
    for status in ("new", "watching", "rejected"):
        assert LeadPatch.model_validate({"status": status}).status == status
    with pytest.raises(ValidationError):
        LeadPatch.model_validate({"status": "sent"})  # only the HubSpot send sets this
    with pytest.raises(ValidationError):
        LeadPatch.model_validate({"status": "maybe"})


def test_a_status_cannot_be_cleared() -> None:
    with pytest.raises(ValidationError) as caught:
        LeadPatch.model_validate({"status": None})
    error = caught.value.errors()[0]
    assert error["msg"] == "status can't be cleared. Choose a status."
    assert error["loc"] == ("status",)  # the field, so the API says body.status
    assert len(caught.value.errors()) == 1


def test_a_status_that_is_left_out_is_not_checked_and_the_other_fields_still_clear() -> None:
    patch = LeadPatch.model_validate({"note": None, "reject_reason": None, "useful": None})
    assert patch.status is None
    assert "status" not in patch.model_fields_set
    assert LeadPatch().model_fields_set == set()


def test_text_with_a_nul_character_is_refused_in_a_patch() -> None:
    for field in ("note", "reject_reason"):
        with pytest.raises(ValidationError) as caught:
            LeadPatch.model_validate({field: "call" + chr(0) + "later"})
        assert caught.value.errors()[0]["loc"] == (field,)
    # Line breaks and tabs are fine in a note: only the NUL character is refused.
    assert LeadPatch.model_validate({"note": "line one\nline two\ttab"}).note is not None


def test_a_patch_refuses_other_fields_and_long_text() -> None:
    with pytest.raises(ValidationError):
        LeadPatch.model_validate({"score": 100})
    with pytest.raises(ValidationError):
        LeadPatch.model_validate({"reject_reason": "x" * 1001})
    with pytest.raises(ValidationError):
        LeadPatch.model_validate({"note": "x" * 2001})
    with pytest.raises(ValidationError):
        LeadPatch.model_validate({"useful": "yes please"})


def test_the_undo_patch_can_send_back_exact_previous_values() -> None:
    patch = LeadPatch.model_validate(
        {"status": "new", "reject_reason": None, "note": "Call in March", "useful": None}
    )
    assert patch.model_fields_set == {"status", "reject_reason", "note", "useful"}
    assert patch.model_dump(exclude_unset=True) == {
        "status": "new",
        "reject_reason": None,
        "note": "Call in March",
        "useful": None,
    }


# --- The lead card, with and without the new fields -----------------------------------------


def test_a_phase_1_card_still_loads_into_the_detail() -> None:
    detail = LeadDetail.model_validate({**card_json(), **detail_extras()})
    assert detail.notes == []
    assert detail.hubspot.candidates == []
    assert detail.company == "Acme Software"
    assert detail.status == "new"
    assert detail.previous == []


def test_the_detail_holds_notes_candidates_and_older_researches() -> None:
    card = card_json()
    card["notes"] = [
        {
            "claim": "Acme signed a new lease in Docklands.",
            "url": "https://example.com/news/acme",
            "published": "2026-10-01",
            "angle": "property",
            "from_memory": False,
        }
    ]
    card["hubspot"]["status"] = "possible_match"
    card["hubspot"]["candidates"] = [
        {
            "hubspot_id": "101",
            "name": "Acme Software Group",
            "owner": "Sam",
            "reason": "close_name",
            "score": 0.93,
            "open_deals": [],
            "last_dissolved": "2025-03-01",
        }
    ]
    previous = [
        {
            "id": uuid.uuid4(),
            "created_at": NOW,
            "result": "watch",
            "score": 40,
            "status": "rejected",
        }
    ]
    detail = LeadDetail.model_validate(
        {**card, **detail_extras(previous=previous, run_id=RUN_ID, origin="web", useful=True)}
    )
    assert detail.notes == [NoteOut.model_validate(card["notes"][0])]
    assert detail.hubspot.status == "possible_match"
    assert detail.hubspot.candidates[0].reason == "close_name"
    assert detail.hubspot.candidates[0].last_dissolved == date(2025, 3, 1)
    assert detail.previous[0].result == "watch"
    assert detail.origin == "web"
    dumped = detail.model_dump(mode="json")
    assert dumped["fitout_aud"] == "3750000"
    assert dumped["research"]["cost_usd"] == "1.05"
    assert LeadDetail.model_validate(dumped) == detail


def test_the_detail_is_a_flat_lead_card_with_extras() -> None:
    assert issubclass(LeadDetail, LeadCard)
    extras = {"status", "reject_reason", "note", "useful", "run_id", "origin", "is_test"}
    extras |= {"updated_at", "previous"}
    assert extras <= set(LeadDetail.model_fields)
    assert extras.isdisjoint(LeadCard.model_fields)


def test_the_detail_refuses_a_made_up_status_or_origin() -> None:
    with pytest.raises(ValidationError):
        LeadDetail.model_validate({**card_json(), **detail_extras(status="done")})
    with pytest.raises(ValidationError):
        LeadDetail.model_validate({**card_json(), **detail_extras(origin="scraped")})


# --- HubSpot matches ------------------------------------------------------------------------


def test_hubspot_out_takes_every_status_and_way_of_matching() -> None:
    for status in ("new", "in_hubspot", "open_deal", "dissolved_deal", "possible_match"):
        HubSpotOut(
            status=status,
            hubspot_id=None,
            name=None,
            owner=None,
            matched_by=None,
            open_deals=[],
            last_dissolved=None,
        )
    for matched_by in (
        "domain",
        "name",
        "hubspot_id",
        "close_name",
        "similar_profile",
        "name_in_deal",
    ):
        HubSpotOut.model_validate(
            {
                "status": "in_hubspot",
                "hubspot_id": "1",
                "name": "X",
                "owner": None,
                "matched_by": matched_by,
                "open_deals": [],
                "last_dissolved": None,
            }
        )
    with pytest.raises(ValidationError):
        HubSpotOut.model_validate(
            {
                "status": "maybe",
                "hubspot_id": None,
                "name": None,
                "owner": None,
                "matched_by": None,
                "open_deals": [],
                "last_dissolved": None,
            }
        )
    with pytest.raises(ValidationError):
        HubSpotOut.model_validate(
            {
                "status": "in_hubspot",
                "hubspot_id": "1",
                "name": "X",
                "owner": None,
                "matched_by": "guess",
                "open_deals": [],
                "last_dissolved": None,
            }
        )


def test_a_match_with_candidates_becomes_hubspot_out_the_way_research_does_it() -> None:
    match = HubSpotMatch(
        status="possible_match",
        candidates=[
            MatchCandidate(
                hubspot_id="7",
                name="Apex Plumbing",
                owner=None,
                reason="similar_profile",
                score=0.91,
                open_deals=["Apex 1,200 m2"],
                last_dissolved=date(2025, 1, 31),
            )
        ],
    )
    out = HubSpotOut(**asdict(match))
    assert out.status == "possible_match"
    assert out.matched_by is None
    assert out.candidates[0].open_deals == ["Apex 1,200 m2"]
    assert out.model_dump(mode="json")["candidates"][0]["last_dissolved"] == "2025-01-31"


def test_a_match_without_new_arguments_has_no_candidates() -> None:
    assert HubSpotMatch(status="new").candidates == []
    assert HubSpotOut(**asdict(HubSpotMatch(status="new"))).candidates == []


def test_a_candidate_reason_is_one_of_three() -> None:
    for reason in ("close_name", "similar_profile", "name_in_deal"):
        MatchCandidate(hubspot_id="1", name="X", owner=None, reason=reason, score=0.9)
    with pytest.raises(ValidationError):
        HubSpotOut.model_validate(
            {
                "status": "possible_match",
                "hubspot_id": None,
                "name": None,
                "owner": None,
                "matched_by": None,
                "open_deals": [],
                "last_dissolved": None,
                "candidates": [
                    {"hubspot_id": "1", "name": "X", "owner": None, "reason": "vibes", "score": 1}
                ],
            }
        )


# --- The research request -------------------------------------------------------------------


def test_the_research_request_cleans_what_a_person_types() -> None:
    request = ResearchRequest(
        company="  Culture   Amp ", city="melbourne", website="HTTPS://www.cultureamp.com/team"
    )
    assert request.company == "Culture Amp"
    assert request.city == "Melbourne"
    assert request.website == "cultureamp.com"
    assert request.use_memory is True


def test_the_research_request_is_just_the_public_fields() -> None:
    assert set(ResearchRequest.model_fields) == {"company", "city", "website", "use_memory"}


@pytest.mark.parametrize("name", ["", "A", "<b>Acme</b>", "x" * 81, "Acme; DROP TABLE leads"])
def test_a_bad_company_name_is_a_validation_error_not_a_crash(name: str) -> None:
    with pytest.raises(ValidationError) as caught:
        ResearchRequest(company=name)
    error = caught.value.errors()[0]
    assert error["loc"] == ("company",)
    assert "2 to 80 characters" in error["msg"]


def test_a_bad_city_or_website_is_a_validation_error() -> None:
    with pytest.raises(ValidationError):
        ResearchRequest(company="Acme", city="Perth; DROP")
    with pytest.raises(ValidationError):
        ResearchRequest(company="Acme", website="javascript:alert(1)")


# --- The research context -------------------------------------------------------------------


def test_the_research_context_defaults_describe_a_plain_research() -> None:
    context = ResearchContext()
    assert context.run_id is None
    assert context.origin == "typed"
    assert context.hubspot_id is None
    assert context.is_test is False
    assert context.signals == ()
    assert context.on_reply is None
    assert context.models == StepModels(discover=None, search=None, extract=None)
    assert context.blocked_domains == ()


def test_the_research_context_carries_what_a_run_knows() -> None:
    seen: list[object] = []
    context = ResearchContext(
        run_id=RUN_ID,
        origin="hubspot",
        hubspot_id="101",
        is_test=True,
        signals=(Signal(trigger_id="lease_ending", what_happened="Lease ends", url="https://a.b"),),
        on_reply=seen.append,
        models=StepModels(search="claude-haiku-5-5"),
        blocked_domains=("propertydaily.com.au",),
    )
    assert context.models.search == "claude-haiku-5-5"
    assert context.models.extract is None
    assert context.signals[0].date is None
    with pytest.raises(AttributeError):
        context.origin = "web"  # type: ignore[misc]  # it is frozen


# --- Options, rows, look-alikes, watchlist and tests ---------------------------------------


def test_run_options_can_be_built_and_carry_the_defaults() -> None:
    options = RunOptions(
        cities=[
            CityOption(
                name="Melbourne",
                kind="pass",
                lat=-37.8136,
                lng=144.9631,
                areas=[
                    schemas.AreaOption(id="cbd", label="CBD", suburbs=["Docklands"]),
                    schemas.AreaOption(id="all", label="Whole city", suburbs=[]),
                ],
            )
        ],
        triggers=[
            schemas.TriggerOption(
                id="lease_ending", label="Lease ending", group="main", default=True
            )
        ],
        since_days=schemas.SinceDaysOption(choices=[7, 30], default=30),
        modes=[
            schemas.ModeOption(
                mode="watchlist", title="Watchlist", needs_approval=True, approved=False
            )
        ],
        companies_limit=schemas.CompaniesLimit(min=1, max=25),
        caps=schemas.OptionCaps(
            run_cap_usd=Decimal("20.00"),
            max_companies=20,
            company_cap_usd=Decimal("2.50"),
            daily_left_usd=Decimal("38.10"),
        ),
        defaults=LeadFinderRunParams(),
    )
    dumped = options.model_dump(mode="json")
    assert dumped["caps"]["daily_left_usd"] == "38.10"
    assert dumped["defaults"]["cities"] == ["Melbourne", "Adelaide", "Perth"]
    assert dumped["cities"][0]["areas"][0]["id"] == "cbd"
    assert RunOptions.model_validate(dumped) == options


def lead_row_data(**changes: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": LEAD_ID,
        "company": "Acme Software",
        "city": "Melbourne",
        "suburb": "Docklands",
        "result": "pass",
        "stage": "Active prospect",
        "score": 82,
        "score_checked": 91,
        "band": "investigate",
        "status": "new",
        "hubspot_status": "new",
        "trigger_id": "lease_ending",
        "trigger_ids": ["lease_ending"],
        "trigger_label": "Lease ending in 1 to 3 years",
        "trigger_date": date(2027, 6, 1),
        "office_m2": 2500,
        "office_m2_estimated": False,
        "staff_in_city": 250,
        "industry": "Software",
        "industry_group": None,
        "contact_role": "Head of Property",
        "reason": "City: Melbourne. Result: Pass.",
        "run_id": RUN_ID,
        "origin": "web",
        "is_test": False,
        "useful": None,
        "note": None,
        "cost_usd": Decimal("1.05"),
        "web_searches": 6,
        "created_at": NOW,
        "updated_at": NOW,
    }
    return data | changes


def test_a_lead_row_has_exactly_the_fields_in_the_design() -> None:
    assert set(LeadRow.model_fields) == {
        "id",
        "company",
        "city",
        "suburb",
        "result",
        "stage",
        "score",
        "score_checked",
        "band",
        "status",
        "hubspot_status",
        "trigger_id",
        "trigger_ids",
        "trigger_label",
        "trigger_date",
        "office_m2",
        "office_m2_estimated",
        "staff_in_city",
        "industry",
        "industry_group",
        "contact_role",
        "reason",
        "form_failed",
        "run_id",
        "origin",
        "is_test",
        "useful",
        "note",
        "cost_usd",
        "web_searches",
        "created_at",
        "updated_at",
    }


def test_a_lead_row_round_trips_with_money_as_text() -> None:
    row = LeadRow.model_validate(lead_row_data())
    dumped = row.model_dump(mode="json")
    assert dumped["cost_usd"] == "1.05"
    assert dumped["trigger_date"] == "2027-06-01"
    assert LeadRow.model_validate(dumped) == row


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("result", "great"),
        ("status", "done"),
        ("hubspot_status", "maybe"),
        ("origin", "scraped"),
    ],
)
def test_a_lead_row_refuses_words_outside_its_lists(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        LeadRow.model_validate(lead_row_data(**{field: value}))


def test_a_similar_answer_can_say_there_is_no_profile() -> None:
    answer = SimilarOut(basis="none", note="This lead has no profile yet.", deals=[], leads=[])
    assert answer.model_dump(mode="json")["basis"] == "none"
    with pytest.raises(ValidationError):
        SimilarOut.model_validate({"basis": "guess", "deals": [], "leads": []})
    both = SimilarOut(
        basis="profile",
        deals=[
            schemas.DealLookalike(
                hubspot_id="5",
                name="Beta Pty Ltd",
                similarity=0.93,
                city="Melbourne",
                industry="Software",
                deal_status="Verified",
                deal_names=["Beta 2,000 m2"],
            )
        ],
        leads=[
            schemas.LeadLookalike(
                lead_id=LEAD_ID, name="Gamma", result="watch", score=44, similarity=0.9
            )
        ],
    )
    assert both.note is None


def test_the_watchlist_answer_holds_items_counts_and_the_other_lists() -> None:
    item = WatchItem(
        hubspot_id="12",
        name="Patties Food Group",
        city="Melbourne",
        industry="Food Beverages",
        office_based="unlikely",
        linkedin_staff=180,
        estimated_staff=360,
        owner=None,
        last_dissolved=date(2026, 10, 7),
        note="Dissolved deal",
    )
    answer = WatchlistOut(
        total=47,
        items=[item],
        director=[],
        staff_unknown=[],
        counts=WatchCounts(
            companies=100,
            watch=47,
            likely=11,
            unlikely=36,
            director=15,
            open_deal=7,
            dropped_small=21,
            staff_unknown=1,
            no_office=10,
        ),
    )
    dumped = answer.model_dump(mode="json")
    assert dumped["items"][0]["last_dissolved"] == "2026-10-07"
    assert dumped["counts"]["director"] == 15
    with pytest.raises(ValidationError):
        WatchItem.model_validate({**item.model_dump(), "office_based": "maybe"})


def test_the_test_set_types_hold_a_report_per_company() -> None:
    summary = TestSummary(
        run_id=RUN_ID,
        created_at=NOW,
        status="done",
        companies=10,
        expected=8,
        matched=7,
        avg_cost_usd=Decimal("1.10"),
        total_cost_usd=Decimal("11.00"),
        rules_version="abc",
        prompt_versions="research 1, extract 2",
    )
    item = TestItem(
        name="Canva",
        city="Sydney",
        expected=["director_review", "watch", "drop"],
        result="director_review",
        score=55,
        unknown_facts=["office_m2"],
        cost_usd=Decimal("1.20"),
        ok=True,
        lead_id=LEAD_ID,
        note=None,
    )
    report = TestReport(summary=summary, items=[item])
    assert TestReport.model_validate(report.model_dump(mode="json")) == report
    assert TestPage(total=1, items=[summary]).model_dump(mode="json")["items"][0]["matched"] == 7
    failed = TestItem(
        name="Seek",
        city="Melbourne",
        expected=None,
        result=None,
        score=None,
        unknown_facts=[],
        cost_usd=Decimal("0.00"),
        ok=None,
        lead_id=None,
        note="The research failed",
    )
    assert failed.ok is None


def test_the_test_set_classes_are_not_collected_as_tests() -> None:
    for model in (TestSummary, TestPage, TestItem, TestReport):
        assert model.__test__ is False


def test_every_model_in_the_schemas_module_is_a_pydantic_model() -> None:
    for name, value in vars(schemas).items():
        if isinstance(value, type) and value.__module__ == schemas.__name__:
            assert issubclass(value, BaseModel), name
