"""Building CRUD endpoints."""

from fastapi import APIRouter, Response, status

from backend.app.database import crud
from backend.app.models import Building
from backend.app.schemas import BuildingCreate, BuildingRead, BuildingUpdate

from .dependencies import DatabaseSession, RecordID

router = APIRouter(prefix="/buildings", tags=[Building.__name__])


@router.get("", response_model=list[BuildingRead])
async def list_buildings(session: DatabaseSession) -> list[Building]:
    """List all buildings without pagination."""

    return await crud.list_records(session, Building)


@router.post("", response_model=BuildingRead, status_code=status.HTTP_201_CREATED)
async def create_building(
    payload: BuildingCreate, session: DatabaseSession
) -> Building:
    """Create a building."""

    return await crud.create_record(session, Building, payload.model_dump())


@router.get("/{building_id}", response_model=BuildingRead)
async def get_building(building_id: RecordID, session: DatabaseSession) -> Building:
    """Read one building."""

    return await crud.get_record(session, Building, building_id)


@router.patch("/{building_id}", response_model=BuildingRead)
async def update_building(
    building_id: RecordID, payload: BuildingUpdate, session: DatabaseSession
) -> Building:
    """Rename a building."""

    record = await crud.get_record(session, Building, building_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete("/{building_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_building(building_id: RecordID, session: DatabaseSession) -> Response:
    """Delete an unreferenced building."""

    await crud.delete_record(
        session, await crud.get_record(session, Building, building_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
