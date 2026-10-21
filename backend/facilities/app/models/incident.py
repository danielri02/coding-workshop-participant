"""Incident state, milestone timestamps, and consistent location references."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    String,
    Text,
    and_,
    func,
    text,
)
from sqlalchemy.orm import Mapped, foreign, mapped_column, relationship

from .base import Base
from .enums import IncidentCategory, IncidentPriority, IncidentStatus
from .facility import Building, Floor, Seat

if TYPE_CHECKING:
    from .note import Note
    from .user import EngineerProfile, User


def enum_values(
    enum_class: type[IncidentCategory | IncidentPriority | IncidentStatus],
) -> list[str]:
    """Persist public enum values rather than Python member names."""

    return [member.value for member in enum_class]


class Incident(Base):
    """Current ticket state; services own permissions and workflow transitions."""

    __tablename__ = "incidents"
    __table_args__ = (
        ForeignKeyConstraint(
            ["floor_id", "building_id"],
            ["floors.id", "floors.building_id"],
            ondelete="RESTRICT",
            name="fk_incidents_floor_building",
        ),
        ForeignKeyConstraint(
            ["seat_id", "floor_id"],
            ["seats.id", "seats.floor_id"],
            ondelete="RESTRICT",
            name="fk_incidents_seat_floor",
        ),
        CheckConstraint(
            "seat_id IS NULL OR floor_id IS NOT NULL", name="seat_requires_floor"
        ),
        CheckConstraint("length(trim(title)) > 0", name="title_not_blank"),
        CheckConstraint(
            "length(trim(description)) > 0 AND length(description) <= 10000",
            name="description_length",
        ),
        CheckConstraint(
            "(status = 'Blocked' AND blocked_reason IS NOT NULL "
            "AND length(trim(blocked_reason)) > 0) "
            "OR (status <> 'Blocked' AND blocked_reason IS NULL)",
            name="blocked_reason_matches_status",
        ),
        CheckConstraint(
            "escalation_reason IS NULL OR length(trim(escalation_reason)) > 0",
            name="escalation_reason_not_blank",
        ),
        CheckConstraint(
            "assigned_at IS NULL OR assigned_at >= created_at",
            name="assignment_time_order",
        ),
        CheckConstraint(
            "acknowledged_at IS NULL OR acknowledged_at >= created_at",
            name="acknowledgement_time_order",
        ),
        CheckConstraint(
            "resolved_at IS NULL OR (resolved_at >= created_at "
            "AND (acknowledged_at IS NULL OR resolved_at >= acknowledged_at))",
            name="resolution_time_order",
        ),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[IncidentCategory] = mapped_column(
        Enum(
            IncidentCategory,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
            name="incident_category",
        ),
        index=True,
    )
    reporter_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("engineer_profiles.user_id", ondelete="RESTRICT"),
        index=True,
    )
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="RESTRICT"),
        index=True,
    )
    floor_id: Mapped[int | None] = mapped_column(index=True)
    seat_id: Mapped[int | None] = mapped_column(index=True)
    status: Mapped[IncidentStatus] = mapped_column(
        Enum(
            IncidentStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
            name="incident_status",
        ),
        default=IncidentStatus.OPEN,
        server_default=text("'Open'"),
        index=True,
    )
    priority: Mapped[IncidentPriority] = mapped_column(
        Enum(
            IncidentPriority,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
            name="incident_priority",
        ),
        default=IncidentPriority.MEDIUM,
        server_default=text("'Medium'"),
        index=True,
    )
    blocked_reason: Mapped[str | None] = mapped_column(String(2000))
    escalation_reason: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reporter: Mapped["User"] = relationship(back_populates="reported_incidents")
    assignee: Mapped["EngineerProfile | None"] = relationship(
        back_populates="assignments"
    )

    @property
    def reporter_name(self) -> str | None:
        """Expose the reporter's name within an authorized incident."""

        return self.reporter.name if self.reporter is not None else None

    @property
    def assignee_name(self) -> str | None:
        """Expose the assigned engineer's name within an authorized incident."""

        return self.assignee.user.name if self.assignee is not None else None

    building: Mapped[Building] = relationship(back_populates="incidents")
    # Read-only convenience relationships avoid competing writes to the shared
    # building_id/floor_id columns. Set location IDs explicitly as one operation.
    floor: Mapped[Floor | None] = relationship(
        primaryjoin=lambda: and_(
            foreign(Incident.floor_id) == Floor.id,
            Incident.building_id == Floor.building_id,
        ),
        viewonly=True,
    )
    seat: Mapped[Seat | None] = relationship(
        primaryjoin=lambda: and_(
            foreign(Incident.seat_id) == Seat.id,
            Incident.floor_id == Seat.floor_id,
        ),
        viewonly=True,
    )
    notes: Mapped[list["Note"]] = relationship(
        back_populates="incident",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
