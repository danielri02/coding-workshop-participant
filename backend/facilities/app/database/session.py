"""Async SQLAlchemy engine, session factory, and FastAPI dependency."""

import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .config import get_database_url

# Engine construction opens no connection. Tables are managed explicitly by scripts.
engine = create_async_engine(
    get_database_url(),
    pool_pre_ping=True,
    # Invocation event loops must never inherit connections from an earlier call.
    **({"poolclass": NullPool} if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") else {}),
)
session_factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield one session per request; callers explicitly commit successful writes.

    Use Depends(get_session) in FastAPI routes. Exceptions roll back writes;
    closing the session also rolls back any transaction left uncommitted.
    """

    async with session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
