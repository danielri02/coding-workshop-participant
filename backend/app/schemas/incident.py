"""Incident payloads separated by operation and intended capability."""

from typing import ClassVar, Self

from pydantic import model_validator

from ..models.enums import IncidentCategory, IncidentPriority, IncidentStatus
from .base import Body, PatchSchema, PositiveID, Reason, Schema, Title, UTCDateTime


class IncidentCreate(Schema):
    """Employee-submitted details; the service supplies reporter and initial state."""

    title: Title
    description: Body
    category: IncidentCategory
    building_id: PositiveID
    floor_id: PositiveID | None = None
    seat_id: PositiveID | None = None
    priority: IncidentPriority = IncidentPriority.MEDIUM
    escalation_reason: Reason | None = None

    @model_validator(mode="after")
    def validate_location(self) -> Self:
        """Require a floor for a seat; database constraints check actual ancestry."""

        if self.seat_id is not None and self.floor_id is None:
            raise ValueError("A seat requires its floor")
        return self


class IncidentAdminUpdate(PatchSchema):
    """Admin-only corrections; validate merged location IDs before persistence."""

    nullable_fields: ClassVar[frozenset[str]] = frozenset({"floor_id", "seat_id"})

    title: Title | None = None
    description: Body | None = None
    category: IncidentCategory | None = None
    building_id: PositiveID | None = None
    floor_id: PositiveID | None = None
    seat_id: PositiveID | None = None

    @model_validator(mode="after")
    def validate_location_patch(self) -> Self:
        """Reject a known contradiction without assuming omitted stored values."""

        if (
            "floor_id" in self.model_fields_set
            and self.floor_id is None
            and self.seat_id is not None
        ):
            raise ValueError("A seat requires its floor")
        return self


class IncidentPriorityUpdate(PatchSchema):
    """Reporter-on-active-incident or admin priority and escalation changes."""

    nullable_fields: ClassVar[frozenset[str]] = frozenset({"escalation_reason"})

    priority: IncidentPriority | None = None
    escalation_reason: Reason | None = None


class IncidentAssignment(Schema):
    """Admin-only assignment or unassignment; preserve the first assigned_at."""

    assignee_id: PositiveID | None


class IncidentStatusUpdate(Schema):
    """Transition request; services must check the current state and actor."""

    status: IncidentStatus
    blocked_reason: Reason | None = None

    @model_validator(mode="after")
    def validate_status_reason(self) -> Self:
        """Require blocked context, clear it otherwise, and disallow reopening."""

        if self.status == IncidentStatus.OPEN:
            raise ValueError("Incidents cannot transition back to Open")
        if self.status == IncidentStatus.BLOCKED and self.blocked_reason is None:
            raise ValueError("Blocked incidents require a blocked reason")
        if self.status != IncidentStatus.BLOCKED and self.blocked_reason is not None:
            raise ValueError("A blocked reason is only valid for Blocked status")
        return self


class IncidentRead(Schema):
    """Ticket state and UTC milestones; authorize access before serialization."""

    id: PositiveID
    title: Title
    description: Body
    category: IncidentCategory
    reporter_id: PositiveID
    assignee_id: PositiveID | None = None
    building_id: PositiveID
    floor_id: PositiveID | None = None
    seat_id: PositiveID | None = None
    status: IncidentStatus
    priority: IncidentPriority
    blocked_reason: Reason | None = None
    escalation_reason: Reason | None = None
    created_at: UTCDateTime
    acknowledged_at: UTCDateTime | None = None
    assigned_at: UTCDateTime | None = None
    resolved_at: UTCDateTime | None = None
