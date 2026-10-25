"""The local copy of HubSpot data. Contacts are never stored here."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base


class HubSpotCompany(Base):
    __tablename__ = "hubspot_companies"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    hubspot_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    website: Mapped[str | None] = mapped_column(String(300))
    domain: Mapped[str | None] = mapped_column(String(255), index=True)
    phone: Mapped[str | None] = mapped_column(String(64))
    street: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(3))  # VIC, SA, WA, ...
    state_raw: Mapped[str | None] = mapped_column(String(64))  # as typed in HubSpot
    postal_code: Mapped[str | None] = mapped_column(String(16))
    country: Mapped[str | None] = mapped_column(String(80))
    industry: Mapped[str | None] = mapped_column(String(120))
    employees: Mapped[int | None] = mapped_column(Integer)
    linkedin_staff_au: Mapped[int | None] = mapped_column(Integer)
    offices_on_record: Mapped[str | None] = mapped_column(Text)
    lifecycle_stage: Mapped[str | None] = mapped_column(String(64))
    owner: Mapped[str | None] = mapped_column(String(120))
    created_in_hubspot: Mapped[date | None] = mapped_column(Date)
    last_contacted: Mapped[date | None] = mapped_column(Date)
    contacts_count: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    hubspot_url: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16))  # "export" now, "api" later
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class HubSpotOffice(Base):
    __tablename__ = "hubspot_offices"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    hubspot_company_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey(f"{CORE_SCHEMA}.hubspot_companies.hubspot_id", ondelete="CASCADE"),
        index=True,
    )
    label: Mapped[str] = mapped_column(String(64))  # the office's name in HubSpot, like "Perth"
    level: Mapped[str | None] = mapped_column(String(64))
    street: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(120))
    postal_code: Mapped[str | None] = mapped_column(String(16))
    phone: Mapped[str | None] = mapped_column(String(64))
    last_moved: Mapped[date | None] = mapped_column(Date)
    lease_expiry: Mapped[date | None] = mapped_column(Date)
    linkedin_staff: Mapped[int | None] = mapped_column(Integer)


class HubSpotDeal(Base):
    __tablename__ = "hubspot_deals"
    __table_args__ = ({"schema": CORE_SCHEMA},)

    hubspot_deal_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hubspot_company_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey(f"{CORE_SCHEMA}.hubspot_companies.hubspot_id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(300))
    stage: Mapped[str | None] = mapped_column(String(64))
    amount_aud: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    close_date: Mapped[date | None] = mapped_column(Date)
    owner: Mapped[str | None] = mapped_column(String(120))
    created_in_hubspot: Mapped[date | None] = mapped_column(Date)
    last_contacted: Mapped[date | None] = mapped_column(Date)
    next_step: Mapped[str | None] = mapped_column(Text)
    hubspot_url: Mapped[str | None] = mapped_column(Text)
