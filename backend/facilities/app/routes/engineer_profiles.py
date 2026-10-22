"""Engineer capability and manual availability CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select

from ..database import crud
from ..database.grids import grid_records
from ..models import EngineerProfile, User
from ..schemas import (
    EngineerProfileCreate,
    EngineerProfileRead,
    EngineerProfileUpdate,
)
from ..schemas.grid import GridQuery, Page
from ..security.dependencies import AdminUser, CurrentUser
from ..security.permissions import require_account_access
from .dependencies import DatabaseSession, DeletionConfirmation, RecordID

router = APIRouter(
    prefix="/engineer-profiles",
    tags=[EngineerProfile.__name__],
)


@router.get("", response_model=list[EngineerProfileRead])
async def list_engineer_profiles(
    session: DatabaseSession, _user: CurrentUser
) -> list[EngineerProfile]:
    """List all engineer profiles."""

    return await crud.list_records(session, EngineerProfile)


@router.get("/grid", response_model=Page[EngineerProfileRead])
async def grid_engineer_profiles(
    session: DatabaseSession,
    _admin: AdminUser,
    query: Annotated[GridQuery, Query()],
) -> dict:
    """Page the admin directory, including searches on account names and emails."""

    statement = select(EngineerProfile).join(User)
    return await grid_records(
        session,
        statement,
        query,
        primary_key=EngineerProfile.user_id,
        text_columns={"user_name": User.name, "user_email": User.email},
        boolean_columns={"is_available": EngineerProfile.is_available},
    )


@router.post(
    "",
    response_model=EngineerProfileRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_engineer_profile(
    payload: EngineerProfileCreate, session: DatabaseSession, _admin: AdminUser
) -> EngineerProfile:
    """Grant Engineer capability to an existing employee."""

    await crud.get_record(session, User, payload.user_id)
    return await crud.create_record(session, EngineerProfile, payload.model_dump())


@router.get("/{user_id}", response_model=EngineerProfileRead)
async def get_engineer_profile(
    user_id: RecordID, session: DatabaseSession, _user: CurrentUser
) -> EngineerProfile:
    """Read a profile by its employee ID."""

    return await crud.get_record(session, EngineerProfile, user_id)


@router.patch(
    "/{user_id}",
    response_model=EngineerProfileRead,
)
async def update_engineer_profile(
    user_id: RecordID,
    payload: EngineerProfileUpdate,
    session: DatabaseSession,
    user: CurrentUser,
) -> EngineerProfile:
    """Admins manage any profile; engineers manage their own availability."""

    require_account_access(user, user_id)
    record = await crud.get_record(session, EngineerProfile, user_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_engineer_profile(
    user_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Remove Engineer capability, preserving and unassigning its incident work."""

    await crud.delete_record(
        session,
        await crud.get_record(session, EngineerProfile, user_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
