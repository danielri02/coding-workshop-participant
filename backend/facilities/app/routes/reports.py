"""Authorized read-only dashboards; ticket rows are paged on the server."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from ..database import reports
from ..schemas.report import (
    CategoryReport,
    LocationReport,
    ReportQuery,
    ReportScope,
    TimingReport,
    WorkloadReport,
)
from ..security.dependencies import AdminUser, CurrentUser
from .dependencies import DatabaseSession

router = APIRouter(prefix="/reports", tags=["Reports"])
PagedQuery = Annotated[ReportQuery, Query()]


@router.get("/locations", response_model=LocationReport)
async def locations(
    session: DatabaseSession,
    user: CurrentUser,
    scope: ReportScope = ReportScope.VISIBLE,
    level: Literal["building", "floor", "seat"] = "building",
):
    return await reports.locations(session, user, scope, level)


@router.get("/categories", response_model=CategoryReport)
async def categories(
    session: DatabaseSession,
    user: CurrentUser,
    scope: ReportScope = ReportScope.VISIBLE,
):
    return await reports.categories(session, user, scope)


@router.get("/timings", response_model=TimingReport)
async def timings(session: DatabaseSession, user: CurrentUser, query: PagedQuery):
    return await reports.timings(session, user, query)


@router.get("/workload", response_model=WorkloadReport)
async def workload(session: DatabaseSession, _admin: AdminUser):
    return await reports.workload(session)
