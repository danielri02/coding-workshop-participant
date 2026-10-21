"""Key-protected development database reinitialization through the backend API."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from ..database.session import engine
from ..maintenance.reset import reset_database
from ..maintenance.tables import initialize_database as upgrade_database
from ..schemas.maintenance import (
    DatabaseInitRequest,
    DatabaseInitResult,
    DatabaseUpgradeResult,
)
from ..security.reset_key import require_reset_key

router = APIRouter(prefix="/dev/database", tags=["Development"])


@router.post("/upgrade", response_model=DatabaseUpgradeResult)
async def upgrade_schema(
    response: Response,
    _access: Annotated[None, Depends(require_reset_key)],
) -> DatabaseUpgradeResult:
    """Apply supported schema upgrades while preserving all application data."""

    response.headers["Cache-Control"] = "no-store"
    await upgrade_database(engine)
    return DatabaseUpgradeResult()


@router.post("/init", response_model=DatabaseInitResult)
async def initialize_database(
    response: Response,
    _access: Annotated[None, Depends(require_reset_key)],
    _payload: Annotated[DatabaseInitRequest, Body(default_factory=DatabaseInitRequest)],
) -> DatabaseInitResult:
    """Replace all application data with seed data, committing the operation atomically."""

    response.headers["Cache-Control"] = "no-store"
    try:
        counts = await reset_database(engine)
    except ValueError:
        raise HTTPException(
            422,
            "Configure valid SEED_ADMIN_PASSWORD, SEED_EMPLOYEE_PASSWORD and SEED_ENGINEER_PASSWORD before resetting cloud data.",
            headers={"Cache-Control": "no-store"},
        ) from None
    return DatabaseInitResult(inserted=counts)
