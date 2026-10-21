"""Seed a varied development database without overwriting existing records.

From the repository root: python backend/scripts/seed_database.py
From backend/: python scripts/seed_database.py

Primary logins: admin@acme.inc / admin, employee@acme.inc / employee,
engineer@acme.inc / engineer. Additional sample staff use their role as password.
Local defaults need no password setting. Cloud seeding requires explicit
SEED_ADMIN_PASSWORD, SEED_EMPLOYEE_PASSWORD and SEED_ENGINEER_PASSWORD.
Existing passwords, roles and content are preserved.
Run create_tables.py first when a completely fresh demo database is wanted.
"""

import argparse
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TypeVar

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

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
    IncidentStatus,
    Note,
    Seat,
    User,
)
from backend.app.security.passwords import hash_password, validate_password
from backend.scripts import SETUP_LOCK_ID
from backend.scripts.sample_data import ACCOUNTS, BUILDINGS, FLOORS, SEATS, incidents

Model = TypeVar("Model", bound=Base)
DEFAULT_ADMIN_EMAIL = "admin@acme.inc"
DEFAULT_EMPLOYEE_EMAIL = "employee@acme.inc"
DEFAULT_ENGINEER_EMAIL = "engineer@acme.inc"
# Explicitly requested development credentials; public registration stays strict.
DEFAULT_ADMIN_PASSWORD = "admin"  # nosec B105
DEFAULT_EMPLOYEE_PASSWORD = "employee"  # nosec B105
DEFAULT_ENGINEER_PASSWORD = "engineer"  # nosec B105
PASSWORDS = {
    "admin": DEFAULT_ADMIN_PASSWORD,
    "employee": DEFAULT_EMPLOYEE_PASSWORD,
    "engineer": DEFAULT_ENGINEER_PASSWORD,
}


def seed_passwords() -> dict[str, str]:
    """Validate every cloud role credential before writing any demo records."""

    cloud = os.environ.get("IS_LOCAL", "true").lower() == "false"
    passwords = {}
    for role, default in PASSWORDS.items():
        name = f"SEED_{role.upper()}_PASSWORD"
        value = os.environ.get(name, "" if cloud else default)
        if cloud or name in os.environ:
            try:
                validate_password(value)
                if value in PASSWORDS.values():
                    raise ValueError
            except ValueError:
                raise ValueError(
                    f"{name} must contain 12–128 nonblank characters and differ from the demo defaults"
                ) from None
        passwords[role] = value
    return passwords


async def get_or_create(
    session: AsyncSession,
    model: type[Model],
    lookup: dict[str, object],
    defaults: dict[str, object] | None = None,
) -> tuple[Model, bool]:
    """Insert by natural key, preserving previously edited records on reruns."""

    instance = await session.scalar(select(model).filter_by(**lookup))
    if instance is not None:
        return instance, False
    instance = model(**{**(defaults or {}), **lookup})
    session.add(instance)
    await session.flush()
    return instance, True


async def seed_database(session: AsyncSession) -> dict[str, int]:
    """Create one atomic, repeatable sample dataset under the setup advisory lock."""

    counts = {name: 0 for name in Base.metadata.tables}
    passwords = seed_passwords()
    users: dict[str, User] = {}
    async with session.begin():
        await session.execute(select(func.pg_advisory_xact_lock(SETUP_LOCK_ID)))
        for account in ACCOUNTS:
            user = await session.scalar(select(User).where(User.email == account.email))
            new_user = user is None
            if new_user:
                password_hash = await asyncio.to_thread(
                    hash_password, passwords[account.role]
                )
                user, _ = await get_or_create(
                    session,
                    User,
                    {"email": account.email},
                    {
                        "name": account.name,
                        "password_hash": password_hash,
                        "is_admin": account.role == "admin",
                    },
                )
                counts["users"] += 1
            users[account.key] = user
            if account.role == "admin" and not user.is_admin:
                raise ValueError(
                    "Existing admin@acme.inc is not an admin; refusing to grant a capability"
                )
            if (
                account.role == "engineer"
                and await session.get(EngineerProfile, user.id) is None
            ):
                if not new_user:
                    raise ValueError(
                        f"Existing {account.email} has no engineer profile; refusing to grant a capability"
                    )
                session.add(
                    EngineerProfile(user_id=user.id, is_available=account.available)
                )
                await session.flush()
                counts["engineer_profiles"] += 1

        locations: list[tuple[Building, Floor, Seat]] = []
        for name in BUILDINGS:
            building, created = await get_or_create(session, Building, {"name": name})
            counts["buildings"] += created
            for label in FLOORS:
                floor, created = await get_or_create(
                    session, Floor, {"building_id": building.id, "label": label}
                )
                counts["floors"] += created
                for seat_label in SEATS:
                    seat, created = await get_or_create(
                        session, Seat, {"floor_id": floor.id, "label": seat_label}
                    )
                    counts["seats"] += created
                    locations.append((building, floor, seat))

        for sample in incidents(datetime.now(timezone.utc)):
            reporter = users[sample.reporter]
            engineer = users[sample.engineer] if sample.engineer else None
            building, floor, seat = locations[sample.location]
            incident, created = await get_or_create(
                session,
                Incident,
                {
                    "title": sample.values["title"],
                    "reporter_id": reporter.id,
                    "building_id": building.id,
                },
                {
                    **sample.values,
                    "floor_id": floor.id,
                    "seat_id": seat.id,
                    "assignee_id": engineer.id if engineer else None,
                },
            )
            counts["incidents"] += created
            if not created:
                continue
            updates = [
                (
                    reporter,
                    "Please investigate this workplace issue.",
                    incident.created_at + timedelta(minutes=2),
                )
            ]
            if engineer:
                updates.append(
                    (
                        engineer if incident.acknowledged_at else users["admin"],
                        incident.blocked_reason
                        or "I have started investigating and will keep you informed."
                        if incident.acknowledged_at
                        else "An engineer has been assigned to your report.",
                        (incident.acknowledged_at or incident.assigned_at)
                        + timedelta(minutes=2),
                    )
                )
            if incident.resolved_at:
                updates.append(
                    (
                        engineer,
                        "The issue has been repaired and verified. Please let us know if anything is still wrong.",
                        incident.resolved_at,
                    )
                )
            if incident.status == IncidentStatus.CLOSED:
                updates.append(
                    (
                        reporter,
                        "Confirmed working again. Thank you for the update.",
                        incident.resolved_at + timedelta(hours=4),
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
    """Seed the configured target and always release its connection pool."""

    try:
        async with session_factory() as session:
            return await seed_database(session)
    finally:
        await engine.dispose()


def main() -> None:
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
