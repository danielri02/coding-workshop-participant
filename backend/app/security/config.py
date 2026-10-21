"""Authentication configuration; signing keys have no built-in default."""

import os
from dataclasses import dataclass

from pydantic import SecretStr


class SecurityConfigurationError(ValueError):
    """Authentication configuration is missing or invalid."""


@dataclass(frozen=True)
class SecuritySettings:
    """HS256 signing settings and absolute token lifetimes."""

    jwt_secret_key: SecretStr
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    issuer: str = "coding-workshop"
    audience: str = "coding-workshop-api"

    def __post_init__(self) -> None:
        """Reject weak keys and invalid lifetimes without echoing secret values."""

        key = self.jwt_secret_key.get_secret_value()
        if len(key.encode("utf-8")) < 32 or not key.strip():
            raise SecurityConfigurationError(
                "JWT_SECRET_KEY must contain at least 32 bytes"
            )
        if not 1 <= self.access_token_minutes <= 1440:
            raise SecurityConfigurationError(
                "ACCESS_TOKEN_EXPIRE_MINUTES must be between 1 and 1440"
            )
        if not 1 <= self.refresh_token_days <= 365:
            raise SecurityConfigurationError(
                "REFRESH_TOKEN_EXPIRE_DAYS must be between 1 and 365"
            )
        if not self.issuer.strip() or not self.audience.strip():
            raise SecurityConfigurationError(
                "JWT issuer and audience must not be blank"
            )


def get_security_settings() -> SecuritySettings:
    """Read auth settings only when needed; missing configuration fails closed."""

    try:
        access_minutes = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
        refresh_days = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
    except ValueError:
        raise SecurityConfigurationError("Token lifetimes must be integers") from None
    return SecuritySettings(
        jwt_secret_key=SecretStr(os.environ.get("JWT_SECRET_KEY", "")),
        access_token_minutes=access_minutes,
        refresh_token_days=refresh_days,
    )
