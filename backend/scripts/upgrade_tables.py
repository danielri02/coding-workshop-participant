"""Upgrade existing application tables while preserving data.

Stop the app, then run: python backend/scripts/upgrade_tables.py
Each legacy incident becomes one incident plus one employee ticket. Existing
notes, incident IDs and milestones are preserved. The operation is transactional
and repeatable. This uses the application's shared database configuration.
Use create_tables.py only when you explicitly want to wipe and reseed instead.
"""

import argparse
import asyncio
import sys
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy.exc import SQLAlchemyError

from backend.app.database.diagnostics import database_error_message
from backend.app.database.session import engine
from backend.app.maintenance.tables import initialize_database


async def run() -> None:
    try:
        await initialize_database(engine, reset=False)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    ).parse_args()
    try:
        asyncio.run(run())
    except SQLAlchemyError as exc:
        raise SystemExit(database_error_message(exc)) from None
    print("Application tables upgraded; existing reports are now tickets.")
