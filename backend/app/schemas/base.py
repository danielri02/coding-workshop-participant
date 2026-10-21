"""Shared API validation, normalization, and partial-update behavior."""

from datetime import datetime, timezone
from typing import Annotated, ClassVar, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    model_validator,
)

PositiveID = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]
Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
Body = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)
]
Reason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]


def normalize_email(value: object) -> object:
    """Apply the agreed case-insensitive identity policy before email validation."""

    return value.strip().lower() if isinstance(value, str) else value


def require_company_email(value: str) -> str:
    """Accept only the exact acme.inc domain, not subdomains or suffix matches."""

    if value.rsplit("@", 1)[-1] != "acme.inc":
        raise ValueError("Email must use the acme.inc domain")
    return value


def to_utc(value: datetime) -> datetime:
    """Normalize already timezone-aware response timestamps to UTC."""

    return value.astimezone(timezone.utc)


CompanyEmail = Annotated[
    EmailStr,
    BeforeValidator(normalize_email),
    AfterValidator(require_company_email),
    Field(max_length=254),
]
UTCDateTime = Annotated[AwareDatetime, AfterValidator(to_utc)]


class Schema(BaseModel):
    """Reject unknown inputs and support explicit ORM-to-response conversion."""

    model_config = ConfigDict(
        extra="forbid", from_attributes=True, validate_default=True
    )


class PatchSchema(Schema):
    """Distinguish omitted fields from explicit nulls in partial updates."""

    nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        """Require an actual change and reject clearing non-nullable fields."""

        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        for field in self.model_fields_set - self.nullable_fields:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self
