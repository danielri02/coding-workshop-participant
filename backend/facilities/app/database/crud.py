"""Common async CRUD operations and safe database error responses."""

from collections.abc import Mapping, Sequence
from typing import Any, TypeVar

from fastapi import HTTPException, status
from sqlalchemy import func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.interfaces import ORMOption
from sqlalchemy.sql import SQLColumnExpression

from ..models import Base, Building, Floor, Seat
from .deletion import delete_with_dependents

Model = TypeVar("Model", bound=Base)


async def get_record(
    session: AsyncSession,
    model: type[Model],
    record_id: int,
    *,
    options: Sequence[ORMOption] = (),
    for_update: bool = False,
) -> Model:
    """Get a single-primary-key record, optionally locking it for a write."""

    primary_key = inspect(model).primary_key[0]
    statement = select(model).where(primary_key == record_id).options(*options)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement.execution_options(populate_existing=True))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return record


async def list_records(
    session: AsyncSession,
    model: type[Model],
    *,
    filters: Mapping[str, Any] | None = None,
    options: Sequence[ORMOption] = (),
    order_by: Sequence[SQLColumnExpression[Any]] = (),
    conditions: Sequence[SQLColumnExpression[bool]] = (),
) -> list[Model]:
    """Return every matching record in deterministic primary-key order."""

    statement = (
        select(model)
        .filter_by(**(filters or {}))
        .where(*conditions)
        .options(*options)
        .order_by(*(order_by or inspect(model).primary_key))
    )
    return list(await session.scalars(statement))


async def page_records(
    session: AsyncSession,
    model: type[Model],
    *,
    page: int,
    page_size: int,
    filters: Mapping[str, Any] | None = None,
    conditions: Sequence[SQLColumnExpression[bool]] = (),
    options: Sequence[ORMOption] = (),
    order_by: Sequence[SQLColumnExpression[Any]] = (),
) -> tuple[list[Model], int]:
    """Page a filtered query and count only records matching that same scope."""

    statement = select(model).filter_by(**(filters or {})).where(*conditions)
    count = await session.scalar(select(func.count()).select_from(statement.subquery()))
    statement = (
        statement.options(*options)
        .order_by(*(order_by or inspect(model).primary_key))
        .offset(page * page_size)
        .limit(page_size)
    )
    return list(await session.scalars(statement)), count or 0


async def commit(session: AsyncSession) -> None:
    """Commit a write, rolling back constraint failures without exposing SQL data."""

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        code = getattr(exc.orig, "sqlstate", None)
        if code == "23505":
            detail = "A record with these unique fields already exists"
        elif code == "23503":
            detail = "Operation conflicts with a missing or referenced record"
        else:
            detail = "Data violates a database constraint"
        response_status = (
            status.HTTP_422_UNPROCESSABLE_CONTENT
            if code in {"23502", "23514"}
            else status.HTTP_409_CONFLICT
        )
        raise HTTPException(response_status, detail) from None


async def create_record(
    session: AsyncSession,
    model: type[Model],
    values: Mapping[str, Any],
    *,
    options: Sequence[ORMOption] = (),
) -> Model:
    """Create from schema-controlled values and load defaults/response relations."""

    record = model(**values)
    session.add(record)
    await commit(session)
    record_id = getattr(record, inspect(model).primary_key[0].key)
    return await get_record(session, model, record_id, options=options)


async def update_record(
    session: AsyncSession,
    record: Model,
    values: Mapping[str, Any],
    *,
    options: Sequence[ORMOption] = (),
) -> Model:
    """Apply only validated, explicitly supplied fields and reload the response."""

    for field, value in values.items():
        setattr(record, field, value)
    await commit(session)
    record_id = getattr(record, inspect(type(record)).primary_key[0].key)
    return await get_record(session, type(record), record_id, options=options)


async def delete_record(
    session: AsyncSession, record: Base, *, confirmation: str | None = None
) -> None:
    """Apply the confirmed application cascade without altering database constraints."""

    await delete_with_dependents(session, record, confirmation)


async def validate_location(
    session: AsyncSession,
    building_id: int,
    floor_id: int | None,
    seat_id: int | None,
) -> None:
    """Validate a complete location, including merged partial-update values."""

    await get_record(session, Building, building_id)
    if seat_id is not None and floor_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "A seat requires its floor"
        )
    if floor_id is not None:
        floor = await get_record(session, Floor, floor_id)
        if floor.building_id != building_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Floor does not belong to the building",
            )
    if seat_id is not None:
        seat = await get_record(session, Seat, seat_id)
        if seat.floor_id != floor_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Seat does not belong to the floor",
            )
