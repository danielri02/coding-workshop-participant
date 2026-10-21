"""Deterministic development samples with uneven workloads and recurring locations."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from ..models import IncidentCategory as Category
from ..models import IncidentPriority as Priority
from ..models import IncidentStatus as Status


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
    Account("admin2", "Jamie Brooks", "admin"),
    Account("engineer5", "Riley Singh", "engineer"),
    Account("engineer6", "Jordan Rivera", "engineer"),
    Account("engineer7", "Alex Kim", "engineer", available=False),
    Account("engineer8", "Cameron Lee", "engineer"),
    Account("employee4", "Dana Wilson", "employee"),
    Account("employee5", "Chris Nguyen", "employee"),
    Account("employee6", "Robin Garcia", "employee"),
)
BUILDINGS = (
    "Demo Headquarters",
    "Demo Annex",
    "Demo Operations",
    "Demo Research",
    "Demo Training",
    "Demo Warehouse",
)
FLOORS = ("1", "2", "3")
SEATS = ("A1", "A2", "A3", "B1", "B2", "B3")
INCIDENT_COUNT = 240
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
    Status.ASSIGNED,
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
    """Rolling samples spanning days to years, including completed work this week."""

    anchor = now.replace(minute=0, second=0, microsecond=0)
    for index in range(INCIDENT_COUNT):
        category = CATEGORIES[(index * 7) % len(CATEGORIES)]
        status = (
            Status.OPEN
            if index >= INCIDENT_COUNT - 6
            else STATUSES[index % len(STATUSES)]
        )
        assigned = status != Status.OPEN or (
            index < INCIDENT_COUNT - 6 and index % 3 != 0
        )
        if assigned and status == Status.OPEN:
            status = Status.ASSIGNED
        acknowledged = status not in {Status.OPEN, Status.ASSIGNED}
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
        if index < 24:
            age = timedelta(days=600 - index * 9)
        elif index < 72:
            age = timedelta(days=350 - (index - 24) * 6)
        elif index < 168:
            age = timedelta(hours=29 * 24 - (index - 72) * 5)
        else:
            age = timedelta(hours=6 + (INCIDENT_COUNT - 1 - index) * 2)
        created = anchor - age
        assigned_at = (
            created
            + min(timedelta(minutes=(5, 15, 30, 60, 120, 360)[index % 6]), age / 10)
            if assigned
            else None
        )
        acknowledged_at = (
            assigned_at + min(timedelta(minutes=10 + index % 90), age / 10)
            if acknowledged
            else None
        )
        resolved_at = (
            acknowledged_at + min(timedelta(hours=2 + (index * 7) % 72), age / 2)
            if resolved
            else None
        )
        # Preserve the first 120 samples' natural keys when adding to an older seed.
        location = (index * 13) % 54 + (54 if index >= 120 else 0)
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
            else (
                ("employee2" if index % 2 else "employee3")
                if index < 120
                else ("employee4", "employee5", "employee6")[(index // 5) % 3]
            ),
            engineer=(
                (
                    "engineer",
                    "engineer",
                    "engineer",
                    "engineer2",
                    "engineer2",
                    "engineer3",
                )[index % 6]
                if index < 120
                else (
                    "engineer",
                    "engineer5",
                    "engineer6",
                    "engineer7",
                    "engineer",
                    "engineer2",
                )[index % 6]
            )
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
