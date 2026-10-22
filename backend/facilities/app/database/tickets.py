"""Create the report and initial problem atomically; scope ticket reads separately."""

from fastapi import HTTPException
from sqlalchemy import or_, true
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Incident, Ticket, User
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
