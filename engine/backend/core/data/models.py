"""core.admin_edits: each edit in Admin's Data tab, and each Undo (PLAN-V26 choice 20)."""

import uuid
from datetime import datetime
from typing import Any, Final

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import CORE_SCHEMA, Base

EDIT_ACTIONS: Final = ("change", "delete", "undo")


class AdminEdit(Base):
    __tablename__ = "admin_edits"
    __table_args__ = (
        CheckConstraint(
            f"action IN ({', '.join(repr(action) for action in EDIT_ACTIONS)})", name="action"
        ),
        CheckConstraint("(action = 'undo') = (undoes IS NOT NULL)", name="undoes"),
        UniqueConstraint("undoes"),  # an edit is undone once
        Index("ix_admin_edits_created_at", text("created_at DESC")),
        {"schema": CORE_SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    admin_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.users.id", ondelete="SET NULL")
    )
    table_name: Mapped[str] = mapped_column(String(64))  # schema.table
    row_id: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(8))
    # The changed fields' old and new values. A delete keeps the whole row in `before`.
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    # A hash of the whole row just after a change: Undo is refused once the row differs from it.
    row_after: Mapped[str | None] = mapped_column(String(64))
    undoes: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey(f"{CORE_SCHEMA}.admin_edits.id")
    )
