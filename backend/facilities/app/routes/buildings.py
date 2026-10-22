"""Building CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select

from ..database import crud
from ..database.grids import grid_records
from ..models import Building
from ..schemas import BuildingCreate, BuildingRead, BuildingUpdate
from ..schemas.grid import GridQuery, Page
from ..security.dependencies import AdminUser, CurrentUser
from .dependencies import DatabaseSession, DeletionConfirmation, RecordID

router = APIRouter(prefix="/buildings", tags=[Building.__name__])


@router.get("", response_model=list[BuildingRead])
async def list_buildings(
    session: DatabaseSession, _user: CurrentUser
) -> list[Building]:
    """List all buildings without pagination."""

    return await crud.list_records(session, Building)


@router.get("/grid", response_model=Page[BuildingRead])
async def grid_buildings(
    session: DatabaseSession,
    _user: CurrentUser,
    query: Annotated[GridQuery, Query()],
) -> dict:
    """Search, filter and page buildings for collection grids."""

    statement = select(Building)
    return await grid_records(
        session,
        statement,
        query,
        primary_key=Building.id,
        text_columns={"name": Building.name},
    )


@router.post(
    "",
    response_model=BuildingRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_building(
    payload: BuildingCreate, session: DatabaseSession, _admin: AdminUser
) -> Building:
    """Create a building."""

    return await crud.create_record(session, Building, payload.model_dump())


@router.get("/{building_id}", response_model=BuildingRead)
async def get_building(
    building_id: RecordID, session: DatabaseSession, _user: CurrentUser
) -> Building:
    """Read one building."""

    return await crud.get_record(session, Building, building_id)


@router.patch("/{building_id}", response_model=BuildingRead)
async def update_building(
    building_id: RecordID,
    payload: BuildingUpdate,
    session: DatabaseSession,
    _admin: AdminUser,
) -> Building:
    """Rename a building."""

    record = await crud.get_record(session, Building, building_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{building_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_building(
    building_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Delete a building and its contained floors, seats, incidents and notes."""

    await crud.delete_record(
        session,
        await crud.get_record(session, Building, building_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
