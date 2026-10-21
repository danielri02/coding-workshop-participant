"""Floor CRUD endpoints."""

from fastapi import APIRouter, Response, status

from backend.app.database import crud
from backend.app.models import Building, Floor
from backend.app.schemas import FloorCreate, FloorRead, FloorUpdate

from .dependencies import DatabaseSession, OptionalQueryID, RecordID

router = APIRouter(prefix="/floors", tags=[Floor.__name__])


@router.get("", response_model=list[FloorRead])
async def list_floors(
    session: DatabaseSession, building_id: OptionalQueryID = None
) -> list[Floor]:
    """List all floors, optionally within one building."""

    filters = {"building_id": building_id} if building_id is not None else {}
    return await crud.list_records(session, Floor, filters=filters)


@router.post("", response_model=FloorRead, status_code=status.HTTP_201_CREATED)
async def create_floor(payload: FloorCreate, session: DatabaseSession) -> Floor:
    """Create a labeled floor in an existing building."""

    await crud.get_record(session, Building, payload.building_id)
    return await crud.create_record(session, Floor, payload.model_dump())


@router.get("/{floor_id}", response_model=FloorRead)
async def get_floor(floor_id: RecordID, session: DatabaseSession) -> Floor:
    """Read one floor."""

    return await crud.get_record(session, Floor, floor_id)


@router.patch("/{floor_id}", response_model=FloorRead)
async def update_floor(
    floor_id: RecordID, payload: FloorUpdate, session: DatabaseSession
) -> Floor:
    """Relabel a floor without changing its parent building."""

    record = await crud.get_record(session, Floor, floor_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete("/{floor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_floor(floor_id: RecordID, session: DatabaseSession) -> Response:
    """Delete an unreferenced floor."""

    await crud.delete_record(
        session, await crud.get_record(session, Floor, floor_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
