"""Incident payloads separated by operation and intended capability."""

from typing import Annotated, ClassVar, Literal, Self

from pydantic import Field, model_validator

from ..models.enums import IncidentCategory, IncidentPriority, IncidentStatus
from .base import (
    Body,
    Name,
    PatchSchema,
    PositiveID,
    Reason,
    Schema,
    Title,
    UTCDateTime,
)
from .grid import Page, PaginationQuery


class IncidentCreate(Schema):
    """Employee-submitted details; the service supplies reporter and initial state."""

    title: Title
    description: Body
    category: IncidentCategory
    building_id: PositiveID
    floor_id: PositiveID | None = None
    seat_id: PositiveID | None = None
    priority: IncidentPriority = IncidentPriority.LOW
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
    """Admin-only priority and escalation changes."""

    nullable_fields: ClassVar[frozenset[str]] = frozenset({"escalation_reason"})

    priority: IncidentPriority | None = None
    escalation_reason: Reason | None = None


class IncidentAssignment(Schema):
    """Admin assignment sets Assigned; the engineer accepts to start In Progress."""

    assignee_id: PositiveID | None


class IncidentStatusUpdate(Schema):
    """Transition request; services must check the current state and actor."""

    status: IncidentStatus
    blocked_reason: Reason | None = None

    @model_validator(mode="after")
    def validate_status_reason(self) -> Self:
        """Require blocked context; services authorize the requested transition."""

        if self.status == IncidentStatus.BLOCKED and self.blocked_reason is None:
            raise ValueError("Blocked incidents require a blocked reason")
        if self.status != IncidentStatus.BLOCKED and self.blocked_reason is not None:
            raise ValueError("A blocked reason is only valid for Blocked status")
        return self


class IncidentRead(Schema):
    """Ticket state and UTC milestones; authorize access before serialization."""

    id: PositiveID
    ticket_count: Annotated[int, Field(ge=0)]
    merged_into_id: PositiveID | None = None
    merged_at: UTCDateTime | None = None
    merged_by_id: PositiveID | None = None
    title: Title
    description: Body
    category: IncidentCategory
    assignee_id: PositiveID | None = None
    assignee_name: Name | None = None
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


FilterID = Annotated[int, Field(gt=0, le=2_147_483_647)]


class IncidentFilters(Schema):
    """Validated query parameters shared by full-list and Data Grid requests."""

    reporter_id: FilterID | None = None
    assignee_id: FilterID | None = None
    building_id: FilterID | None = None
    floor_id: FilterID | None = None
    seat_id: FilterID | None = None
    status: IncidentStatus | None = None
    priority: IncidentPriority | None = None
    category: IncidentCategory | None = None
    search: Annotated[str, Field(max_length=200)] | None = None
    include_merged: bool = False
    merged: bool | None = None
    merge_target: bool = False
    escalated: bool | None = None
    unassigned: bool | None = None


class IncidentGridQuery(IncidentFilters, PaginationQuery):
    """Zero-based paging and a single validated sort, matching MUI Data Grid."""

    sort_by: Literal[
        "id",
        "title",
        "category",
        "status",
        "priority",
        "assignee_name",
        "building_id",
        "floor_id",
        "seat_id",
        "assignee_id",
        "created_at",
        "assigned_at",
        "acknowledged_at",
        "resolved_at",
    ] = "created_at"
    sort_direction: Literal["asc", "desc"] = "desc"


class IncidentPage(Page[IncidentRead]):
    """Filtered rows and their total count for server-side grid pagination."""


class IncidentMerge(Schema):
    """Admin-only consolidation into an existing, non-closed incident."""

    target_incident_id: PositiveID
