"""Key-protected development database reset, independent of application accounts."""

import hmac
import os
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import APIKeyHeader

reset_key_header = APIKeyHeader(
    name="X-Database-Reset-Key", scheme_name="DatabaseResetKey", auto_error=False
)


def require_reset_key(
    supplied: Annotated[str | None, Depends(reset_key_header)],
) -> None:
    """Disable reset unless explicitly configured, then compare keys in constant time."""

    configured = os.environ.get("DATABASE_RESET_KEY", "")
    headers = {"Cache-Control": "no-store"}
    if len(configured.encode("utf-8")) < 32 or not configured.strip():
        raise HTTPException(
            503,
            "Database reset is disabled; configure DATABASE_RESET_KEY.",
            headers=headers,
        )
    if not supplied or not hmac.compare_digest(
        supplied.encode("utf-8"), configured.encode("utf-8")
    ):
        raise HTTPException(403, "Invalid database reset key", headers=headers)
