"""A private employee report and the current state of its shared incident."""

from typing import Literal

from .base import Body, Name, PositiveID, Schema, Title, UTCDateTime
from .incident import (
    FilterID,
    IncidentCreate,
    IncidentGridQuery,
    IncidentRead,
    IncidentSortField,
)


class TicketCreate(IncidentCreate):
    """Create a report and its initial incident; ownership comes from login."""


class TicketRead(Schema):
    id: PositiveID
    incident_id: PositiveID
    reporter_id: PositiveID
    reporter_name: Name
    title: Title
    description: Body
    building_id: PositiveID
    floor_id: PositiveID | None = None
    seat_id: PositiveID | None = None
    created_at: UTCDateTime
    incident: IncidentRead


class TicketGridQuery(IncidentGridQuery):
    incident_id: FilterID | None = None
    sort_by: IncidentSortField | Literal["incident_id"] = "created_at"


class TicketReattach(Schema):
    """Admin-only correction of the problem followed by one original report."""

    target_incident_id: PositiveID
