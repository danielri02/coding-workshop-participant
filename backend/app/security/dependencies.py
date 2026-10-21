"""Bearer authentication and shared capability dependencies for business routes."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database.session import get_session
from ..models import User
from .config import SecurityConfigurationError, SecuritySettings, get_security_settings
from .jwt import InvalidAccessToken, decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")
logger = logging.getLogger(__name__)


def auth_settings() -> SecuritySettings:
    """Require signing configuration without preventing public registration/health."""

    try:
        return get_security_settings()
    except SecurityConfigurationError as exc:
        # Configuration errors contain setting names and rules, never values.
        logger.error("Authentication configuration error: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Authentication configuration error: {exc}",
        ) from None


AuthSettings = Annotated[SecuritySettings, Depends(auth_settings)]


async def current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    settings: AuthSettings,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Validate access tokens and reload capabilities on every request."""

    try:
        claims = decode_access_token(token, settings)
    except InvalidAccessToken:
        raise unauthenticated() from None
    user = await session.scalar(
        select(User)
        .where(User.id == claims.user_id)
        .options(selectinload(User.engineer_profile))
    )
    if user is None:
        raise unauthenticated()
    return user


def unauthenticated() -> HTTPException:
    """Return a uniform bearer challenge for rejected credentials."""

    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    """Require Admin capability independently of Engineer capability."""

    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin capability required")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
