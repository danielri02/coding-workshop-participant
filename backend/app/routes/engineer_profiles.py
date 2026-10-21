"""Engineer capability and manual availability CRUD endpoints."""

from fastapi import APIRouter, Depends, Response, status

from ..database import crud
from ..models import EngineerProfile, User
from ..schemas import (
    EngineerProfileCreate,
    EngineerProfileRead,
    EngineerProfileUpdate,
)
from ..security.dependencies import current_user, require_admin
from .dependencies import DatabaseSession, RecordID

router = APIRouter(
    prefix="/engineer-profiles",
    tags=[EngineerProfile.__name__],
    dependencies=[Depends(current_user)],
)


@router.get("", response_model=list[EngineerProfileRead])
async def list_engineer_profiles(session: DatabaseSession) -> list[EngineerProfile]:
    """List all engineer profiles."""

    return await crud.list_records(session, EngineerProfile)


@router.post(
    "",
    response_model=EngineerProfileRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def create_engineer_profile(
    payload: EngineerProfileCreate, session: DatabaseSession
) -> EngineerProfile:
    """Grant Engineer capability to an existing employee."""

    await crud.get_record(session, User, payload.user_id)
    return await crud.create_record(session, EngineerProfile, payload.model_dump())


@router.get("/{user_id}", response_model=EngineerProfileRead)
async def get_engineer_profile(
    user_id: RecordID, session: DatabaseSession
) -> EngineerProfile:
    """Read a profile by its employee ID."""

    return await crud.get_record(session, EngineerProfile, user_id)


@router.patch(
    "/{user_id}",
    response_model=EngineerProfileRead,
    dependencies=[Depends(require_admin)],
)
async def update_engineer_profile(
    user_id: RecordID, payload: EngineerProfileUpdate, session: DatabaseSession
) -> EngineerProfile:
    """Update manually managed availability."""

    record = await crud.get_record(session, EngineerProfile, user_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_engineer_profile(
    user_id: RecordID, session: DatabaseSession
) -> Response:
    """Remove Engineer capability only when no incidents reference the profile."""

    await crud.delete_record(
        session,
        await crud.get_record(session, EngineerProfile, user_id, for_update=True),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
