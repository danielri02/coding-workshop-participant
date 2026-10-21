"""Add demo users, facilities, and incidents without overwriting existing records.

From the repository root, after creating tables:
    python -m backend.scripts.seed_database

From backend/:
    python -m scripts.seed_database
    python scripts/seed_database.py

DATABASE_URL selects the database. Set SEED_PASSWORD (12–128 nonblank characters)
when creating demo accounts for the first time. Passwords are Argon2-hashed and
never printed. Reruns preserve existing passwords, roles, availability, and content.
Demo accounts: demo.admin@acme.inc, demo.engineer@acme.inc, demo.employee@acme.inc.
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
        for role, name in (
            ("admin", "Demo Admin"),
            ("engineer", "Demo Engineer"),
            ("employee", "Demo Employee"),
        ):
            email = f"demo.{role}@acme.inc"
            user = await session.scalar(select(User).where(User.email == email))
            new_user = user is None
            if new_user:
                if password is None:
                    raise ValueError("Set SEED_PASSWORD before creating demo accounts")
                try:
                    registration = UserCreate(name=name, email=email, password=password)
                except ValidationError:
                    raise ValueError(
                        "SEED_PASSWORD must be 12–128 characters and not only whitespace"
                    ) from None
                password_hash = await asyncio.to_thread(
                    hash_password, registration.password.get_secret_value()
                )
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
            if role == "engineer":
                profile = await session.get(EngineerProfile, user.id)
                if profile is None:
                    if not new_user:
                        raise ValueError(
                            "Existing demo.engineer@acme.inc has no engineer profile; refusing to grant a capability"
                        )
                    session.add(EngineerProfile(user_id=user.id))
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
        )
        now = datetime.now(timezone.utc)
        for index, (title, category, status, priority) in enumerate(scenarios):
            # Network samples share a location to exercise recurrence reporting.
            building, floor, seat = locations[
                3 if category == IncidentCategory.NETWORK else index
            ]
            created_at = now - timedelta(days=4) + timedelta(hours=index)
            assigned = status != IncidentStatus.OPEN
            resolved = status in {IncidentStatus.RESOLVED, IncidentStatus.CLOSED}
            incident, created = await get_or_create(
                session,
                Incident,
                {
                    "title": title,
                    "reporter_id": users["employee"].id,
                    "building_id": building.id,
                },
                {
                    "description": f"Sample facility incident: {title.removeprefix('Demo: ')}.",
                    "category": category,
                    "status": status,
                    "priority": priority,
                    "floor_id": floor.id,
                    "seat_id": seat.id,
                    "assignee_id": users["engineer"].id if assigned else None,
                    "blocked_reason": "Waiting for a replacement part"
                    if status == IncidentStatus.BLOCKED
                    else None,
                    "escalation_reason": "Service disruption needs admin attention"
                    if status == IncidentStatus.BLOCKED
                    else None,
                    "created_at": created_at,
                    "assigned_at": created_at + timedelta(minutes=10)
                    if assigned
                    else None,
                    "acknowledged_at": created_at + timedelta(minutes=20)
                    if assigned
                    else None,
                    "resolved_at": created_at + timedelta(hours=1)
                    if resolved
                    else None,
                },
            )
            counts["incidents"] += created
            # Only newly created incidents get an initial note. Do not recreate a
            # deleted/corrected note or post to an existing resolved/closed incident.
            if created:
                session.add(
                    Note(
                        incident_id=incident.id,
                        author_id=users["employee"].id,
                        body="Initial demo report received by facilities.",
                        created_at=created_at + timedelta(minutes=5),
                    )
                )
                counts["notes"] += 1
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
        parser.exit(
            1,
            f"Seeding failed ({type(exc).__name__}); create tables first and check PostgreSQL access.\n",
        )
    print("Inserted: " + ", ".join(f"{name}={count}" for name, count in counts.items()))


if __name__ == "__main__":
    main()
