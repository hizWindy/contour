"""The settings table: one row for each setting a person has changed from its default."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base


class Setting(Base):
    __tablename__ = "settings"
    __table_args__ = ({"schema": CORE_SCHEMA},)
    # After an UPDATE, fetch `updated_at` in the same statement. Without this the value is
    # left unloaded, and reading it later in async code fails (MissingGreenlet).
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012  (SQLAlchemy reads it)

    key: Mapped[str] = mapped_column(String(64), primary_key=True)  # like "run_cap_usd"
    value: Mapped[Any] = mapped_column(JSONB)  # a number, text, true/false or null. Money is text.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), onupdate=func.now()
    )
