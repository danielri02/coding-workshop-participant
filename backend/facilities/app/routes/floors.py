"""Floor CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select

from ..database import crud
from ..database.grids import grid_records
from ..models import Building, Floor
from ..schemas import FloorCreate, FloorRead, FloorUpdate
from ..schemas.grid import FloorGridQuery, Page
from ..security.dependencies import AdminUser, CurrentUser
from .dependencies import (
    DatabaseSession,
    DeletionConfirmation,
    OptionalQueryID,
    RecordID,
)

router = APIRouter(prefix="/floors", tags=[Floor.__name__])


@router.get("", response_model=list[FloorRead])
async def list_floors(
    session: DatabaseSession, _user: CurrentUser, building_id: OptionalQueryID = None
) -> list[Floor]:
    """List all floors, optionally within one building."""

    filters = {"building_id": building_id} if building_id is not None else {}
    return await crud.list_records(session, Floor, filters=filters)


@router.get("/grid", response_model=Page[FloorRead])
async def grid_floors(
    session: DatabaseSession,
    _user: CurrentUser,
    query: Annotated[FloorGridQuery, Query()],
) -> dict:
    """Search, filter and page floors for collection grids."""

    statement = select(Floor).join(Building)
    if query.building_id is not None:
        statement = statement.where(Floor.building_id == query.building_id)
    return await grid_records(
        session,
        statement,
        query,
        primary_key=Floor.id,
        text_columns={"label": Floor.label, "building_name": Building.name},
    )


@router.post(
    "",
    response_model=FloorRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_floor(
    payload: FloorCreate, session: DatabaseSession, _admin: AdminUser
) -> Floor:
    """Create a labeled floor in an existing building."""

    await crud.get_record(session, Building, payload.building_id)
    return await crud.create_record(session, Floor, payload.model_dump())


@router.get("/{floor_id}", response_model=FloorRead)
async def get_floor(
    floor_id: RecordID, session: DatabaseSession, _user: CurrentUser
) -> Floor:
    """Read one floor."""

    return await crud.get_record(session, Floor, floor_id)


@router.patch("/{floor_id}", response_model=FloorRead)
async def update_floor(
    floor_id: RecordID,
    payload: FloorUpdate,
    session: DatabaseSession,
    _admin: AdminUser,
) -> Floor:
    """Relabel a floor without changing its parent building."""

    record = await crud.get_record(session, Floor, floor_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{floor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_floor(
    floor_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Delete a floor and its contained seats, incidents and notes."""

    await crud.delete_record(
        session,
        await crud.get_record(session, Floor, floor_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
