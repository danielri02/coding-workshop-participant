"""Atomic replacement of application data with the shared seed dataset."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from ..models import Base
from .seed import seed_database, seed_passwords
from .tables import initialize_tables


async def reset_database(database_engine: AsyncEngine) -> dict[str, int]:
    """Preserve unrelated tables and roll back the entire reset if seeding fails."""

    seed_passwords()  # Validate credentials before modifying schema or data.
    async with database_engine.begin() as connection:
        await initialize_tables(connection)
        names = ", ".join(
            connection.dialect.identifier_preparer.format_table(table)
            for table in Base.metadata.sorted_tables
        )
        # Names come only from trusted model metadata, never from request input.
        # Keep sequences moving so old access JWTs cannot identify newly seeded users.
        await connection.execute(text(f"TRUNCATE TABLE {names} CONTINUE IDENTITY"))
        async with AsyncSession(
            bind=connection,
            expire_on_commit=False,
            autoflush=False,
            join_transaction_mode="create_savepoint",
        ) as session:
            return await seed_database(session)
