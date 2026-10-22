"""Incident CRUD, assignment, priority, and workflow endpoints."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from ..database import crud
from ..database.incident_queries import incident_criteria, incident_order
from ..domain.incidents import ACTIVE_STATUSES, ENGINEER_TRANSITIONS
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
)
from .dependencies import (
    INCIDENT_READ_OPTIONS,
    DatabaseSession,
    DeletionConfirmation,
    RecordID,
)

router = APIRouter(prefix="/incidents", tags=[Incident.__name__])


def _status_values(
    record: Incident, payload: IncidentStatusUpdate, now: datetime
) -> dict:
    """Clear obsolete blocking context and preserve first-entry milestones."""

    values = payload.model_dump()
    if (
        payload.status in {IncidentStatus.IN_PROGRESS, IncidentStatus.RESOLVED}
        and record.acknowledged_at is None
    ):
        # Resolution implies work started, including when admins skip a stage.
        # Older directly-resolved records must also retain ordered milestones.
        values["acknowledged_at"] = record.resolved_at or now
    if payload.status == IncidentStatus.RESOLVED and record.resolved_at is None:
        values["resolved_at"] = now
    return values


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

    if (
        not user.is_admin
        and {"priority", "escalation_reason"} & payload.model_fields_set
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Admin capability required to set priority or escalation",
        )
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
    _admin: AdminUser,
) -> Incident:
    """Admin triage: change priority or set/clear an escalation reason."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
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
    """A new assignee awaits acceptance; unassigning active work returns it to Open."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
    values = payload.model_dump()
    if payload.assignee_id is not None:
        await crud.get_record(session, EngineerProfile, payload.assignee_id)
        now = datetime.now(timezone.utc)
        if record.assigned_at is None:
            values["assigned_at"] = now
        if payload.assignee_id != record.assignee_id:
            values.update(
                _status_values(
                    record, IncidentStatusUpdate(status=IncidentStatus.ASSIGNED), now
                )
            )
    elif record.status in ACTIVE_STATUSES:
        values.update(
            _status_values(
                record,
                IncidentStatusUpdate(status=IncidentStatus.OPEN),
                datetime.now(timezone.utc),
            )
        )
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
    """Admins choose any state; engineers follow the assigned-work transitions."""

    record = await crud.get_record(session, Incident, incident_id, for_update=True)
    require_incident_worker(user, record)
    if not user.is_admin:
        if payload.status in {IncidentStatus.OPEN, IncidentStatus.CLOSED}:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin capability required")
        if payload.status not in ENGINEER_TRANSITIONS[record.status]:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Cannot transition from {record.status.value} to {payload.status.value}",
            )
    values = _status_values(record, payload, datetime.now(timezone.utc))
    return await crud.update_record(
        session, record, values, options=INCIDENT_READ_OPTIONS
    )


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: RecordID,
    session: DatabaseSession,
    _admin: AdminUser,
    confirmation: DeletionConfirmation = None,
) -> Response:
    """Delete an incident and cascade its notes."""

    await crud.delete_record(
        session,
        await crud.get_record(session, Incident, incident_id, for_update=True),
        confirmation=confirmation,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
