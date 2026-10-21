"""Authentication configuration with environment overrides and local dev defaults."""

import os
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import SecretStr

# Stable across local restarts; environment configuration overrides this dev key.
DEFAULT_JWT_SECRET_KEY = "coding-workshop-local-development-signing-key"  # nosec B105


class SecurityConfigurationError(ValueError):
    """An explicitly configured authentication setting is invalid."""


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


def get_security_settings(
    environment: Mapping[str, str] | None = None,
) -> SecuritySettings:
    """Keep local defaults; cloud deployments must supply their own signing key."""

    settings = os.environ if environment is None else environment
    key = settings.get("JWT_SECRET_KEY", DEFAULT_JWT_SECRET_KEY)
    if (
        settings.get("IS_LOCAL", "true").lower() == "false"
        and key == DEFAULT_JWT_SECRET_KEY
    ):
        raise SecurityConfigurationError(
            "A dedicated JWT_SECRET_KEY is required outside local development"
        )
    try:
        access_minutes = int(settings.get("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
        refresh_days = int(settings.get("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
    except ValueError:
        raise SecurityConfigurationError("Token lifetimes must be integers") from None
    return SecuritySettings(
        jwt_secret_key=SecretStr(key),
        access_token_minutes=access_minutes,
        refresh_token_days=refresh_days,
    )
