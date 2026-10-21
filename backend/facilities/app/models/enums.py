"""Fixed incident values shared by persistence and API schemas."""

from enum import StrEnum


class IncidentCategory(StrEnum):
    """Supported facility and workplace technology issue categories."""

    ELECTRICAL = "Electrical"
    HVAC = "HVAC"
    PLUMBING = "Plumbing"
    NETWORK = "Network"
    EQUIPMENT = "Equipment"
    OTHER = "Other"


class IncidentPriority(StrEnum):
    """Relative urgency of an incident."""

    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


class IncidentStatus(StrEnum):
    """Current workflow state; transition authorization belongs to services."""

    OPEN = "Open"
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    BLOCKED = "Blocked"
    RESOLVED = "Resolved"
    CLOSED = "Closed"
