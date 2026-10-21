"""Check PostgreSQL connectivity without creating, changing, or deleting data.

From backend/: python scripts/check_database.py
From repo root: python -m backend.scripts.check_database

Shows which configuration source and connection target are in use. Passwords
and connection query values are never printed.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import create_async_engine

from backend.app.database.config import get_database_url
from backend.app.database.diagnostics import connection_summary, database_error_message
from backend.app.models import User
from backend.scripts.seed_database import DEFAULT_ADMIN_EMAIL


def connection_timeout(url: URL) -> int:
    """Honor libpq settings, allowing a paused Aurora instance time to resume."""

    default = "30" if os.environ.get("IS_LOCAL", "true").lower() == "false" else "5"
    value = url.query.get(
        "connect_timeout", os.environ.get("PGCONNECT_TIMEOUT", default)
    )
    try:
        timeout = int(value)
        if timeout < 1:
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError(
            "PGCONNECT_TIMEOUT/connect_timeout must be a positive integer"
        ) from None
    return timeout


async def check_connection(*, check_admin: bool = False) -> None:
    """Make one read-only request, with a bounded connection timeout."""

    url = get_database_url()
    engine = create_async_engine(
        url, connect_args={"connect_timeout": connection_timeout(url)}
    )
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            if check_admin:
                admin = await connection.scalar(
                    select(User.is_admin).where(User.email == DEFAULT_ADMIN_EMAIL)
                )
                if admin is None:
                    raise ValueError(
                        "Seed admin is missing from this database. Run the seed script against this target."
                    )
                if not admin:
                    raise ValueError(
                        "Seed admin exists but lacks Admin capability. Seeding preserves existing roles; investigate this account."
                    )
    finally:
        await engine.dispose()


def main() -> None:
    """Report the effective target and a safe connection result."""

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--check-admin",
        action="store_true",
        help="Also verify the development seed admin exists and has Admin capability",
    )
    args = parser.parse_args()
    print(connection_summary(get_database_url()), flush=True)
    try:
        asyncio.run(check_connection(check_admin=args.check_admin))
    except SQLAlchemyError as exc:
        parser.exit(1, database_error_message(exc) + "\n")
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")
    print("Connection successful.")
    if args.check_admin:
        print("Seed admin exists with Admin capability.")


if __name__ == "__main__":
    main()
