"""Wipe and recreate all application tables in the configured database.

From the repository root: python backend/scripts/create_tables.py
From backend/: python scripts/create_tables.py

This deletes application users, incidents, notes, facilities and refresh tokens.
Unrelated tables and PostgreSQL accounts are preserved. Run seed_database.py next.
DATABASE_URL / POSTGRES_* select the target via the shared root .env.
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Module and direct-file entry points must resolve the same application package.
if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.app.database.diagnostics import database_error_message
from backend.app.database.session import engine
from backend.app.models import Base
from backend.scripts import SETUP_LOCK_ID


async def initialize_database(
    database_engine: AsyncEngine, *, reset: bool = False
) -> None:
    """Create missing tables; reset drops only application tables and their data."""

    async with database_engine.begin() as connection:
        await connection.execute(select(func.pg_advisory_xact_lock(SETUP_LOCK_ID)))
        if reset:
            await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)


async def run(reset: bool) -> None:
    """Run maintenance and release pooled connections before the event loop closes."""

    try:
        await initialize_database(engine, reset=reset)
    finally:
        await engine.dispose()


def main() -> None:
    """Reset application data; invoking this script explicitly requests the wipe."""

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # Accept previous invocations while making a plain run perform the requested reset.
    parser.add_argument("--reset", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--yes", action="store_true", help=argparse.SUPPRESS)
    parser.parse_args()
    try:
        asyncio.run(run(reset=True))
    except SQLAlchemyError as exc:
        parser.exit(1, database_error_message(exc) + "\n")
    print("Application tables reset. Run seed_database.py to populate demo data.")


if __name__ == "__main__":
    main()
