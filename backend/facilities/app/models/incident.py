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
    select,
    text,
)
from sqlalchemy.orm import Mapped, column_property, foreign, mapped_column, relationship

from .base import Base
from .enums import IncidentCategory, IncidentPriority, IncidentStatus
from .facility import Building, Floor, Seat
from .ticket import Ticket
from .user import User

if TYPE_CHECKING:
    from .note import Note
    from .user import EngineerProfile


def enum_values(
    enum_class: type[IncidentCategory | IncidentPriority | IncidentStatus],
) -> list[str]:
    """Persist public enum values rather than Python member names."""

    return [member.value for member in enum_class]


class Incident(Base):
    """A shared problem; tickets identify the employees following its progress."""

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
        CheckConstraint(
            "merged_into_id IS NULL OR merged_into_id <> id", name="merge_not_self"
        ),
        CheckConstraint(
            "(merged_into_id IS NULL AND merged_at IS NULL AND merged_by_id IS NULL) OR (merged_into_id IS NOT NULL AND merged_at IS NOT NULL AND status = 'Closed')",
            name="merge_metadata",
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
        default=IncidentPriority.LOW,
        server_default=text("'Low'"),
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

    merged_into_id: Mapped[int | None] = mapped_column(
        ForeignKey("incidents.id", ondelete="CASCADE"), index=True
    )
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    merged_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    tickets: Mapped[list[Ticket]] = relationship(
        back_populates="incident", passive_deletes="all"
    )
    assignee: Mapped["EngineerProfile | None"] = relationship(
        back_populates="assignments"
    )

    # Count followers in SQL without loading their private report bodies.
    ticket_count: Mapped[int] = column_property(
        select(func.count(Ticket.id))
        .where(Ticket.incident_id == id)
        .correlate_except(Ticket)
        .scalar_subquery()
    )

    assignee_name: Mapped[str | None] = column_property(
        select(User.name)
        .where(User.id == assignee_id)
        .correlate_except(User)
        .scalar_subquery()
    )

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
