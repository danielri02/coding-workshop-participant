"""Shared incident conversation entries."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .incident import Incident
    from .user import User


class Note(Base):
    """A note visible to anyone authorized to view its parent incident."""

    __tablename__ = "notes"
    __table_args__ = (
        CheckConstraint(
            "length(trim(body)) > 0 AND length(body) <= 10000",
            name="body_length",
        ),
        Index("ix_notes_incident_created", "incident_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE")
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    incident: Mapped["Incident"] = relationship(back_populates="notes")
    author: Mapped["User"] = relationship(back_populates="notes")

    @property
    def author_name(self) -> str:
        """Expose the author's name as part of the incident's shared conversation."""

        return self.author.name
