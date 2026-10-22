"""Administrator deletion previews and their confirmation fingerprints."""

from typing import Annotated

from pydantic import Field

from .base import PositiveID, Schema


class DeletionPreview(Schema):
    resource: str
    record_id: PositiveID
    counts: dict[str, Annotated[int, Field(ge=0)]]
    unassigned_incidents: Annotated[int, Field(ge=0)]
    confirmation_token: str
