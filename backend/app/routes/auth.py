"""JSON login and refresh-token rotation endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..schemas.auth import LoginRequest, RefreshRequest, TokenPair
from ..security.authentication import authenticate_user
from ..security.config import (
    SecurityConfigurationError,
    SecuritySettings,
    get_security_settings,
)
from ..security.refresh_tokens import rotate_refresh_token
from .dependencies import DatabaseSession

router = APIRouter(prefix="/auth", tags=["Auth"])


def auth_settings() -> SecuritySettings:
    """Require a configured signing key without affecting unauthenticated CRUD."""

    try:
        return get_security_settings()
    except SecurityConfigurationError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured"
        ) from None


AuthSettings = Annotated[SecuritySettings, Depends(auth_settings)]


def prevent_token_caching(response: Response) -> None:
    """Keep successful token responses out of browser and intermediary caches."""

    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    session: DatabaseSession,
    settings: AuthSettings,
    response: Response,
) -> TokenPair:
    """Sign in with an acme.inc email address and password."""

    prevent_token_caching(response)
    return await authenticate_user(session, payload, settings)


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    payload: RefreshRequest,
    session: DatabaseSession,
    settings: AuthSettings,
    response: Response,
) -> TokenPair:
    """Exchange an unexpired, unused refresh token for a replacement token pair."""

    prevent_token_caching(response)
    return await rotate_refresh_token(
        session, payload.refresh_token.get_secret_value(), settings
    )
