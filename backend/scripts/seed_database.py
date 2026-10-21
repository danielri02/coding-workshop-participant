"""Add demo data without overwriting existing records.

Run from the repository root: python backend/scripts/seed_database.py
Or from backend/: python scripts/seed_database.py

Local logins: admin@acme.inc / admin, employee@acme.inc / employee,
engineer@acme.inc / engineer. Cloud seeding requires explicit role passwords.
Existing passwords, roles and content are preserved. Cloud deployment uses the
same seed operation inside the key-protected reset API. The cloud database
command replaces application data; this standalone script remains additive.
"""

import argparse
import asyncio
import sys
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy.exc import SQLAlchemyError

from backend.app.database.diagnostics import database_error_message
from backend.app.database.session import engine, session_factory
from backend.app.maintenance.seed import (
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_EMPLOYEE_EMAIL,
    DEFAULT_EMPLOYEE_PASSWORD,
    DEFAULT_ENGINEER_EMAIL,
    DEFAULT_ENGINEER_PASSWORD,
    seed_database,
    seed_passwords,
)

__all__ = [
    "DEFAULT_ADMIN_EMAIL",
    "DEFAULT_ADMIN_PASSWORD",
    "DEFAULT_EMPLOYEE_EMAIL",
    "DEFAULT_EMPLOYEE_PASSWORD",
    "DEFAULT_ENGINEER_EMAIL",
    "DEFAULT_ENGINEER_PASSWORD",
    "seed_database",
    "seed_passwords",
]


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
