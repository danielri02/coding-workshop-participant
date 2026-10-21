"""JSON login, refresh requests, and token responses."""

from typing import Annotated, Literal

from pydantic import Field, SecretStr

from .base import CompanyEmail, Schema


class LoginRequest(Schema):
    """Normalize the employee identity without reapplying password creation rules."""

    email: CompanyEmail
    password: Annotated[SecretStr, Field(min_length=1, max_length=128)]


class RefreshRequest(Schema):
    """Keep refresh credentials out of URL parameters and model representations."""

    refresh_token: Annotated[SecretStr, Field(min_length=1, max_length=512)]


class TokenPair(Schema):
    """Bearer access JWT and replacement refresh token, with lifetimes in seconds."""

    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: Annotated[int, Field(gt=0)]
    refresh_expires_in: Annotated[int, Field(gt=0)]
