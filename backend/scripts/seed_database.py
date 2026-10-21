"""Add demo users, facilities, and incidents without overwriting existing records.

From the repository root, after creating tables:
    python -m backend.scripts.seed_database

From backend/:
    python -m scripts.seed_database
    python scripts/seed_database.py

DATABASE_URL selects the database. Development logins are admin@acme.inc / admin
and employee@acme.inc / employee. SEED_PASSWORD (12–128 nonblank characters) is
required for new demo.engineer@acme.inc, demo.engineer2@acme.inc and
demo.employee@acme.inc accounts. Passwords are Argon2-hashed. Reruns preserve
existing passwords, roles, availability and content; new samples are additive.
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TypeVar

# Resolve from this file, rather than depending on the caller's working directory.
if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pydantic import SecretStr, ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.diagnostics import database_error_message
from backend.app.database.session import engine, session_factory
from backend.app.models import (
    Base,
    Building,
    EngineerProfile,
    Floor,
    Incident,
    IncidentCategory,
    IncidentPriority,
    IncidentStatus,
    Note,
    Seat,
    User,
)
from backend.app.schemas import UserCreate
from backend.app.security.passwords import hash_password
from backend.scripts import SETUP_LOCK_ID

Model = TypeVar("Model", bound=Base)
DEFAULT_ADMIN_EMAIL = "admin@acme.inc"
DEFAULT_EMPLOYEE_EMAIL = "employee@acme.inc"
# The user requested this default for the development seed account.
DEFAULT_ADMIN_PASSWORD = "admin"  # nosec B105
DEFAULT_EMPLOYEE_PASSWORD = "employee"  # nosec B105


async def get_or_create(
    session: AsyncSession,
    model: type[Model],
    lookup: dict[str, object],
    defaults: dict[str, object] | None = None,
) -> tuple[Model, bool]:
    """Find one natural-key match or insert it, leaving existing records unchanged."""

    result = await session.execute(select(model).filter_by(**lookup))
    instance = result.scalar_one_or_none()
    if instance is not None:
        return instance, False
    instance = model(**{**(defaults or {}), **lookup})
    session.add(instance)
    await session.flush()
    return instance, True


async def seed_database(
    session: AsyncSession, password: SecretStr | None = None
) -> dict[str, int]:
    """Seed one atomic transaction and return inserted counts for application tables.

    Natural keys make unchanged reruns idempotent. The transaction-level lock
    prevents concurrent maintenance scripts from inserting duplicate demo data.
    Existing accounts are not promoted or given new passwords. If a pre-existing
    demo engineer account lacks a profile, reject it rather than grant capability.
    """

    counts = {name: 0 for name in Base.metadata.tables}
    users: dict[str, User] = {}
    async with session.begin():
        await session.execute(select(func.pg_advisory_xact_lock(SETUP_LOCK_ID)))
        for role, name, email in (
            ("admin", "Demo Admin", DEFAULT_ADMIN_EMAIL),
            ("employee", "Demo Employee", DEFAULT_EMPLOYEE_EMAIL),
            ("engineer", "Demo Engineer", "demo.engineer@acme.inc"),
            ("engineer2", "Sam Patel", "demo.engineer2@acme.inc"),
            ("colleague", "Taylor Morgan", "demo.employee@acme.inc"),
        ):
            user = await session.scalar(select(User).where(User.email == email))
            new_user = user is None
            if new_user:
                if role in {"admin", "employee"}:
                    account_password = (
                        DEFAULT_ADMIN_PASSWORD
                        if role == "admin"
                        else DEFAULT_EMPLOYEE_PASSWORD
                    )
                else:
                    if password is None:
                        raise ValueError(
                            "Set SEED_PASSWORD before creating demo accounts"
                        )
                    try:
                        registration = UserCreate(
                            name=name, email=email, password=password
                        )
                    except ValidationError:
                        raise ValueError(
                            "SEED_PASSWORD must be 12–128 characters and not only whitespace"
                        ) from None
                    account_password = registration.password.get_secret_value()
                password_hash = await asyncio.to_thread(hash_password, account_password)
                user, _ = await get_or_create(
                    session,
                    User,
                    {"email": email},
                    {
                        "name": name,
                        "password_hash": password_hash,
                        "is_admin": role == "admin",
                    },
                )
                counts["users"] += 1
            users[role] = user
            if role == "admin" and not user.is_admin:
                raise ValueError(
                    "Existing admin@acme.inc is not an admin; refusing to grant a capability"
                )
            if role in {"engineer", "engineer2"}:
                profile = await session.get(EngineerProfile, user.id)
                if profile is None:
                    if not new_user:
                        raise ValueError(
                            f"Existing {email} has no engineer profile; refusing to grant a capability"
                        )
                    session.add(
                        EngineerProfile(
                            user_id=user.id, is_available=role == "engineer"
                        )
                    )
                    await session.flush()
                    counts["engineer_profiles"] += 1

        locations: list[tuple[Building, Floor, Seat]] = []
        for building_name in ("Demo Headquarters", "Demo Annex"):
            building, created = await get_or_create(
                session, Building, {"name": building_name}
            )
            counts["buildings"] += created
            for floor_label in ("1", "2"):
                floor, created = await get_or_create(
                    session, Floor, {"building_id": building.id, "label": floor_label}
                )
                counts["floors"] += created
                for seat_label in ("A1", "A2"):
                    seat, created = await get_or_create(
                        session, Seat, {"floor_id": floor.id, "label": seat_label}
                    )
                    counts["seats"] += created
                    locations.append((building, floor, seat))

        scenarios = (
            (
                "Demo: flickering lobby light",
                IncidentCategory.ELECTRICAL,
                IncidentStatus.OPEN,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: meeting room too warm",
                IncidentCategory.HVAC,
                IncidentStatus.IN_PROGRESS,
                IncidentPriority.HIGH,
            ),
            (
                "Demo: leaking kitchen tap",
                IncidentCategory.PLUMBING,
                IncidentStatus.BLOCKED,
                IncidentPriority.HIGH,
            ),
            (
                "Demo: intermittent network connection",
                IncidentCategory.NETWORK,
                IncidentStatus.RESOLVED,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: broken monitor",
                IncidentCategory.EQUIPMENT,
                IncidentStatus.CLOSED,
                IncidentPriority.LOW,
            ),
            (
                "Demo: damaged notice board",
                IncidentCategory.OTHER,
                IncidentStatus.OPEN,
                IncidentPriority.LOW,
            ),
            (
                "Demo: recurring network connection issue",
                IncidentCategory.NETWORK,
                IncidentStatus.OPEN,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: recurring meeting room cooling problem",
                IncidentCategory.HVAC,
                IncidentStatus.IN_PROGRESS,
                IncidentPriority.HIGH,
            ),
            (
                "Demo: desk power socket loose",
                IncidentCategory.ELECTRICAL,
                IncidentStatus.OPEN,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: printer awaiting a replacement tray",
                IncidentCategory.EQUIPMENT,
                IncidentStatus.BLOCKED,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: washroom drain repaired",
                IncidentCategory.PLUMBING,
                IncidentStatus.RESOLVED,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: reception signage replaced",
                IncidentCategory.OTHER,
                IncidentStatus.CLOSED,
                IncidentPriority.LOW,
            ),
            (
                "Demo: conference room Wi-Fi drops",
                IncidentCategory.NETWORK,
                IncidentStatus.IN_PROGRESS,
                IncidentPriority.HIGH,
            ),
            (
                "Demo: lobby lighting repaired again",
                IncidentCategory.ELECTRICAL,
                IncidentStatus.RESOLVED,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: meeting room ventilation noisy",
                IncidentCategory.HVAC,
                IncidentStatus.OPEN,
                IncidentPriority.LOW,
            ),
            (
                "Demo: docking station stops charging",
                IncidentCategory.EQUIPMENT,
                IncidentStatus.OPEN,
                IncidentPriority.MEDIUM,
            ),
            (
                "Demo: kitchen water filter awaiting delivery",
                IncidentCategory.PLUMBING,
                IncidentStatus.BLOCKED,
                IncidentPriority.LOW,
            ),
            (
                "Demo: cupboard door needs adjustment",
                IncidentCategory.OTHER,
                IncidentStatus.IN_PROGRESS,
                IncidentPriority.LOW,
            ),
        )
        now = datetime.now(timezone.utc)
        for index, (title, category, status, priority) in enumerate(scenarios):
            # Repeated category/location groups make recurrence reports useful.
            location_index = {
                IncidentCategory.NETWORK: 3,
                IncidentCategory.HVAC: 1,
                IncidentCategory.ELECTRICAL: 0,
            }.get(category, index % len(locations))
            building, floor, seat = locations[location_index]
            reporter = users[
                "colleague" if index >= 7 and index % 3 == 0 else "employee"
            ]
            engineer = users["engineer2" if index % 2 == 0 else "engineer"]
            created_at = now - timedelta(days=8) + timedelta(hours=index * 6)
            assigned = status != IncidentStatus.OPEN or (index >= 7 and index % 2 == 0)
            acknowledged = status != IncidentStatus.OPEN
            resolved = status in {IncidentStatus.RESOLVED, IncidentStatus.CLOSED}
            assigned_at = (
                created_at + timedelta(minutes=10 + index * 3) if assigned else None
            )
            acknowledged_at = (
                created_at + timedelta(minutes=30 + index * 7) if acknowledged else None
            )
            resolved_at = created_at + timedelta(hours=4 + index) if resolved else None
            incident, created = await get_or_create(
                session,
                Incident,
                {
                    "title": title,
                    "reporter_id": reporter.id,
                    "building_id": building.id,
                },
                {
                    "description": f"Sample facility incident: {title.removeprefix('Demo: ')}.",
                    "category": category,
                    "status": status,
                    "priority": priority,
                    "floor_id": floor.id,
                    "seat_id": seat.id,
                    "assignee_id": engineer.id if assigned else None,
                    "blocked_reason": "Waiting for a replacement part"
                    if status == IncidentStatus.BLOCKED
                    else None,
                    "escalation_reason": "Service disruption needs admin attention"
                    if status == IncidentStatus.BLOCKED
                    else None,
                    "created_at": created_at,
                    "assigned_at": assigned_at,
                    "acknowledged_at": acknowledged_at,
                    "resolved_at": resolved_at,
                },
            )
            counts["incidents"] += created
            # Add conversations only for new samples; preserve edited/deleted notes.
            if created:
                updates = [
                    (
                        reporter,
                        "Please investigate this workplace issue.",
                        created_at + timedelta(minutes=2),
                    )
                ]
                if assigned:
                    updates.append(
                        (
                            engineer if acknowledged else users["admin"],
                            "Waiting for a replacement part; we will update you when it arrives."
                            if status == IncidentStatus.BLOCKED
                            else "I have started investigating and will keep you informed."
                            if acknowledged
                            else "An engineer has been assigned to your report.",
                            (acknowledged_at or assigned_at) + timedelta(minutes=5),
                        )
                    )
                if resolved:
                    updates.append(
                        (
                            engineer,
                            "The issue has been repaired and verified. Please let us know if anything is still wrong.",
                            resolved_at,
                        )
                    )
                if status == IncidentStatus.CLOSED:
                    updates.append(
                        (
                            reporter,
                            "Confirmed working again. Thank you for the update.",
                            resolved_at + timedelta(hours=3),
                        )
                    )
                for author, body, timestamp in updates:
                    session.add(
                        Note(
                            incident_id=incident.id,
                            author_id=author.id,
                            body=body,
                            created_at=timestamp,
                        )
                    )
                counts["notes"] += len(updates)
        await session.flush()
    return counts


async def run() -> dict[str, int]:
    """Read the seed password privately, seed data, and release connections."""

    raw_password = os.environ.get("SEED_PASSWORD")
    password = SecretStr(raw_password) if raw_password is not None else None
    try:
        async with session_factory() as session:
            return await seed_database(session, password)
    finally:
        await engine.dispose()


def main() -> None:
    """Run the additive seed command without printing sensitive inputs."""

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.parse_args()
    try:
        counts = asyncio.run(run())
    except ValueError as exc:
        parser.exit(1, f"{exc}\n")
    except SQLAlchemyError as exc:
        parser.exit(1, database_error_message(exc) + "\n")
    print("Inserted: " + ", ".join(f"{name}={count}" for name, count in counts.items()))


if __name__ == "__main__":
    main()
