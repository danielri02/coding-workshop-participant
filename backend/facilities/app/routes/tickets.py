"""Employees create and track reports; facilities staff work their shared incident."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from ..database.grids import grid_records
from ..database.loading import TICKET_READ_OPTIONS
from ..database.tickets import create_ticket, reattach_ticket, ticket_visibility
from ..models import Incident, Ticket, User
from ..schemas.grid import GridQuery, Page
from ..schemas.ticket import TicketCreate, TicketGridQuery, TicketRead, TicketReattach
from ..security.dependencies import AdminUser, CurrentUser
from .dependencies import DatabaseSession, RecordID

router = APIRouter(prefix="/tickets", tags=[Ticket.__name__])


@router.post("", response_model=TicketRead, status_code=status.HTTP_201_CREATED)
async def submit_ticket(
    payload: TicketCreate, session: DatabaseSession, user: CurrentUser
) -> Ticket:
    return await create_ticket(session, payload.model_dump(exclude_unset=True), user)


@router.get("/grid", response_model=Page[TicketRead])
async def grid_tickets(
    session: DatabaseSession,
    user: CurrentUser,
    query: Annotated[TicketGridQuery, Query()],
) -> dict:
    """Apply report ownership independently from the incident's other followers."""

    conditions = [ticket_visibility(user)]
    for field in ("reporter_id", "building_id", "floor_id", "seat_id", "incident_id"):
        if (value := getattr(query, field)) is not None:
            conditions.append(getattr(Ticket, field) == value)
    for field in ("status", "priority", "category", "assignee_id"):
        if (value := getattr(query, field)) is not None:
            conditions.append(getattr(Incident, field) == value)
    if query.unassigned is not None:
        conditions.append(
            Incident.assignee_id.is_(None)
            if query.unassigned
            else Incident.assignee_id.is_not(None)
        )
    if query.escalated is not None:
        conditions.append(
            Incident.escalation_reason.is_not(None)
            if query.escalated
            else Incident.escalation_reason.is_(None)
        )
    if term := (query.search or "").strip():
        conditions.append(
            or_(
                Ticket.title.icontains(term, autoescape=True),
                Ticket.description.icontains(term, autoescape=True),
            )
        )
    columns = {
        "id": Ticket.id,
        "title": Ticket.title,
        "created_at": Ticket.created_at,
        "building_id": Ticket.building_id,
        "floor_id": Ticket.floor_id,
        "seat_id": Ticket.seat_id,
        "incident_id": Ticket.incident_id,
        "assignee_name": User.name,
        **{
            field: getattr(Incident, field)
            for field in (
                "status",
                "priority",
                "category",
                "assignee_id",
                "assigned_at",
                "acknowledged_at",
                "resolved_at",
            )
        },
    }
    statement = (
        select(Ticket)
        .join(Incident)
        .outerjoin(User, User.id == Incident.assignee_id)
        .where(*conditions)
    )
    return await grid_records(
        session,
        statement,
        GridQuery(
            page=query.page,
            page_size=query.page_size,
            sort_by=query.sort_by,
            sort_direction=query.sort_direction,
        ),
        primary_key=Ticket.id,
        text_columns={"title": Ticket.title},
        extra_sorts=columns,
        options=TICKET_READ_OPTIONS,
    )


@router.get("/{ticket_id}", response_model=TicketRead)
async def get_ticket(
    ticket_id: RecordID, session: DatabaseSession, user: CurrentUser
) -> Ticket:
    ticket = await session.scalar(
        select(Ticket)
        .where(Ticket.id == ticket_id, ticket_visibility(user))
        .options(*TICKET_READ_OPTIONS)
    )
    if ticket is None:
        raise HTTPException(404, "Ticket not found")
    return ticket


@router.post("/{ticket_id}/reattach", response_model=TicketRead)
async def reattach_report(
    ticket_id: RecordID,
    payload: TicketReattach,
    session: DatabaseSession,
    _admin: AdminUser,
) -> Ticket:
    return await reattach_ticket(session, ticket_id, payload.target_incident_id)
