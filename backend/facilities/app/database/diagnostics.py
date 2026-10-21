"""Safe connection summaries and actionable errors for database maintenance."""

import os

from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError

from ..config import ENVIRONMENT_FILE
from .config import POSTGRES_SETTINGS


def connection_summary(url: URL) -> str:
    """Describe the selected target without exposing password or query values."""

    source = (
        "DATABASE_URL environment variable"
        if "DATABASE_URL" in os.environ
        else "workshop POSTGRES_* environment variables"
        if any(name in os.environ for name in POSTGRES_SETTINGS)
        else "DEFAULT_DATABASE_URL in app/database/config.py"
    )
    if ENVIRONMENT_FILE is not None:
        source += f" (shared file loaded: {ENVIRONMENT_FILE})"
    password_present = url.password is not None or "password" in url.query
    return "\n".join(
        (
            f"Configuration source: {source}",
            f"Host: {url.host or '(local Unix socket)'}",
            f"Port: {url.port or 5432}",
            f"Database: {url.database}",
            f"Database role: {url.username or '(operating-system default)'}",
            f"URL password: {'configured' if password_present else 'not configured'}",
        )
    )


def database_error_message(error: SQLAlchemyError) -> str:
    """Classify errors internally, returning static guidance instead of raw SQL/DSNs."""

    original = getattr(error, "orig", error)
    code = getattr(original, "sqlstate", None)
    message = str(original).lower()
    if "no password supplied" in message:
        return (
            "PostgreSQL requires a password, but none was supplied. "
            "Set the password in POSTGRES_* or DATABASE_URL."
        )
    if code == "28P01" or "password authentication failed" in message:
        return (
            "PostgreSQL rejected the database role/password. "
            "Check the credentials in POSTGRES_* or DATABASE_URL."
        )
    if "role" in message and "does not exist" in message:
        return (
            "The configured PostgreSQL role does not exist. "
            "Use an existing database role in POSTGRES_* or DATABASE_URL."
        )
    if code == "3D000" or ("database" in message and "does not exist" in message):
        return (
            "The configured database does not exist on this PostgreSQL server. "
            "Check the database name, host, and port."
        )
    if "no pg_hba.conf entry" in message or "peer authentication failed" in message:
        return (
            "PostgreSQL authentication rules rejected this connection. "
            "Check the role, connection method, and server pg_hba.conf settings."
        )
    if code == "42501" or "permission denied" in message:
        return (
            "The database role lacks the required database/schema permissions. "
            "Check CONNECT and schema CREATE/USAGE privileges."
        )
    if code == "42P01" or ("relation" in message and "does not exist" in message):
        return "Application tables are missing. Run the create_tables script first."
    if "connection refused" in message:
        return (
            "No PostgreSQL server is accepting connections at the configured "
            "host/port. Check that PostgreSQL is running and listening there."
        )
    if any(
        value in message
        for value in (
            "could not translate host name",
            "name or service not known",
            "failed to resolve host",
            "nodename nor servname",
        )
    ):
        return (
            "The PostgreSQL hostname could not be resolved. "
            "Check the host in POSTGRES_* or DATABASE_URL."
        )
    if "timeout" in message or "timed out" in message:
        return (
            "The PostgreSQL connection timed out. "
            "Check the host, port, network access, and server availability."
        )
    if "certificate verify failed" in message or "root certificate" in message:
        return (
            "PostgreSQL TLS certificate verification failed. "
            "Configure the correct trusted CA and SSL connection settings."
        )
    if "server does not support ssl" in message:
        return (
            "The server does not support the requested SSL connection. "
            "Check that the configured host and TLS settings match the intended server."
        )
    return (
        f"Database operation failed ({type(error).__name__}). "
        "Check the configured server and database settings."
    )
