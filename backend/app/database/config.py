"""Database URL configuration shared by the API and maintenance scripts."""

import os

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError

DEFAULT_DATABASE_URL = "postgresql+psycopg://workshop@127.0.0.1:5432/workshop"


def get_database_url() -> URL:
    """Read DATABASE_URL, preserving credentials and SSL query parameters.

    Plain postgres/postgresql URLs are normalized to the psycopg 3 driver,
    which supports SQLAlchemy's async engine. No URL or credentials are logged.
    """

    raw_url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    try:
        url = make_url(raw_url)
    except (ArgumentError, ValueError):
        raise ValueError("DATABASE_URL must be a valid PostgreSQL URL") from None
    if url.drivername not in {"postgres", "postgresql", "postgresql+psycopg"}:
        raise ValueError("DATABASE_URL must use PostgreSQL with the psycopg driver")
    if not url.database or not url.database.strip():
        raise ValueError("DATABASE_URL must specify a database name")
    return url.set(drivername="postgresql+psycopg")
