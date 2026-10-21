"""Employee CRUD and capability endpoints; authentication is a later step."""

import asyncio

from fastapi import APIRouter, Response, status
from sqlalchemy.orm import selectinload

from backend.app.database import crud
from backend.app.models import User
from backend.app.schemas import UserAdminUpdate, UserCreate, UserRead, UserUpdate
from backend.app.security.passwords import hash_password

from .dependencies import DatabaseSession, RecordID

router = APIRouter(prefix="/users", tags=[User.__name__])
USER_OPTIONS = (selectinload(User.engineer_profile),)


@router.get("", response_model=list[UserRead])
async def list_users(session: DatabaseSession) -> list[User]:
    """List all employees without exposing password hashes."""

    return await crud.list_records(session, User, options=USER_OPTIONS)


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
async def get_user(user_id: RecordID, session: DatabaseSession) -> User:
    """Read an employee and their optional engineer profile."""

    return await crud.get_record(session, User, user_id, options=USER_OPTIONS)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: RecordID, payload: UserUpdate, session: DatabaseSession
) -> User:
    """Update employee details independently of capabilities."""

    record = await crud.get_record(session, User, user_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True), options=USER_OPTIONS
    )


@router.patch("/{user_id}/admin", response_model=UserRead)
async def update_user_admin(
    user_id: RecordID, payload: UserAdminUpdate, session: DatabaseSession
) -> User:
    """Change Admin capability independently of Engineer capability."""

    record = await crud.get_record(session, User, user_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True), options=USER_OPTIONS
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: RecordID, session: DatabaseSession) -> Response:
    """Delete an employee only when no profiles, reports, or notes reference them."""

    await crud.delete_record(
        session, await crud.get_record(session, User, user_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
