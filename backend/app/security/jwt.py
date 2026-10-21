"""Creation and strict verification of short-lived access JWTs."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt

from .config import SecuritySettings


class InvalidAccessToken(ValueError):
    """An access token failed signature, claim, or lifetime validation."""


@dataclass(frozen=True)
class AccessTokenClaims:
    """Verified identity claims, independent of authorization or database state."""

    user_id: int
    token_id: str
    issued_at: datetime
    expires_at: datetime


def create_access_token(
    user_id: int, settings: SecuritySettings, *, now: datetime | None = None
) -> str:
    """Sign an access-only JWT without embedding roles or credentials."""

    if (
        isinstance(user_id, bool)
        or not isinstance(user_id, int)
        or not 1 <= user_id <= 2_147_483_647
    ):
        raise ValueError("Token subject must be a valid user ID")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("Token timestamps must be timezone-aware")
    return jwt.encode(
        {
            "sub": str(user_id),
            "type": "access",
            "jti": uuid4().hex,
            "iat": now,
            "nbf": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
            "iss": settings.issuer,
            "aud": settings.audience,
        },
        settings.jwt_secret_key.get_secret_value(),
        algorithm="HS256",
    )


def decode_access_token(token: str, settings: SecuritySettings) -> AccessTokenClaims:
    """Verify fixed-algorithm signatures, required claims, audience, and expiry."""

    if not isinstance(token, str) or not 1 <= len(token) <= 4096:
        raise InvalidAccessToken("Invalid or expired access token")
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.audience,
            issuer=settings.issuer,
            options={
                "require": ["sub", "type", "jti", "iat", "nbf", "exp", "iss", "aud"],
                "strict_aud": True,
            },
        )
        subject = claims["sub"]
        if (
            not isinstance(subject, str)
            or not subject.isascii()
            or not subject.isdecimal()
            or not 1 <= int(subject) <= 2_147_483_647
        ):
            raise ValueError("Invalid subject")
        if (
            claims["type"] != "access"
            or not isinstance(claims["jti"], str)
            or not claims["jti"]
        ):
            raise ValueError("Invalid token type or ID")
        if any(type(claims[field]) is not int for field in ("iat", "nbf", "exp")):
            raise ValueError("Invalid timestamps")
        if claims["exp"] <= max(claims["iat"], claims["nbf"]):
            raise ValueError("Invalid token lifetime")
        return AccessTokenClaims(
            user_id=int(subject),
            token_id=claims["jti"],
            issued_at=datetime.fromtimestamp(claims["iat"], timezone.utc),
            expires_at=datetime.fromtimestamp(claims["exp"], timezone.utc),
        )
    except (jwt.InvalidTokenError, TypeError, ValueError, OverflowError, OSError):
        raise InvalidAccessToken("Invalid or expired access token") from None
