"""Create the report and initial problem atomically; scope ticket reads separately."""

from fastapi import HTTPException
from sqlalchemy import or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, IncidentStatus, Ticket, User
from . import crud
from .loading import TICKET_READ_OPTIONS


def ticket_visibility(user: User):
    if user.is_admin:
        return true()
    own = Ticket.reporter_id == user.id
    if user.engineer_profile:
        return or_(own, Ticket.incident.has(Incident.assignee_id == user.id))
    return own


async def create_ticket(session: AsyncSession, values: dict, user: User) -> Ticket:
    """Both records commit together, with their own stable IDs and original text."""

    if not user.is_admin and {"priority", "escalation_reason"} & values.keys():
        raise HTTPException(
            403, "Admin capability required to set priority or escalation"
        )
    await crud.validate_location(
        session, values["building_id"], values.get("floor_id"), values.get("seat_id")
    )
    incident = Incident(**values)
    ticket = Ticket(
        incident=incident,
        reporter_id=user.id,
        **{
            key: values[key]
            for key in ("title", "description", "building_id", "floor_id", "seat_id")
            if key in values
        },
    )
    session.add(ticket)
    await crud.commit(session)
    return await crud.get_record(
        session, Ticket, ticket.id, options=TICKET_READ_OPTIONS
    )


async def reattach_ticket(
    session: AsyncSession, ticket_id: int, target_id: int
) -> Ticket:
    """Move one report without changing either incident or moving shared notes."""

    ticket = await crud.get_record(session, Ticket, ticket_id)
    source_id = ticket.incident_id
    if source_id == target_id:
        raise HTTPException(409, "Ticket already follows this incident")
    # Incident merges take these same locks before updating tickets. Lock the
    # parents first, in ID order, so a reattachment cannot race or deadlock one.
    incidents = list(
        await session.scalars(
            select(Incident)
            .where(Incident.id.in_([source_id, target_id]))
            .order_by(Incident.id)
            .with_for_update()
        )
    )
    if len(incidents) != 2:
        raise HTTPException(404, "Source or target incident not found")
    ticket = await crud.get_record(session, Ticket, ticket_id, for_update=True)
    if ticket.incident_id != source_id:
        raise HTTPException(409, "Ticket changed; reload before reattaching")
    target = next(row for row in incidents if row.id == target_id)
    if target.merged_into_id is not None or target.status == IncidentStatus.CLOSED:
        raise HTTPException(409, "Choose an incident that is not closed or merged")
    return await crud.update_record(
        session, ticket, {"incident_id": target_id}, options=TICKET_READ_OPTIONS
    )
