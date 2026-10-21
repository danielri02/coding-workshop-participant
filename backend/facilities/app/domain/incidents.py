"""Incident workflow policy, independent of transport and persistence."""

from ..models.enums import IncidentStatus

TRANSITIONS: dict[IncidentStatus, tuple[IncidentStatus, ...]] = {
    IncidentStatus.OPEN: (IncidentStatus.IN_PROGRESS,),
    IncidentStatus.IN_PROGRESS: (IncidentStatus.BLOCKED, IncidentStatus.RESOLVED),
    IncidentStatus.BLOCKED: (IncidentStatus.IN_PROGRESS,),
    IncidentStatus.RESOLVED: (IncidentStatus.CLOSED,),
    IncidentStatus.CLOSED: (),
}
ACTIVE_STATUSES = frozenset(
    {IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.BLOCKED}
)
