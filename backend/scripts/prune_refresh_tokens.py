"""Count expired refresh credentials, or delete them explicitly with --apply.

From backend/: python scripts/prune_refresh_tokens.py [--apply]
Unexpired consumed/revoked hashes remain available for replay detection.
"""

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.crud import commit
from backend.app.database.diagnostics import database_error_message
from backend.app.database.session import engine, session_factory
from backend.app.models import RefreshToken


async def prune_expired_tokens(
    session: AsyncSession, *, apply: bool = False, now: datetime | None = None
) -> int:
    """Count or delete only expired hashes, preserving live replay protection."""

    cutoff = now or datetime.now(timezone.utc)
    expired = RefreshToken.expires_at <= cutoff
    if not apply:
        return (
            await session.scalar(
                select(func.count()).select_from(RefreshToken).where(expired)
            )
            or 0
        )
    result = await session.execute(delete(RefreshToken).where(expired))
    await commit(session)
    return result.rowcount


async def run(apply: bool) -> int:
    """Open an explicit maintenance session and release connections on exit."""

    try:
        async with session_factory() as session:
            return await prune_expired_tokens(session, apply=apply)
    finally:
        await engine.dispose()


def main() -> None:
    """Default to a count; mutate only when --apply is supplied."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Delete expired credentials"
    )
    args = parser.parse_args()
    try:
        count = asyncio.run(run(args.apply))
    except SQLAlchemyError as exc:
        parser.exit(1, database_error_message(exc) + "\n")
    print(
        f"Expired refresh credentials {'deleted' if args.apply else 'eligible'}: {count}"
    )


if __name__ == "__main__":
    main()
