"""Load the shared host-side application environment before creating services."""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def load_environment() -> Path | None:
    """Use the repository's .env from any directory; explicit env values win.

    Lambda receives these values from deployment and never reads the host file.
    APP_ENV_FILE selects another file (relative paths use the repository root); an empty
    value disables file loading for isolated commands and tests.
    """

    selected = os.environ.get("APP_ENV_FILE")
    if selected == "" or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return None
    path = Path(selected) if selected is not None else PROJECT_ROOT / ".env"
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    if not path.is_file():
        if selected is not None:
            raise ValueError("APP_ENV_FILE must name an existing environment file")
        return None
    load_dotenv(path, override=False, interpolate=False)
    return path


ENVIRONMENT_FILE = load_environment()
