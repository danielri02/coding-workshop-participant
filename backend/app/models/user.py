"""Employee accounts and optional Engineer capability."""

from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Identity,
    String,
    false,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .incident import Incident
    from .note import Note


class User(Base):
    """An employee whose Admin capability is independent of Engineer status."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        CheckConstraint(
            "email = lower(trim(email)) AND email LIKE '%@acme.inc'",
            name="normalized_company_email",
        ),
        CheckConstraint(
            "length(trim(password_hash)) > 0", name="password_hash_not_blank"
        ),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    is_admin: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )

    engineer_profile: Mapped["EngineerProfile | None"] = relationship(
        back_populates="user",
        passive_deletes="all",
    )
    reported_incidents: Mapped[list["Incident"]] = relationship(
        back_populates="reporter",
        passive_deletes="all",
    )
    notes: Mapped[list["Note"]] = relationship(
        back_populates="author",
        passive_deletes="all",
    )


class EngineerProfile(Base):
    """Presence grants Engineer capability; availability is manually managed."""

    __tablename__ = "engineer_profiles"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    is_available: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )

    user: Mapped[User] = relationship(back_populates="engineer_profile")
    assignments: Mapped[list["Incident"]] = relationship(
        back_populates="assignee",
        passive_deletes="all",
    )
