"""Incident workflow policy, independent of transport and persistence."""

from ..models.enums import IncidentStatus

ENGINEER_TRANSITIONS: dict[IncidentStatus, tuple[IncidentStatus, ...]] = {
    IncidentStatus.OPEN: (),
    IncidentStatus.IN_PROGRESS: (IncidentStatus.BLOCKED, IncidentStatus.RESOLVED),
    IncidentStatus.BLOCKED: (IncidentStatus.IN_PROGRESS,),
    IncidentStatus.RESOLVED: (IncidentStatus.IN_PROGRESS,),
    IncidentStatus.CLOSED: (),
}
ADMIN_TRANSITIONS = {
    current: tuple(following for following in IncidentStatus if following != current)
    for current in IncidentStatus
}
ACTIVE_STATUSES = frozenset(
    {IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.BLOCKED}
)
NOTE_STATUSES = frozenset(
    state for state in IncidentStatus if state != IncidentStatus.CLOSED
)
