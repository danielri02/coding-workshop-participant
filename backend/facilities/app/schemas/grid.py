"""Shared paging contract for collection grids; lookup endpoints remain lists."""

from typing import Annotated, Generic, Literal, TypeVar

from pydantic import Field

from .base import Schema

Row = TypeVar("Row")


class PaginationQuery(Schema):
    """MUI uses zero-based pages and a bounded page size."""

    page: Annotated[int, Field(ge=0)] = 0
    page_size: Annotated[int, Field(ge=1, le=100)] = 25


class GridQuery(PaginationQuery):
    """Single-column sorting/filtering plus text search for the reference grids."""

    sort_by: Annotated[str, Field(min_length=1, max_length=50)] = "id"
    sort_direction: Literal["asc", "desc"] = "asc"
    search: Annotated[str, Field(max_length=200)] = ""
    filter_field: Annotated[str, Field(min_length=1, max_length=50)] | None = None
    filter_operator: Literal[
        "contains",
        "isAnyOf",
        "doesNotContain",
        "equals",
        "doesNotEqual",
        "startsWith",
        "endsWith",
        "is",
        "not",
        "before",
        "after",
        "onOrBefore",
        "onOrAfter",
        "isEmpty",
        "isNotEmpty",
    ] = "contains"
    filter_value: Annotated[str, Field(max_length=10000)] | None = None
    filter_values: Annotated[
        list[Annotated[str, Field(max_length=10000)]], Field(max_length=100)
    ] = Field(default_factory=list)


class Page(Schema, Generic[Row]):
    """Rows and the total after access rules, search and filters are applied."""

    rows: list[Row]
    row_count: Annotated[int, Field(ge=0)]
    page: Annotated[int, Field(ge=0)]
    page_size: Annotated[int, Field(ge=1, le=100)]


class FloorGridQuery(GridQuery):
    """Keep a building relationship fixed while paging its floors."""

    building_id: Annotated[int, Field(gt=0, le=2_147_483_647)] | None = None


class SeatGridQuery(GridQuery):
    """Keep a floor relationship fixed while paging its seats."""

    floor_id: Annotated[int, Field(gt=0, le=2_147_483_647)] | None = None


class NoteGridQuery(GridQuery):
    """Conversations default to their most recent updates."""

    sort_by: str = "created_at"
    sort_direction: Literal["asc", "desc"] = "desc"
