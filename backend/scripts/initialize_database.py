"""Create missing application tables without deleting existing tables or records.

Run from the repository root: python backend/scripts/initialize_database.py
Uses the same DATABASE_URL / POSTGRES_* settings as the application.
This also applies the non-destructive Assigned status constraint upgrade.
"""

import argparse
import asyncio
import sys
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy.exc import SQLAlchemyError

from backend.app.database.diagnostics import database_error_message
from backend.scripts.create_tables import run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        asyncio.run(run(reset=False))
    except SQLAlchemyError as exc:
        parser.exit(1, database_error_message(exc) + "\n")
    print("Application tables initialized; existing data preserved.")


if __name__ == "__main__":
    main()
