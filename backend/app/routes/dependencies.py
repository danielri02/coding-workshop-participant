"""Shared route parameter and async database dependency annotations."""

from typing import Annotated

from fastapi import Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_session

DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
RecordID = Annotated[int, Path(gt=0, le=2_147_483_647)]
QueryID = Annotated[int, Query(gt=0, le=2_147_483_647)]
OptionalQueryID = Annotated[int | None, Query(gt=0, le=2_147_483_647)]
