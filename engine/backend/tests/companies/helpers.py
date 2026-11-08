"""Shared helpers for the Companies tests: a small HubSpot copy and signed-in browsers."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import httpx

from apps.companies.store import today
from core.auth import admin
from core.auth.models import User
from core.hubspot.models import HubSpotCompany, HubSpotDeal, HubSpotOffice
from tests.core.auth_world import FAST, GOOD, World, sign_in
from tests.lead_finder.factories import make_lead

API = "/api/v1/companies"
LEAD_FIELDS = ("lead_result", "lead_score")


async def person(world: World, login: str, *, apps: list[str], role: str = "staff") -> User:
    async with world.factory() as db:
        return await admin.create_person(
            db,
            email=f"{login}@example.test",
            username=login,
            name=login.title(),
            role=role,
            apps=apps,
            password=GOOD,
            now=world.clock.now,
            hasher=FAST,
        )


async def add(world: World, *rows: object) -> None:
    async with world.factory() as db:
        db.add_all(rows)
        await db.commit()


def company(hubspot_id: str, name: str, **more: Any) -> HubSpotCompany:
    return HubSpotCompany(hubspot_id=hubspot_id, name=name, source="api", **more)


def office(hubspot_id: str, label: str, **more: Any) -> HubSpotOffice:
    return HubSpotOffice(hubspot_company_id=hubspot_id, label=label, **more)


def deal(deal_id: str, hubspot_id: str, stage: str, **more: Any) -> HubSpotDeal:
    return HubSpotDeal(
        hubspot_deal_id=deal_id,
        hubspot_company_id=hubspot_id,
        name=f"Deal {deal_id}",
        stage=stage,
        **more,
    )


def soon(days: int) -> date:
    return today() + timedelta(days=days)


async def a_small_copy(world: World) -> None:
    """Four HubSpot companies and three leads:

    - ABC Logistics, Perth: an open deal, owner Levi, a lease ending in a year.
    - Quark Foods, Melbourne: a won deal (a customer), owner Sara.
    - Zed Mining, Adelaide office: no deal, no owner, 900 staff.
    - Nimbus Software, Sydney: lifecycle Customer, a lost deal.
    - Leads: Delta Freight (Pass, not in HubSpot), Echo Legal (Drop, not in HubSpot), and the
      Lead Finder's research of ABC Logistics (Director review, in HubSpot).
    """
    await add(
        world,
        company(
            "101",
            "ABC Logistics",
            domain="abclogistics.com.au",
            city="Perth",
            industry="Logistics and Supply Chain",
            employees=300,
            owner="Levi",
            last_contacted=date(2026, 10, 1),
            description="Moves freight across WA.",
            hubspot_url="https://app.hubspot.com/contacts/1/company/101",
        ),
        company(
            "102",
            "Quark Foods",
            domain="quark.com.au",
            city="Melbourne",
            industry="Food Production",
            employees=120,
            owner="Sara",
            last_contacted=date(2026, 6, 1),
        ),
        company(
            "103",
            "Zed Mining",
            domain="zed.com.au",
            city="Brisbane",
            industry="Mining and Metals",
            employees=900,
        ),
        company(
            "104",
            "Nimbus Software",
            domain="nimbus.io",
            city="Sydney",
            industry="Computer Software",
            employees=60,
            lifecycle_stage="Customer",
            last_contacted=date(2025, 1, 5),
        ),
    )
    await add(
        world,
        office("101", "Perth", city="Perth", lease_expiry=soon(365), office_m2=Decimal("1200")),
        office("101", "Old Perth", city="Perth", lease_expiry=today() - timedelta(days=30)),
        office("103", "Adelaide", city="Adelaide", lease_expiry=soon(900)),
        office("102", "Melbourne", city="Melbourne", lease_expiry=soon(60)),
        deal("d1", "101", "Qualified Deal", amount_aud=Decimal("1500000"), owner="Levi"),
        deal("d2", "102", "Ordered - Contract Signed"),
        deal("d3", "104", "Closed lost"),
    )
    await add(
        world,
        make_lead("Delta Freight", result="pass", score=82, city="Perth"),
        make_lead("Echo Legal", result="drop", score=20, city="Melbourne"),
        make_lead(
            "ABC Logistics",
            result="director_review",
            score=74,
            city="Perth",
            hubspot_status="open_deal",
            hubspot_id="101",
        ),
    )


@asynccontextmanager
async def signed_in_as(
    world: World, login: str, apps: list[str]
) -> AsyncIterator[httpx.AsyncClient]:
    await person(world, login, apps=apps)
    async with world.browser() as client:
        assert (await sign_in(client, login=login)).status_code == 200
        yield client


def names(page: dict[str, Any]) -> list[str]:
    return [row["name"] for row in page["items"]]
