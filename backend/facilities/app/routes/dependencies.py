"""Shared route parameter and async database dependency annotations."""

from typing import Annotated

from fastapi import Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database.session import get_session
from ..models import EngineerProfile, Incident, Note

DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
RecordID = Annotated[int, Path(gt=0, le=2_147_483_647)]
QueryID = Annotated[int, Query(gt=0, le=2_147_483_647)]
OptionalQueryID = Annotated[int | None, Query(gt=0, le=2_147_483_647)]

INCIDENT_READ_OPTIONS = (
    selectinload(Incident.reporter),
    selectinload(Incident.assignee).selectinload(EngineerProfile.user),
)
NOTE_READ_OPTIONS = (selectinload(Note.author),)
