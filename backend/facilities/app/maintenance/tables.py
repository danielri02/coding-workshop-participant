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
    await upgrade_ticket_schema(connection)


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


async def upgrade_ticket_schema(connection: AsyncConnection) -> None:
    """Convert legacy one-reporter incidents once, preserving reports and notes."""

    columns = await connection.run_sync(
        lambda sync: {
            column["name"] for column in inspect(sync).get_columns("incidents")
        }
    )
    if "merged_into_id" not in columns:
        await connection.execute(
            text(
                "ALTER TABLE incidents ADD COLUMN merged_into_id INTEGER REFERENCES incidents(id) ON DELETE CASCADE, ADD COLUMN merged_at TIMESTAMP WITH TIME ZONE, ADD COLUMN merged_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX ix_incidents_merged_into_id ON incidents (merged_into_id)"
            )
        )
        await connection.execute(
            text(
                "ALTER TABLE incidents ADD CONSTRAINT ck_incidents_merge_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id), ADD CONSTRAINT ck_incidents_merge_metadata CHECK ((merged_into_id IS NULL AND merged_at IS NULL AND merged_by_id IS NULL) OR (merged_into_id IS NOT NULL AND merged_at IS NOT NULL AND status = 'Closed'))"
            )
        )
    if "reporter_id" in columns:
        # The old owner becomes a Ticket. Original IDs of incidents and notes,
        # timestamps, assignments and report text all stay intact.
        await connection.execute(
            text(
                "INSERT INTO tickets (incident_id, reporter_id, title, description, building_id, floor_id, seat_id, created_at) SELECT id, reporter_id, title, description, building_id, floor_id, seat_id, created_at FROM incidents i WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.incident_id = i.id)"
            )
        )
        await connection.execute(text("ALTER TABLE incidents DROP COLUMN reporter_id"))
