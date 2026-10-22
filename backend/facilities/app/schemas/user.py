"""Account and Engineer schemas with separate privileged operations."""

from typing import Annotated

from pydantic import Field, SecretStr, StrictBool, field_validator

from ..security.passwords import validate_password
from .base import CompanyEmail, Name, PatchSchema, PositiveID, Schema


class UserCreate(Schema):
    """Public registration; the service must hash the password before storage."""

    name: Name
    email: CompanyEmail
    password: Annotated[SecretStr, Field(min_length=12, max_length=128)]

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: SecretStr) -> SecretStr:
        """Reject whitespace-only passwords without trimming meaningful spaces."""

        validate_password(value.get_secret_value())
        return value


class UserUpdate(PatchSchema):
    """Editable account details, excluding credentials and capabilities."""

    name: Name | None = None
    email: CompanyEmail | None = None


class UserAdminUpdate(PatchSchema):
    """Admin-only capability change; never use for public registration."""

    is_admin: StrictBool | None = None


class EngineerProfileCreate(Schema):
    """Admin-only promotion of an existing employee to an engineer."""

    user_id: PositiveID
    is_available: StrictBool = True


class EngineerProfileUpdate(PatchSchema):
    """Manual availability managed by the engineer or an admin."""

    is_available: StrictBool | None = None


class EngineerProfileRead(Schema):
    """Public profile fields without credentials or nested account details."""

    user_id: PositiveID
    is_available: bool


class UserRead(Schema):
    """Account response that never exposes passwords or their hashes."""

    id: PositiveID
    name: Name
    email: CompanyEmail
    is_admin: bool
    engineer_profile: EngineerProfileRead | None = None
