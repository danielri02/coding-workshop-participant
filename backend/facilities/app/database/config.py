"""Workshop PostgreSQL settings with an explicit DATABASE_URL override."""

import os

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

# Match the provided workshop setup for commands run directly on the host.
DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://postgres:postgres123@localhost:5432/postgres?sslmode=disable"
)
POSTGRES_SETTINGS = (
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_NAME",
    "POSTGRES_USER",
    "POSTGRES_PASS",
)


def get_database_url() -> URL:
    """Prefer DATABASE_URL; otherwise use workshop-injected POSTGRES_* settings.

    URL.create preserves special characters in credentials. IS_LOCAL controls
    TLS for component settings; an explicit URL keeps its own query options.
    No configuration values are included in validation errors.
    """

    if "DATABASE_URL" in os.environ:
        try:
            url = make_url(os.environ["DATABASE_URL"])
        except (ArgumentError, ValueError):
            raise ValueError("DATABASE_URL must be a valid PostgreSQL URL") from None
        if url.drivername not in {"postgres", "postgresql", "postgresql+psycopg"}:
            raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver")
        if not url.database or not url.database.strip():
            raise ValueError("DATABASE_URL must specify a database name")
        return url.set(drivername="postgresql+psycopg")

    local = os.environ.get("IS_LOCAL", "true").lower()
    if local not in {"true", "false"}:
        raise ValueError("IS_LOCAL must be true or false")
    try:
        port = int(os.environ.get("POSTGRES_PORT", "5432"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise ValueError("POSTGRES_PORT must be a valid TCP port") from None
    if local == "false" and not os.environ.get("POSTGRES_PASS"):
        raise ValueError("POSTGRES_PASS is required outside local development")
    defaults = make_url(DEFAULT_DATABASE_URL)
    return URL.create(
        drivername="postgresql+psycopg",
        host=os.environ.get("POSTGRES_HOST", defaults.host),
        port=port,
        database=os.environ.get("POSTGRES_NAME", defaults.database),
        username=os.environ.get("POSTGRES_USER", defaults.username),
        password=os.environ.get("POSTGRES_PASS", defaults.password),
        query={"sslmode": "disable" if local == "true" else "require"},
    )
