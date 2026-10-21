"""Account authentication and initial token issuance without role enforcement."""

import asyncio

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.crud import commit
from ..models import User
from ..schemas.auth import LoginRequest, TokenPair
from .config import SecuritySettings
from .passwords import (
    dummy_password_hash,
    hash_password,
    password_needs_rehash,
    verify_password,
)
from .refresh_tokens import issue_token_pair


async def authenticate_user(
    session: AsyncSession, payload: LoginRequest, settings: SecuritySettings
) -> TokenPair:
    """Verify credentials, upgrade old hashes, and persist one new login session."""

    user = await session.scalar(select(User).where(User.email == payload.email))
    stored_hash = (
        user.password_hash
        if user is not None
        else await asyncio.to_thread(dummy_password_hash)
    )
    password = payload.password.get_secret_value()
    verified = await asyncio.to_thread(verify_password, password, stored_hash)
    if not verified or user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password",
            headers={
                "WWW-Authenticate": "Bearer",
                "Cache-Control": "no-store",
                "Pragma": "no-cache",
            },
        )
    if password_needs_rehash(user.password_hash):
        user.password_hash = await asyncio.to_thread(hash_password, password)
    tokens = issue_token_pair(session, user.id, settings)
    await commit(session)
    return tokens
