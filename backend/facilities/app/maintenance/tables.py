"""Table initialization shared with explicit local reset commands."""

from sqlalchemy import func, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from ..models import Base, IncidentStatus
from . import SETUP_LOCK_ID


async def initialize_database(
    database_engine: AsyncEngine, *, reset: bool = False
) -> None:
    """Create missing tables; only an explicit local reset drops app tables."""

    async with database_engine.begin() as connection:
        await initialize_tables(connection, reset=reset)


async def initialize_tables(
    connection: AsyncConnection, *, reset: bool = False
) -> None:
    """Join an existing transaction when reset and seeding must commit together."""

    await connection.execute(select(func.pg_advisory_xact_lock(SETUP_LOCK_ID)))
    if reset:
        await connection.run_sync(Base.metadata.drop_all)
    await connection.run_sync(Base.metadata.create_all)
    await upgrade_status_constraint(connection)


async def upgrade_status_constraint(connection: AsyncConnection) -> None:
    """Expand the legacy CHECK constraint without changing records or milestones."""

    constraints = await connection.run_sync(
        lambda sync: inspect(sync).get_check_constraints("incidents")
    )
    current = next(
        (
            item
            for item in constraints
            if item["name"] == "ck_incidents_incident_status"
        ),
        None,
    )
    if current and "'Assigned'" in current["sqltext"]:
        return
    # Only trusted enum values enter this DDL. PostgreSQL rolls back both changes
    # together if validation fails; no interval is committed without a constraint.
    await connection.execute(
        text(
            "ALTER TABLE incidents DROP CONSTRAINT IF EXISTS ck_incidents_incident_status"
        )
    )
    values = ", ".join(f"'{state.value}'" for state in IncidentStatus)
    await connection.execute(
        text(
            f"ALTER TABLE incidents ADD CONSTRAINT ck_incidents_incident_status CHECK (status IN ({values}))"
        )
    )
