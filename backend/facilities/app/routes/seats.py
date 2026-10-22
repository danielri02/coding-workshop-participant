"""Seat CRUD endpoints."""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select

from ..database import crud
from ..database.grids import grid_records
from ..models import Building, Floor, Seat
from ..schemas import SeatCreate, SeatRead, SeatUpdate
from ..schemas.grid import Page, SeatGridQuery
from ..security.dependencies import AdminUser, CurrentUser
from .dependencies import (
    DatabaseSession,
    DeletionConfirmation,
    OptionalQueryID,
    RecordID,
)

router = APIRouter(prefix="/seats", tags=[Seat.__name__])


@router.get("", response_model=list[SeatRead])
async def list_seats(
    session: DatabaseSession, _user: CurrentUser, floor_id: OptionalQueryID = None
) -> list[Seat]:
    """List all seats, optionally within one floor."""

    filters = {"floor_id": floor_id} if floor_id is not None else {}
    return await crud.list_records(session, Seat, filters=filters)


@router.get("/grid", response_model=Page[SeatRead])
async def grid_seats(
    session: DatabaseSession,
    _user: CurrentUser,
    query: Annotated[SeatGridQuery, Query()],
) -> dict:
    """Search, filter and page seats for collection grids."""

    statement = select(Seat).join(Floor).join(Building)
    if query.floor_id is not None:
        statement = statement.where(Seat.floor_id == query.floor_id)
    return await grid_records(
        session,
        statement,
        query,
        primary_key=Seat.id,
        text_columns={
            "label": Seat.label,
            "floor_name": Building.name + " · Floor " + Floor.label,
        },
    )


@router.post(
    "",
    response_model=SeatRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_seat(
    payload: SeatCreate, session: DatabaseSession, _admin: AdminUser
) -> Seat:
    """Create a labeled seat on an existing floor."""

    await crud.get_record(session, Floor, payload.floor_id)
    return await crud.create_record(session, Seat, payload.model_dump())


@router.get("/{seat_id}", response_model=SeatRead)
async def get_seat(
    seat_id: RecordID, session: DatabaseSession, _user: CurrentUser
) -> Seat:
    """Read one seat."""

    return await crud.get_record(session, Seat, seat_id)


@router.patch("/{seat_id}", response_model=SeatRead)
async def update_seat(
    seat_id: RecordID, payload: SeatUpdate, session: DatabaseSession, _admin: AdminUser
) -> Seat:
    """Relabel a seat without changing its parent floor."""

    record = await crud.get_record(session, Seat, seat_id, for_update=True)
    return await crud.update_record(
        session, record, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{seat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_seat(
    seat_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Delete a seat and its incidents and notes."""

    await crud.delete_record(
        session,
        await crud.get_record(session, Seat, seat_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
