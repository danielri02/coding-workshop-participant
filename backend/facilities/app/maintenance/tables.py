"""Table initialization shared with explicit local reset commands."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from ..models import Base
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
