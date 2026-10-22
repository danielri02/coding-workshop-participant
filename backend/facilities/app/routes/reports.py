"""Authorized read-only dashboards; ticket rows are paged on the server."""

from typing import Annotated

from fastapi import APIRouter, Query

from ..database import reports
from ..schemas.report import (
    CategoryQuery,
    CategoryReport,
    IncidentSummary,
    LocationQuery,
    LocationReport,
    ReportQuery,
    ReportScope,
    ResponseTimeSummary,
    TimingReport,
    WorkloadReport,
)
from ..security.dependencies import AdminUser, CurrentUser
from .dependencies import DatabaseSession

router = APIRouter(prefix="/reports", tags=["Reports"])
PagedQuery = Annotated[ReportQuery, Query()]


@router.get("/summary", response_model=IncidentSummary)
async def summary(
    session: DatabaseSession,
    user: CurrentUser,
    scope: ReportScope = ReportScope.PERSONAL,
):
    return await reports.summary(session, user, scope)


@router.get("/locations", response_model=LocationReport)
async def locations(
    session: DatabaseSession,
    user: CurrentUser,
    query: Annotated[LocationQuery, Query()],
):
    return await reports.locations(session, user, query)


@router.get("/categories", response_model=CategoryReport)
async def categories(
    session: DatabaseSession,
    user: CurrentUser,
    query: Annotated[CategoryQuery, Query()],
):
    return await reports.categories(session, user, query)


@router.get("/timings", response_model=TimingReport)
async def timings(session: DatabaseSession, user: CurrentUser, query: PagedQuery):
    return await reports.timings(session, user, query)


@router.get("/workload", response_model=WorkloadReport)
async def workload(session: DatabaseSession, _admin: AdminUser):
    return await reports.workload(session)


@router.get("/my-response-times", response_model=ResponseTimeSummary)
async def my_response_times(session: DatabaseSession, user: CurrentUser):
    return await reports.engineer_response_times(session, user)
