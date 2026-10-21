"""Create missing application tables, or explicitly reset all application tables.

From the repository root:
    python -m backend.scripts.create_tables
    python -m backend.scripts.create_tables --reset --yes

From backend/:
    python -m scripts.create_tables
    python scripts/create_tables.py

DATABASE_URL selects the database. Creation does not migrate existing tables.
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
    """Parse arguments and require explicit confirmation for destructive resets."""

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate application tables; deletes their data",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm data deletion when used with --reset",
    )
    args = parser.parse_args()
    if args.reset and not args.yes:
        parser.error("Reset deletes application data; supply --reset --yes to confirm")
    if args.yes and not args.reset:
        parser.error("--yes is only valid with --reset")
    try:
        asyncio.run(run(args.reset))
    except SQLAlchemyError as exc:
        parser.exit(
            1,
            f"Database operation failed ({type(exc).__name__}); check DATABASE_URL and PostgreSQL access.\n",
        )
    print(
        "Application tables reset."
        if args.reset
        else "Application tables created; existing data preserved."
    )


if __name__ == "__main__":
    main()
