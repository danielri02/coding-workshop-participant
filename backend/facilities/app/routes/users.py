"""Public employee registration and authorized account/capability operations."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..database import crud
from ..database.grids import grid_records
from ..models import User
from ..schemas import UserAdminUpdate, UserCreate, UserRead, UserUpdate
from ..schemas.grid import GridQuery, Page
from ..security.dependencies import AdminUser, CurrentUser
from ..security.passwords import hash_password
from ..security.permissions import require_account_access
from .dependencies import DatabaseSession, DeletionConfirmation, RecordID

router = APIRouter(prefix="/users", tags=[User.__name__])
USER_OPTIONS = (selectinload(User.engineer_profile),)


@router.get("", response_model=list[UserRead])
async def list_users(session: DatabaseSession, _admin: AdminUser) -> list[User]:
    """List all employees without exposing password hashes."""

    return await crud.list_records(session, User, options=USER_OPTIONS)


@router.get("/grid", response_model=Page[UserRead])
async def grid_users(
    session: DatabaseSession,
    _admin: AdminUser,
    query: Annotated[GridQuery, Query()],
) -> dict:
    """Search, filter and page users for collection grids."""

    statement = select(User)
    return await grid_records(
        session,
        statement,
        query,
        primary_key=User.id,
        text_columns={"name": User.name, "email": User.email},
        boolean_columns={
            "is_admin": User.is_admin,
            "is_engineer": User.engineer_profile.has(),
        },
        options=USER_OPTIONS,
    )


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: DatabaseSession) -> User:
    """Register an employee with a hashed password and no granted capabilities."""

    password_hash = await asyncio.to_thread(
        hash_password, payload.password.get_secret_value()
    )
    values = {
        "name": payload.name,
        "email": payload.email,
        "password_hash": password_hash,
    }
    return await crud.create_record(session, User, values, options=USER_OPTIONS)


@router.get("/{user_id}", response_model=UserRead)
async def get_user(
    user_id: RecordID, session: DatabaseSession, user: CurrentUser
) -> User:
    """Read an employee and their optional engineer profile."""

    require_account_access(user, user_id)
    return await crud.get_record(session, User, user_id, options=USER_OPTIONS)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: RecordID, payload: UserUpdate, session: DatabaseSession, user: CurrentUser
) -> User:
    """Update employee details independently of capabilities."""

    require_account_access(user, user_id)
    record = await crud.get_record(session, User, user_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True), options=USER_OPTIONS
    )


@router.patch("/{user_id}/admin", response_model=UserRead)
async def update_user_admin(
    user_id: RecordID,
    payload: UserAdminUpdate,
    session: DatabaseSession,
    _admin: AdminUser,
) -> User:
    """Change Admin capability independently of Engineer capability."""

    record = await crud.get_record(session, User, user_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True), options=USER_OPTIONS
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Delete a confirmed employee cascade, preserving other reporters’ assigned work."""

    await crud.delete_record(
        session,
        await crud.get_record(session, User, user_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
