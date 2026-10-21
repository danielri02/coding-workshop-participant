"""Generate local Lambda settings from the same environment used by DB scripts.

From any directory: python /path/to/backend/scripts/configure_local.py
Use --check to detect stale/missing generated settings without changing files.
deploy-local.sh runs this automatically before the workshop Terraform command.
"""

import argparse
import json
import os
import platform
import sys
import tempfile
from pathlib import Path

if __package__ in {None, "", "scripts"}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy.engine import URL

from backend.app.database.config import get_database_url
from backend.app.database.diagnostics import connection_summary

SETTINGS_FILE = (
    Path(__file__).resolve().parents[2] / "infra" / "facilities.local.auto.tfvars.json"
)
RUNTIME_SETTINGS = (
    "JWT_SECRET_KEY",
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "REFRESH_TOKEN_EXPIRE_DAYS",
    "FRONTEND_ORIGIN",
    "DATABASE_RESET_KEY",
    "SEED_ADMIN_PASSWORD",
    "SEED_EMPLOYEE_PASSWORD",
    "SEED_ENGINEER_PASSWORD",
    "API_ROOT_PATH",
)


def local_environment() -> tuple[URL, dict[str, str]]:
    """Keep DB identity/options intact, translating only the host's Docker alias."""

    if os.environ.get("IS_LOCAL", "true").lower() != "true":
        raise ValueError("Local deployment requires IS_LOCAL=true")
    url = get_database_url()
    if not url.username:
        raise ValueError("Local deployment requires an explicit PostgreSQL user")
    if {"host", "hostaddr", "port", "dbname", "user", "password"} & url.query.keys():
        raise ValueError(
            "For deployment, put database identity in the DATABASE_URL authority/path, "
            "rather than connection query parameters"
        )
    host = os.environ.get("POSTGRES_LAMBDA_HOST")
    if host is None:
        host = url.host
        if host in {None, "localhost", "127.0.0.1", "::1"}:
            host = (
                "172.17.0.1" if platform.system() == "Linux" else "host.docker.internal"
            )
    if not host or not host.strip():
        raise ValueError("POSTGRES_LAMBDA_HOST must not be blank")
    deployed = url.set(host=host)
    environment = {
        **{name: os.environ[name] for name in RUNTIME_SETTINGS if name in os.environ},
        "IS_LOCAL": "true",
        "DATABASE_URL": deployed.render_as_string(hide_password=False),
        "POSTGRES_HOST": host,
        "POSTGRES_PORT": str(url.port or 5432),
        "POSTGRES_NAME": url.database,
        "POSTGRES_USER": url.username,
        "POSTGRES_PASS": url.password or "",
    }
    return url, environment


def write_settings(path: Path, environment: dict[str, str]) -> None:
    """Atomically save ignored, owner-readable settings; never print their values."""

    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            json.dump({"facilities_local_environment": environment}, stream, indent=2)
            stream.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    """Show safe target information and prepare or verify Terraform's local input."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check for stale settings")
    args = parser.parse_args()
    try:
        url, environment = local_environment()
        print(connection_summary(url))
        print(f"Lambda database host: {environment['POSTGRES_HOST']}")
        if args.check:
            expected = {"facilities_local_environment": environment}
            if (
                not SETTINGS_FILE.exists()
                or json.loads(SETTINGS_FILE.read_text()) != expected
            ):
                parser.exit(
                    1,
                    "Local deployment settings are missing or stale; run deploy-local.sh.\n",
                )
            print(
                "Local deployment settings match the current application configuration."
            )
        else:
            write_settings(SETTINGS_FILE, environment)
            print(
                "Prepared local Lambda settings. Redeploy to apply configuration changes."
            )
    except ValueError as exc:
        parser.exit(1, f"Invalid local configuration: {exc}\n")
    except OSError:
        parser.exit(
            1,
            "Unable to prepare local settings. Check the root .env, APP_ENV_FILE, "
            "DATABASE_URL/POSTGRES_* and write access to infra/.\n",
        )


if __name__ == "__main__":
    main()
