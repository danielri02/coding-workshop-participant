"""Shared incident visibility and operation-specific authorization rules."""

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.interfaces import ORMOption
from sqlalchemy.sql.elements import ColumnElement

from ..database import crud
from ..database.loading import INCIDENT_READ_OPTIONS
from ..models import Incident, Ticket, User


def incident_visibility(user: User) -> ColumnElement[bool]:
    """Combine employee, current-engineer-assignment, and admin read grants."""

    if user.is_admin:
        return true()
    own_reports = Incident.tickets.any(Ticket.reporter_id == user.id)
    if user.engineer_profile is not None:
        return or_(own_reports, Incident.assignee_id == user.id)
    return own_reports


async def require_incident_view(
    session: AsyncSession, user: User, incident: Incident
) -> None:
    """Use the same additive read rules for incident and note details."""

    if not (
        user.is_admin
        or (user.engineer_profile is not None and incident.assignee_id == user.id)
    ):
        owned = await session.scalar(
            select(Ticket.id)
            .where(Ticket.incident_id == incident.id, Ticket.reporter_id == user.id)
            .limit(1)
        )
        if owned is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Incident access denied")


async def accessible_incident(
    session: AsyncSession,
    incident_id: int,
    user: User,
    *,
    for_update: bool = False,
    options: Sequence[ORMOption] = (),
) -> Incident:
    """Load and authorize an incident, locking before write-time access checks."""

    incident = await crud.get_record(
        session,
        Incident,
        incident_id,
        for_update=for_update,
        options=(*INCIDENT_READ_OPTIONS, *options),
    )
    await require_incident_view(session, user, incident)
    return incident


def require_incident_worker(user: User, incident: Incident) -> None:
    """Allow status changes only for admins and currently assigned engineers."""

    if not (
        user.is_admin
        or (user.engineer_profile is not None and incident.assignee_id == user.id)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Admin or assigned Engineer capability required"
        )


def require_account_access(user: User, user_id: int) -> None:
    """Limit account details/edits to the account owner or an admin."""

    if not user.is_admin and user.id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account access denied")


def require_unmerged(incident: Incident) -> None:
    """Merged source records are historical references, not editable work."""

    if incident.merged_into_id is not None:
        raise HTTPException(409, f"Incident was merged into #{incident.merged_into_id}")
