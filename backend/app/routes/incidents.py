"""Incident CRUD, assignment, priority, and workflow endpoints."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from ..database import crud
from ..database.incident_queries import incident_criteria, incident_order
from ..domain.incidents import TRANSITIONS
from ..models import (
    EngineerProfile,
    Incident,
    IncidentStatus,
)
from ..schemas import (
    IncidentAdminUpdate,
    IncidentAssignment,
    IncidentCreate,
    IncidentPriorityUpdate,
    IncidentRead,
    IncidentStatusUpdate,
)
from ..schemas.incident import IncidentFilters, IncidentGridQuery, IncidentPage
from ..security.dependencies import AdminUser, CurrentUser
from ..security.permissions import (
    accessible_incident,
    require_incident_worker,
    require_priority_access,
)
from .dependencies import INCIDENT_READ_OPTIONS, DatabaseSession, RecordID

router = APIRouter(prefix="/incidents", tags=[Incident.__name__])


@router.get("", response_model=list[IncidentRead])
async def list_incidents(
    session: DatabaseSession,
    user: CurrentUser,
    query: Annotated[IncidentFilters, Query()],
) -> list[Incident]:
    """List every matching incident without pagination."""

    filters, conditions = incident_criteria(query, user)
    return await crud.list_records(
        session,
        Incident,
        filters=filters,
        conditions=conditions,
        options=INCIDENT_READ_OPTIONS,
    )


@router.get("/grid", response_model=IncidentPage)
async def grid_incidents(
    session: DatabaseSession,
    user: CurrentUser,
    query: Annotated[IncidentGridQuery, Query()],
) -> IncidentPage:
    """Page/sort filtered incidents and return a total within the same read scope."""

    filters, conditions = incident_criteria(query, user)
    rows, count = await crud.page_records(
        session,
        Incident,
        page=query.page,
        page_size=query.page_size,
        filters=filters,
        conditions=conditions,
        order_by=incident_order(query),
        options=INCIDENT_READ_OPTIONS,
    )
    return IncidentPage.model_validate(
        {
            "rows": rows,
            "row_count": count,
            "page": query.page,
            "page_size": query.page_size,
        }
    )


@router.post("", response_model=IncidentRead, status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: IncidentCreate, session: DatabaseSession, user: CurrentUser
) -> Incident:
    """Create an Open report owned by the authenticated employee."""

    await crud.validate_location(
        session, payload.building_id, payload.floor_id, payload.seat_id
    )
    return await crud.create_record(
        session,
        Incident,
        {**payload.model_dump(), "reporter_id": user.id},
        options=INCIDENT_READ_OPTIONS,
    )


@router.get("/{incident_id}", response_model=IncidentRead)
async def get_incident(
    incident_id: RecordID, session: DatabaseSession, user: CurrentUser
) -> Incident:
    """Read one incident."""

    return await accessible_incident(
        session, incident_id, user, options=INCIDENT_READ_OPTIONS
    )


@router.patch("/{incident_id}", response_model=IncidentRead)
async def update_incident(
    incident_id: RecordID,
    payload: IncidentAdminUpdate,
    session: DatabaseSession,
    _admin: AdminUser,
) -> Incident:
    """Correct submitted details, checking location after merging the patch."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
    values = payload.model_dump(exclude_unset=True)
    await crud.validate_location(
        session,
        values.get("building_id", record.building_id),
        values.get("floor_id", record.floor_id),
        values.get("seat_id", record.seat_id),
    )
    return await crud.update_record(
        session, record, values, options=INCIDENT_READ_OPTIONS
    )


@router.patch("/{incident_id}/priority", response_model=IncidentRead)
async def update_incident_priority(
    incident_id: RecordID,
    payload: IncidentPriorityUpdate,
    session: DatabaseSession,
    user: CurrentUser,
) -> Incident:
    """Change priority or set/clear an escalation reason."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
    require_priority_access(user, record)
    return await crud.update_record(
        session,
        record,
        payload.model_dump(exclude_unset=True),
        options=INCIDENT_READ_OPTIONS,
    )


@router.patch("/{incident_id}/assignment", response_model=IncidentRead)
async def assign_incident(
    incident_id: RecordID,
    payload: IncidentAssignment,
    session: DatabaseSession,
    _admin: AdminUser,
) -> Incident:
    """Assign/reassign/unassign while preserving the first-assignment milestone."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
    values = payload.model_dump()
    if payload.assignee_id is not None:
        await crud.get_record(session, EngineerProfile, payload.assignee_id)
        if record.assigned_at is None:
            values["assigned_at"] = datetime.now(timezone.utc)
    return await crud.update_record(
        session, record, values, options=INCIDENT_READ_OPTIONS
    )


@router.patch("/{incident_id}/status", response_model=IncidentRead)
async def update_incident_status(
    incident_id: RecordID,
    payload: IncidentStatusUpdate,
    session: DatabaseSession,
    user: CurrentUser,
) -> Incident:
    """Apply a valid transition and maintain first-entry milestone timestamps."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
    require_incident_worker(user, record)
    if payload.status not in TRANSITIONS[record.status]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot transition from {record.status.value} to {payload.status.value}",
        )
    values = payload.model_dump()
    now = datetime.now(timezone.utc)
    if payload.status == IncidentStatus.IN_PROGRESS and record.acknowledged_at is None:
        values["acknowledged_at"] = now
    if payload.status == IncidentStatus.RESOLVED and record.resolved_at is None:
        values["resolved_at"] = now
    return await crud.update_record(
        session, record, values, options=INCIDENT_READ_OPTIONS
    )


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: RecordID, session: DatabaseSession, _admin: AdminUser
) -> Response:
    """Delete an incident and cascade its notes."""

    await crud.delete_record(
        session, await crud.get_record(session, Incident, incident_id, for_update=True)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
