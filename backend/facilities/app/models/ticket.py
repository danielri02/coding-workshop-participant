"""An employee's original report, attached to the incident being worked on."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .incident import Incident
    from .user import User


class Ticket(Base):
    """Preserve each report and its location when incidents are merged."""

    __tablename__ = "tickets"
    __table_args__ = (
        ForeignKeyConstraint(
            ["floor_id", "building_id"],
            ["floors.id", "floors.building_id"],
            ondelete="RESTRICT",
            name="fk_tickets_floor_building",
        ),
        ForeignKeyConstraint(
            ["seat_id", "floor_id"],
            ["seats.id", "seats.floor_id"],
            ondelete="RESTRICT",
            name="fk_tickets_seat_floor",
        ),
        CheckConstraint(
            "seat_id IS NULL OR floor_id IS NOT NULL", name="seat_requires_floor"
        ),
        CheckConstraint("length(trim(title)) > 0", name="title_not_blank"),
        CheckConstraint(
            "length(trim(description)) > 0 AND length(description) <= 10000",
            name="description_length",
        ),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    incident_id: Mapped[int] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), index=True
    )
    reporter_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="RESTRICT"), index=True
    )
    floor_id: Mapped[int | None] = mapped_column(index=True)
    seat_id: Mapped[int | None] = mapped_column(index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    incident: Mapped["Incident"] = relationship(back_populates="tickets")
    reporter: Mapped["User"] = relationship(back_populates="tickets")

    @property
    def reporter_name(self) -> str:
        return self.reporter.name
