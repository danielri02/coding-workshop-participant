"""Shared SQL paging for small CRUD routers, with explicit allowed columns."""

from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import SQLColumnExpression

from ..schemas.grid import GridQuery

Column = SQLColumnExpression[Any]


def invalid_filter(detail: str) -> HTTPException:
    """Reject unsupported fields/operators instead of ignoring grid controls."""

    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def filter_condition(
    query: GridQuery,
    text_columns: Mapping[str, Column],
    boolean_columns: Mapping[str, Column],
    date_columns: Mapping[str, Column],
) -> Column | None:
    """Translate the one filter supported by the community Data Grid to SQL."""

    field, operator, value = (
        query.filter_field,
        query.filter_operator,
        query.filter_value,
    )
    if field is None:
        return None
    columns = {**text_columns, **boolean_columns, **date_columns}
    if field not in columns:
        raise invalid_filter("Unsupported filter field")
    column = columns[field]
    if operator in {"isEmpty", "isNotEmpty"}:
        empty = column.is_(None)
        if field in text_columns:
            empty = or_(empty, column == "")
        return empty if operator == "isEmpty" else ~empty
    if operator == "isAnyOf":
        if field not in text_columns:
            raise invalid_filter("isAnyOf requires a text field")
        return (
            func.lower(column).in_([value.lower() for value in query.filter_values])
            if query.filter_values
            else None
        )
    if value is None or value == "":
        return None  # The filter editor has not received a value yet.
    if field in boolean_columns:
        if operator != "is" or value not in {"true", "false"}:
            raise invalid_filter("Boolean filters require is true or is false")
        return column == (value == "true")
    if field in date_columns:
        try:
            timestamp = datetime.fromisoformat(value)
        except ValueError:
            raise invalid_filter("Date filters require an ISO timestamp") from None
        if timestamp.tzinfo is None:
            raise invalid_filter("Date filters require a timezone")
        timestamp = timestamp.astimezone(timezone.utc)
        if operator in {"is", "not"}:
            # MUI's date/time editor has minute precision.
            same_minute = func.date_trunc("minute", column) == timestamp.replace(
                second=0, microsecond=0
            )
            return same_minute if operator == "is" else ~same_minute
        if operator == "before":
            return column < timestamp
        if operator == "after":
            return column > timestamp
        if operator == "onOrBefore":
            return column <= timestamp
        if operator == "onOrAfter":
            return column >= timestamp
        raise invalid_filter("Unsupported date filter operator")
    if operator == "contains":
        return column.icontains(value, autoescape=True)
    if operator == "doesNotContain":
        return ~column.icontains(value, autoescape=True)
    if operator in {"equals", "doesNotEqual"}:
        equal = func.lower(column) == value.lower()
        return equal if operator == "equals" else ~equal
    if operator == "startsWith":
        return column.istartswith(value, autoescape=True)
    if operator == "endsWith":
        return column.iendswith(value, autoescape=True)
    raise invalid_filter("Unsupported text filter operator")


async def grid_records(
    session: AsyncSession,
    statement: Select,
    query: GridQuery,
    *,
    primary_key: Column,
    text_columns: Mapping[str, Column],
    boolean_columns: Mapping[str, Column] | None = None,
    date_columns: Mapping[str, Column] | None = None,
    extra_sorts: Mapping[str, Column] | None = None,
    options: Sequence[Any] = (),
) -> dict[str, Any]:
    """Count and page the same scoped query, using only whitelisted SQL fields."""

    boolean_columns, date_columns = boolean_columns or {}, date_columns or {}
    columns = {
        "id": primary_key,
        **text_columns,
        **boolean_columns,
        **date_columns,
        **(extra_sorts or {}),
    }
    if query.sort_by not in columns:
        raise invalid_filter("Unsupported sort field")
    if term := query.search.strip():
        statement = statement.where(
            or_(
                *(
                    column.icontains(term, autoescape=True)
                    for column in text_columns.values()
                )
            )
        )
    condition = filter_condition(query, text_columns, boolean_columns, date_columns)
    if condition is not None:
        statement = statement.where(condition)
    count = await session.scalar(select(func.count()).select_from(statement.subquery()))
    column = columns[query.sort_by]
    order = column.asc() if query.sort_direction == "asc" else column.desc()
    statement = (
        statement.options(*options)
        .order_by(order.nulls_last(), primary_key.asc())
        .offset(query.page * query.page_size)
        .limit(query.page_size)
    )
    return {
        "rows": list(await session.scalars(statement)),
        "row_count": count or 0,
        "page": query.page,
        "page_size": query.page_size,
    }
