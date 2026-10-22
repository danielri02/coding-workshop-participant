"""Admin-only impact previews for the existing DELETE endpoints."""

from typing import Literal

from fastapi import APIRouter

from ..database import crud
from ..database.deletion import RESOURCES, plan_deletion
from ..schemas.deletion import DeletionPreview
from ..security.dependencies import AdminUser
from .dependencies import DatabaseSession, RecordID

router = APIRouter(prefix="/deletions", tags=["Deletion"])
Resource = Literal[
    "users", "engineer-profiles", "buildings", "floors", "seats", "incidents", "notes"
]


@router.get("/{resource}/{record_id}", response_model=DeletionPreview)
async def preview_deletion(
    resource: Resource, record_id: RecordID, session: DatabaseSession, _admin: AdminUser
) -> DeletionPreview:
    record = await crud.get_record(session, RESOURCES[resource], record_id)
    return (await plan_deletion(session, record)).preview
