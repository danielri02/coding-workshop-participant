"""Deterministic development samples with uneven workloads and recurring locations."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from backend.app.models import IncidentCategory as Category
from backend.app.models import IncidentPriority as Priority
from backend.app.models import IncidentStatus as Status


@dataclass(frozen=True)
class Account:
    key: str
    name: str
    role: Literal["admin", "employee", "engineer"]
    available: bool = True

    @property
    def email(self) -> str:
        return f"{self.key}@acme.inc"


ACCOUNTS = (
    Account("admin", "Demo Admin", "admin"),
    Account("employee", "Demo Employee", "employee"),
    Account("engineer", "Demo Engineer", "engineer"),
    Account("engineer2", "Avery Chen", "engineer"),
    Account("engineer3", "Sam Patel", "engineer", available=False),
    Account("engineer4", "Morgan Reed", "engineer"),
    Account("employee2", "Taylor Morgan", "employee"),
    Account("employee3", "Casey Jordan", "employee"),
)
BUILDINGS = ("Demo Headquarters", "Demo Annex", "Demo Operations")
FLOORS = ("1", "2", "3")
SEATS = ("A1", "A2", "A3", "B1", "B2", "B3")
INCIDENT_COUNT = 120
CATEGORIES = (
    (Category.HVAC,) * 5
    + (Category.NETWORK,) * 4
    + (Category.ELECTRICAL,) * 3
    + (Category.PLUMBING,) * 2
    + (Category.EQUIPMENT,) * 2
    + (Category.OTHER,)
)
STATUSES = (
    Status.CLOSED,
    Status.RESOLVED,
    Status.IN_PROGRESS,
    Status.OPEN,
    Status.BLOCKED,
    Status.CLOSED,
    Status.RESOLVED,
    Status.IN_PROGRESS,
    Status.OPEN,
    Status.CLOSED,
)
ISSUES = {
    Category.HVAC: (
        "meeting room too warm",
        "ventilation noisy",
        "air conditioning stops",
    ),
    Category.NETWORK: (
        "Wi-Fi disconnects",
        "video calls drop",
        "network socket unreliable",
    ),
    Category.ELECTRICAL: (
        "lobby light flickers",
        "desk power socket loose",
        "corridor light out",
    ),
    Category.PLUMBING: (
        "kitchen tap leaks",
        "washroom drain blocked",
        "water filter needs replacement",
    ),
    Category.EQUIPMENT: (
        "monitor not working",
        "printer paper tray damaged",
        "docking station fails",
    ),
    Category.OTHER: (
        "cupboard door loose",
        "notice board damaged",
        "reception signage needs repair",
    ),
}
BLOCKED_REASONS = (
    "Waiting for a replacement part",
    "Waiting for vendor access",
    "Maintenance window approval needed",
)


@dataclass(frozen=True)
class SampleIncident:
    reporter: str
    engineer: str | None
    location: int
    values: dict[str, object]


def incidents(now: datetime) -> Iterator[SampleIncident]:
    """Cover eight weeks, weighted categories and hotspots, plus a fresh unassigned queue."""

    anchor = now.replace(minute=0, second=0, microsecond=0)
    for index in range(INCIDENT_COUNT):
        category = CATEGORIES[(index * 7) % len(CATEGORIES)]
        status = Status.OPEN if index >= 108 else STATUSES[index % len(STATUSES)]
        assigned = index < 108 and (status != Status.OPEN or index % 3 != 0)
        acknowledged = status != Status.OPEN
        resolved = status in {Status.RESOLVED, Status.CLOSED}
        priority = (
            Priority.LOW
            if not assigned
            else (
                Priority.HIGH
                if index % 9 < 2
                else Priority.MEDIUM
                if index % 9 < 5
                else Priority.LOW
            )
        )
        created = anchor - timedelta(hours=(INCIDENT_COUNT - 1 - index) * 14)
        assigned_at = (
            created + timedelta(minutes=(5, 15, 30, 60, 120, 360)[index % 6])
            if assigned
            else None
        )
        acknowledged_at = (
            assigned_at + timedelta(minutes=(10, 30, 60, 180, 720)[index % 5])
            if acknowledged
            else None
        )
        resolved_at = (
            acknowledged_at + timedelta(hours=2 + (index * 7) % 72)
            if resolved
            else None
        )
        location = (index * 13) % (len(BUILDINGS) * len(FLOORS) * len(SEATS))
        if category == Category.HVAC and index % 4:
            location = 0
        elif category == Category.NETWORK and index % 3:
            location = 25
        elif category == Category.ELECTRICAL and index % 2:
            location = 39
        title = ISSUES[category][index % 3]
        yield SampleIncident(
            reporter="employee"
            if index % 5
            else ("employee2" if index % 2 else "employee3"),
            engineer=(
                "engineer",
                "engineer",
                "engineer",
                "engineer2",
                "engineer2",
                "engineer3",
            )[index % 6]
            if assigned
            else None,
            location=location,
            values={
                "title": f"Demo: {title} #{index + 1:03}",
                "description": f"The {title} issue is affecting this workspace. Please investigate and keep the reporter updated.",
                "category": category,
                "status": status,
                "priority": priority,
                "created_at": created,
                "assigned_at": assigned_at,
                "acknowledged_at": acknowledged_at,
                "resolved_at": resolved_at,
                "blocked_reason": BLOCKED_REASONS[index % len(BLOCKED_REASONS)]
                if status == Status.BLOCKED
                else None,
                "escalation_reason": "Admin triage: repeated disruption to office operations"
                if priority == Priority.HIGH and index % 3 == 0
                else None,
            },
        )
