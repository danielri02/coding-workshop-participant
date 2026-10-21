"""Explicit development database reinitialization; options cannot change its target."""

from typing import Annotated

from pydantic import Field

from .base import Schema


class DatabaseInitRequest(Schema):
    """An optional empty body; no arbitrary database credentials or reset flags."""


class DatabaseInitResult(Schema):
    initialized: bool = True
    inserted: dict[str, Annotated[int, Field(ge=0)]]


class DatabaseUpgradeResult(Schema):
    upgraded: bool = True
