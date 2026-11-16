"""HubSpot teams and the companies' last activity in our copy (PLAN-V18 T1-3):

- the client reads each owner's teams, and an odd entry never stops the read;
- the sync saves them, and replaces them in full each time;
- `teams_of` gives an owner's teams and the owners in them;
- a company's "Last activity date" is read, and a later read never moves it back;
- a call that lands in HubSpot moves it at once, before the next sync.

Every team, person and company here is made up.
"""

from datetime import UTC, datetime, timedelta

import httpx2
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.hubspot.activities import apply_activity, preview_activity
from core.hubspot.client import Owner, OwnerTeam
from core.hubspot.mapping import load_field_map
from core.hubspot.models import HubSpotCompany, HubSpotOwnerTeam
from core.hubspot.owners import TeamsOf, teams_of
from tests.core.test_hubspot_activities import AT, COMPANY, Waits, a_request, only
from tests.core.test_hubspot_activities import contour as contour_to_write
from tests.core.test_hubspot_client import answer, make
from tests.core.test_hubspot_sync import contour, sync

Factory = async_sessionmaker[AsyncSession]
db = pytest.mark.integration
SALES = OwnerTeam("214430", "Sample Sales", True)
BD = OwnerTeam("214431", "Sample BD", True)
LAST_WEEK = datetime(2026, 11, 9, 4, 30, tzinfo=UTC)


def iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


async def saved_teams(factory: Factory) -> list[tuple[str, str, str | None, bool]]:
    async with factory() as session:
        rows = await session.scalars(
            select(HubSpotOwnerTeam).order_by(HubSpotOwnerTeam.owner_id, HubSpotOwnerTeam.team_id)
        )
        return [(row.owner_id, row.team_id, row.team_name, row.is_primary) for row in rows]


# --- The client and the field map (fast) ----------------------------------------------------------


async def test_the_client_reads_each_owners_teams_and_an_odd_entry_never_stops_it() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return answer(
            200,
            {
                "results": [
                    {
                        "id": "1",
                        "firstName": "Pat",
                        "email": "pat@example.test",
                        "teams": [{"id": "214430", "name": " Sample  Sales ", "primary": True}],
                    },
                    {
                        "id": "2",
                        "teams": [
                            {"id": 214431, "name": "Sample BD"},  # a number for an id
                            {"name": "No id"},
                            "odd",
                            {"id": "214430", "name": None, "primary": "yes"},
                            {"id": "214431", "name": "Listed twice"},
                        ],
                    },
                    {"id": "3", "teams": None},
                    {"id": "4", "teams": "odd"},
                    {"id": "5"},
                ]
            },
        )

    owners = await make(handler).owners()
    assert [owner.teams for owner in owners] == [
        (OwnerTeam("214430", "Sample Sales", True),),
        (OwnerTeam("214431", "Sample BD", False), OwnerTeam("214430", None, False)),
        (),
        (),
        (),
    ]
    assert "example.test" not in repr(owners)


def test_the_field_map_reads_last_activity_from_hubspots_last_activity_date() -> None:
    fields = load_field_map()
    assert fields.companies["last_activity"] == "notes_last_updated"
    assert "notes_last_updated" in fields.company_properties()


# --- The sync and the reads (database) ------------------------------------------------------------


def with_teams() -> list[Owner]:
    """Pat (11) is in Sample Sales, and so is Jo (13). Lee (14) is in Sample BD."""
    return [
        Owner("11", "Pat Lee", False, (SALES,)),
        Owner("13", "Jo Sample", False, (OwnerTeam("214430", "Sample Sales", False),)),
        Owner("14", "Lee Sample", False, (BD,)),
    ]


@db
async def test_the_sync_saves_the_teams_and_replaces_them_in_full(session_factory: Factory) -> None:
    fake = contour()
    fake.owners_active = with_teams()
    assert (await sync(session_factory, fake)).status == "done"
    assert await saved_teams(session_factory) == [
        ("11", "214430", "Sample Sales", True),
        ("13", "214430", "Sample Sales", False),
        ("14", "214431", "Sample BD", True),
    ]
    # Jo moves to Sample BD, Lee leaves every team, and Sample Sales gets a new name.
    fake.owners_active = [
        Owner("11", "Pat Lee", False, (OwnerTeam("214430", "Sample Sales Team", True),)),
        Owner("13", "Jo Sample", False, (BD,)),
        Owner("14", "Lee Sample", False),
    ]
    assert (await sync(session_factory, fake, mode="changes")).status == "done"
    assert await saved_teams(session_factory) == [
        ("11", "214430", "Sample Sales Team", True),
        ("13", "214431", "Sample BD", True),
    ]
    # HubSpot with no teams at all: neither has our copy.
    fake.owners_active = [Owner("11", "Pat Lee", False)]
    assert (await sync(session_factory, fake, mode="changes")).status == "done"
    assert await saved_teams(session_factory) == []


@db
async def test_teams_of_gives_my_teams_and_the_owners_in_them(session_factory: Factory) -> None:
    async with session_factory() as session:
        before = await teams_of(session, "11")
    assert before == TeamsOf(any_team=False)
    fake = contour()
    fake.owners_active = [
        *with_teams(),
        Owner("15", "Kim Sample", False, (BD, OwnerTeam("214432", None, False))),  # two teams
    ]
    await sync(session_factory, fake)
    async with session_factory() as session:
        pat = await teams_of(session, "11")
        kim = await teams_of(session, "15")
        sam = await teams_of(session, "12")  # Sam left, and is in no team
        nobody = await teams_of(session, None)
    assert pat == TeamsOf(True, ("Sample Sales",), frozenset({"11", "13"}))
    assert kim == TeamsOf(True, ("HubSpot team 214432", "Sample BD"), frozenset({"14", "15"}))
    assert sam == TeamsOf(any_team=True) and nobody == TeamsOf(any_team=True)


@db
async def test_last_activity_is_read_and_a_later_read_never_moves_it_back(
    session_factory: Factory,
) -> None:
    fake = contour()
    fake.companies["101"].properties["notes_last_updated"] = iso(LAST_WEEK)
    # HubSpot may send milliseconds too.
    fake.companies["102"].properties["notes_last_updated"] = str(int(LAST_WEEK.timestamp() * 1000))
    await sync(session_factory, fake)
    async with session_factory() as session:
        rows = await session.scalars(select(HubSpotCompany))
        found = {row.hubspot_id: row.last_activity for row in rows}
    assert found == {"101": LAST_WEEK, "102": LAST_WEEK, "103": None}
    # HubSpot now says an older time for Acme: ours stays. Gamma gets its first one.
    fake.companies["101"].properties["notes_last_updated"] = iso(LAST_WEEK - timedelta(days=30))
    fake.companies["103"].properties["notes_last_updated"] = iso(LAST_WEEK)
    await sync(session_factory, fake, mode="full")
    async with session_factory() as session:
        rows = await session.scalars(select(HubSpotCompany))
        found = {row.hubspot_id: row.last_activity for row in rows}
    assert found == {"101": LAST_WEEK, "102": LAST_WEEK, "103": LAST_WEEK}


@db
async def test_a_call_that_lands_moves_the_companys_last_activity_at_once(
    session: AsyncSession,
) -> None:
    """So the Companies list puts the company first before the next sync. A call older than our
    copy's last activity never moves it back."""
    session.add(
        HubSpotCompany(
            hubspot_id=COMPANY,
            name="Sample Logistics Pty Ltd",
            source="api",
            last_activity=AT - timedelta(days=3),
        )
    )
    await session.commit()
    fake = contour_to_write()
    call = a_request().call
    assert call is not None
    out = await preview_activity(session, fake, only(call=call))
    assert (await apply_activity(session, fake, out.id, pause=Waits())).status == "done"
    company = await session.get(HubSpotCompany, COMPANY, populate_existing=True)
    assert company is not None and company.last_activity == AT

    older = only(call=call.model_copy(update={"at": AT - timedelta(days=10)}), subject="call:2")
    out = await preview_activity(session, fake, older)
    assert (await apply_activity(session, fake, out.id, pause=Waits())).status == "done"
    company = await session.get(HubSpotCompany, COMPANY, populate_existing=True)
    assert company is not None and company.last_activity == AT
