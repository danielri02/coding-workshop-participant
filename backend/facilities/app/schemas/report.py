"""Read-only reporting contracts; totals always cover the complete authorized scope."""

from enum import StrEnum
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import Field

from ..models import IncidentCategory, IncidentPriority, IncidentStatus
from .base import Schema, UTCDateTime
from .incident import FilterID

Count = Annotated[int, Field(ge=0)]
Minutes = Annotated[float, Field(ge=0)]
Row = TypeVar("Row")


class ReportScope(StrEnum):
    VISIBLE = "visible"
    PERSONAL = "personal"
    ASSIGNED = "assigned"


class ReportPeriod(StrEnum):
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"
    ALL = "all"


class ReportFilters(Schema):
    scope: ReportScope = ReportScope.VISIBLE
    period: ReportPeriod = ReportPeriod.MONTH


class LocationQuery(ReportFilters):
    level: Literal["building", "floor", "seat"] = "building"
    category: IncidentCategory | None = None
    repeated_only: bool = False


class CategoryQuery(ReportFilters):
    building_id: FilterID | None = None
    floor_id: FilterID | None = None
    seat_id: FilterID | None = None


class ReportQuery(ReportFilters):
    category: IncidentCategory | None = None
    assignee_id: FilterID | None = None
    search: Annotated[str, Field(max_length=200)] = ""
    page: Count = 0
    page_size: Annotated[int, Field(ge=1, le=100)] = 25
    sort_by: Literal[
        "id",
        "title",
        "status",
        "priority",
        "category",
        "created_at",
        "assignee_name",
        "assigned_minutes",
        "acknowledged_minutes",
        "resolved_minutes",
    ] = "created_at"
    sort_direction: Literal["asc", "desc"] = "desc"


class IncidentSummary(Schema):
    """Counts across a complete authorized scope, independent of grid filters."""

    scope: ReportScope
    total_count: Count
    active_count: Count
    open_count: Count
    assigned_count: Count
    in_progress_count: Count
    blocked_count: Count
    resolved_count: Count
    closed_count: Count


class ReportPage(Schema, Generic[Row]):
    rows: list[Row]
    row_count: Count
    page: Count
    page_size: Annotated[int, Field(ge=1, le=100)]


class ReportWindow(Schema):
    period: ReportPeriod
    start_at: UTCDateTime | None
    end_at: UTCDateTime


class LocationRow(Schema):
    id: str
    building_id: int
    floor_id: int | None
    seat_id: int | None
    building_name: str
    floor_label: str | None
    seat_label: str | None
    incident_count: Count
    active_count: Count


class LocationReport(ReportWindow):
    report: Literal["locations"] = "locations"
    level: Literal["building", "floor", "seat"]
    minimum_incidents: int = 1
    rows: list[LocationRow]


class CategoryRow(Schema):
    id: str
    category: IncidentCategory
    incident_count: Count
    active_count: Count
    percentage: Annotated[float, Field(ge=0, le=100)]


class CategoryReport(ReportWindow):
    report: Literal["categories"] = "categories"
    rows: list[CategoryRow]


class MilestoneMetric(Schema):
    id: Literal["assigned", "acknowledged", "resolved"]
    label: str
    sample_count: Count
    average_minutes: Minutes | None


class TimingRow(Schema):
    id: int
    title: str
    status: IncidentStatus
    priority: IncidentPriority
    category: IncidentCategory
    assignee_name: str | None
    assignee_id: int | None
    created_at: UTCDateTime
    assigned_minutes: Minutes | None
    acknowledged_minutes: Minutes | None
    resolved_minutes: Minutes | None


class TimingReport(ReportPage[TimingRow], ReportWindow):
    report: Literal["timings"] = "timings"
    milestones: list[MilestoneMetric]


class WorkloadRow(Schema):
    id: int
    name: str
    is_available: bool
    total_count: Count
    active_count: Count
    open_count: Count
    assigned_count: Count
    in_progress_count: Count
    blocked_count: Count
    high_priority_count: Count


class WorkloadReport(Schema):
    report: Literal["workload"] = "workload"
    unassigned_count: Count
    rows: list[WorkloadRow]
