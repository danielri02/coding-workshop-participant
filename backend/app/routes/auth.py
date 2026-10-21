"""JSON login and refresh-token rotation endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import ValidationError

from ..models import User
from ..schemas.auth import LoginRequest, RefreshRequest, TokenPair
from ..schemas.user import UserRead
from ..security.authentication import authenticate_user
from ..security.dependencies import AuthSettings, CurrentUser
from ..security.refresh_tokens import invalidate_refresh_chain, rotate_refresh_token
from .dependencies import DatabaseSession

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> User:
    """Return the signed-in account and current capabilities for the UI."""

    return user


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


@router.post("/token", response_model=TokenPair)
async def token(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: DatabaseSession,
    settings: AuthSettings,
    response: Response,
) -> TokenPair:
    """Sign in from Swagger Authorize; username is the employee email address."""

    prevent_token_caching(response)
    try:
        payload = LoginRequest(email=form.username, password=form.password)
    except ValidationError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"},
        ) from None
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


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: DatabaseSession) -> Response:
    """Invalidate this login's entire refresh chain using any token in the chain."""

    await invalidate_refresh_chain(session, payload.refresh_token.get_secret_value())
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    prevent_token_caching(response)
    return response
