"""Seat CRUD endpoints."""

from fastapi import APIRouter, Depends, Response, status

from ..database import crud
from ..models import Floor, Seat
from ..schemas import SeatCreate, SeatRead, SeatUpdate
from ..security.dependencies import current_user, require_admin
from .dependencies import DatabaseSession, OptionalQueryID, RecordID

router = APIRouter(
    prefix="/seats", tags=[Seat.__name__], dependencies=[Depends(current_user)]
)


@router.get("", response_model=list[SeatRead])
async def list_seats(
    session: DatabaseSession, floor_id: OptionalQueryID = None
) -> list[Seat]:
    """List all seats, optionally within one floor."""

    filters = {"floor_id": floor_id} if floor_id is not None else {}
    return await crud.list_records(session, Seat, filters=filters)


@router.post(
    "",
    response_model=SeatRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def create_seat(payload: SeatCreate, session: DatabaseSession) -> Seat:
    """Create a labeled seat on an existing floor."""

    await crud.get_record(session, Floor, payload.floor_id)
    return await crud.create_record(session, Seat, payload.model_dump())


@router.get("/{seat_id}", response_model=SeatRead)
async def get_seat(seat_id: RecordID, session: DatabaseSession) -> Seat:
    """Read one seat."""

    return await crud.get_record(session, Seat, seat_id)


@router.patch(
    "/{seat_id}", response_model=SeatRead, dependencies=[Depends(require_admin)]
)
async def update_seat(
    seat_id: RecordID, payload: SeatUpdate, session: DatabaseSession
) -> Seat:
    """Relabel a seat without changing its parent floor."""

    record = await crud.get_record(session, Seat, seat_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{seat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_seat(seat_id: RecordID, session: DatabaseSession) -> Response:
    """Delete an unreferenced seat."""

    await crud.delete_record(
        session, await crud.get_record(session, Seat, seat_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
